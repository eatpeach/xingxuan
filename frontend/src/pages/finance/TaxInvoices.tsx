import { useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Modal, Popconfirm, Segmented, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { api } from '../../api'

/**
 * 税票登记（20261127）——财务管理里的两个页签共用
 *   side = out：给客户开税票（已确认到账的单自动进来；客户要求先开票再付款的，财务可手动加）
 *   side = in ：找供应商拿税票（确认到账后才进来；一张单几家供应商就是几行）
 * 只点按钮登记，不填税票号。状态和默认规则见 backend/api/handlers/tax_invoice.php
 */

const money = (currency: string, v: any) =>
  `${currency === 'CNY' ? '¥' : 'Rp'} ${Math.round(Number(v || 0)).toLocaleString()}`

const CHANNEL: Record<string, string> = {
  company: '对公', private_idr: '对私·印尼盾', private_cny: '对私·人民币', factory: '客户直付工厂',
}

/** 这一行算不算「还要处理」：未开，或者开完之后金额又变了 */
export const taxNeedsAction = (r: any) => r.state === 'todo' || r.changed

type Props = {
  side: 'out' | 'in'
  rows: any[]
  addable: any[]
  canOperate: boolean
  loading: boolean
  reload: () => void
}

export default function TaxInvoices({ side, rows, addable, canOperate, loading, reload }: Props) {
  const isOut = side === 'out'
  const doneWord = isOut ? '已开票' : '已收票'
  const todoWord = isOut ? '未开' : '未收到'
  const [filter, setFilter] = useState<'todo' | 'done' | 'skip' | 'all'>('todo')
  const [kw, setKw] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addKw, setAddKw] = useState('')

  const counts = useMemo(() => ({
    todo: rows.filter(taxNeedsAction).length,
    done: rows.filter((r) => r.state === 'done' && !r.changed).length,
    skip: rows.filter((r) => r.state === 'skip').length,
    all: rows.length,
  }), [rows])

  const hit = (r: any, k: string) => {
    const s = k.trim().toLowerCase()
    if (!s) return true
    // 商机编号要整个对上才算（搜 29 不该把 291、1290 都带出来）
    if (/^#?\d+$/.test(s) && String(r.inquiry_id || '') === s.replace('#', '')) return true
    return [r.customer_name, r.customer_code, r.order_no, r.inquiry_no, r.inquiry_title, r.supplier_name, r.contract_no]
      .some((v) => String(v || '').toLowerCase().includes(s))
  }

  const shown = rows.filter((r) => {
    if (!hit(r, kw)) return false
    if (filter === 'todo') return taxNeedsAction(r)
    if (filter === 'done') return r.state === 'done' && !r.changed
    if (filter === 'skip') return r.state === 'skip'
    return true
  })

  const mark = async (r: any, status: 'todo' | 'done' | 'skip' | 'remove', okText: string) => {
    await api.post('markTaxInvoice', { order_id: r.order_id, side, supplier_name: r.supplier_name || '', status })
    message.success(okText)
    reload()
  }

  const stateTag = (r: any) => {
    if (r.changed) {
      return (
        <Tooltip title={`${doneWord}时订单金额是 ${money(r.currency, r.marked_amount)}，现在是 ${money(r.currency, r.amount)}。${isOut ? '请按新金额重开税票' : '请找供应商按新金额重开'}，处理完点「已重开」。`}>
          <Tag color="red">金额已变，需重开</Tag>
        </Tooltip>
      )
    }
    if (r.state === 'done') {
      return r.why === 'history'
        ? <Tooltip title="功能上线前就已成交的老单，统一按已处理。如果其实还没开，点右边「改为未开」。"><Tag>老单·已处理</Tag></Tooltip>
        : <Tag color="green">{doneWord}</Tag>
    }
    if (r.state === 'skip') {
      return r.why === 'private'
        ? <Tooltip title="对私付款的单统一不用开税票。如果这单其实要开，点右边「改为未开」。"><Tag>对私·无需开票</Tag></Tooltip>
        : <Tag>无需开票</Tag>
    }
    return <Tag color="orange">{todoWord}</Tag>
  }

  const columns: any[] = [
    {
      // 和商机列表的「商机编号」是同一个数，大家沟通时报的就是它
      title: '商机编号',
      width: 90,
      render: (_: any, r: any) => (r.inquiry_id ? <strong>{r.inquiry_id}</strong> : <span style={{ color: '#bbb' }}>-</span>),
    },
    {
      title: '客户',
      width: 150,
      ellipsis: true,
      render: (_: any, r: any) => r.customer_name || '-',
    },
    ...(isOut ? [] : [{
      title: '供应商',
      width: 170,
      ellipsis: true,
      render: (_: any, r: any) => r.supplier_name
        ? <strong>{r.supplier_name}</strong>
        : <Tooltip title="这张单没有填供应商，请到商机里补上"><span style={{ color: '#fa8c16' }}>未填供应商</span></Tooltip>,
    }]),
    {
      title: '商机 / 订单号',
      width: 190,
      render: (_: any, r: any) => (
        <div style={{ lineHeight: 1.4 }}>
          <div>{r.inquiry_no || '-'}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{r.order_no}</div>
        </div>
      ),
    },
    {
      title: isOut ? '订单金额（含税）' : '订单金额（参考）',
      width: 160,
      align: 'right' as const,
      render: (_: any, r: any) => money(r.currency, r.amount),
    },
    {
      title: '付款方式',
      width: 110,
      render: (_: any, r: any) => CHANNEL[r.payment_channel] || <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: '到账时间',
      width: 130,
      render: (_: any, r: any) => r.deal_confirmed_at
        ? String(r.deal_confirmed_at).slice(0, 10)
        : <Tooltip title="客户还没付款，是财务手动加进来先开税票的"><Tag color="gold">未到账·先开票</Tag></Tooltip>,
    },
    { title: '税票状态', width: 150, render: (_: any, r: any) => stateTag(r) },
    {
      title: '登记人 / 时间',
      width: 150,
      render: (_: any, r: any) => r.marked_at
        ? <span style={{ fontSize: 12, color: '#888' }}>{r.marked_by_name || '-'} {String(r.marked_at).slice(5, 16)}</span>
        : <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        if (!canOperate) return <span style={{ color: '#bbb' }}>仅财务可操作</span>
        if (r.changed) {
          return (
            <Popconfirm title={`确认已按新金额${isOut ? '重开税票' : '收到重开的税票'}？`} onConfirm={() => mark(r, 'done', '已登记')}>
              <Button type="primary" danger size="small">已重开</Button>
            </Popconfirm>
          )
        }
        if (r.state === 'todo') {
          return (
            <Space size={10}>
              <Popconfirm
                title={isOut ? '确认已给客户开税票？' : `确认已收到${r.supplier_name || '供应商'}的税票？`}
                description="点错了可以再撤销"
                onConfirm={() => mark(r, 'done', `已登记：${doneWord}`)}
              >
                <Button type="primary" size="small">{isOut ? '确认已开票' : '确认已收票'}</Button>
              </Popconfirm>
              <Popconfirm title="这一行不用开税票？" onConfirm={() => mark(r, 'skip', '已标记：无需开票')}>
                <a style={{ color: '#888' }}>无需开票</a>
              </Popconfirm>
              {isOut && !r.deal_confirmed_at && (
                <Popconfirm title="把这张未到账的单移出清单？" onConfirm={() => mark(r, 'remove', '已移出清单')}>
                  <a style={{ color: '#888' }}>移出</a>
                </Popconfirm>
              )}
            </Space>
          )
        }
        return (
          <Popconfirm title={`改回「${todoWord}」？`} onConfirm={() => mark(r, 'todo', `已改回：${todoWord}`)}>
            <a>{r.state === 'done' && r.why === 'manual' ? '撤销' : '改为未开'}</a>
          </Popconfirm>
        )
      },
    },
  ]

  return (
    <Card>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        {isOut
          ? '客户确认到账（成交）的单会自动出现在这里，开完税票点「确认已开票」。客户要求先开税票再付款的，点右上角「添加未到账的单」。对私付款的单默认不用开。'
          : '客户确认到账后，这张单的每家供应商各占一行，收到供应商开给我们的税票就点「确认已收票」。对私付款的单默认不用开。'}
      </Typography.Paragraph>
      {counts.todo > 0 && rows.some((r) => r.changed) && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`有 ${rows.filter((r) => r.changed).length} 行在登记之后订单金额变了（客户增减了货品），需要重开税票，已排在「${todoWord}」里。`}
        />
      )}
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as any)}
          options={[
            { label: `${todoWord} (${counts.todo})`, value: 'todo' },
            { label: `${doneWord} (${counts.done})`, value: 'done' },
            { label: `无需开票 (${counts.skip})`, value: 'skip' },
            { label: `全部 (${counts.all})`, value: 'all' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder={isOut ? '搜商机编号 / 客户 / 订单号' : '搜商机编号 / 供应商 / 客户'}
          style={{ width: 260 }}
          onChange={(e) => setKw(e.target.value)}
        />
        {isOut && canOperate && (
          <Button onClick={() => { setAddKw(''); setAddOpen(true) }}>添加未到账的单（先开票）</Button>
        )}
      </Space>
      <Table
        size="small"
        rowKey="key"
        loading={loading}
        dataSource={shown}
        columns={columns}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: isOut ? 1340 : 1510 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={filter === 'todo' ? (isOut ? '没有要开的税票，都处理完了' : '没有要催的供应商税票，都收齐了') : '没有记录'}
            />
          ),
        }}
      />

      <Modal
        open={addOpen}
        title="添加未到账的单（客户要求先开税票再付款）"
        footer={null}
        width={860}
        onCancel={() => setAddOpen(false)}
      >
        <Input.Search
          allowClear
          placeholder="搜商机编号 / 客户 / 订单号"
          style={{ width: 280, marginBottom: 12 }}
          onChange={(e) => setAddKw(e.target.value)}
        />
        <Table
          size="small"
          rowKey="order_id"
          dataSource={addable.filter((r) => hit(r, addKw))}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有已开单但未到账的单" /> }}
          columns={[
            { title: '商机编号', width: 90, render: (_: any, r: any) => (r.inquiry_id ? <strong>{r.inquiry_id}</strong> : '-') },
            { title: '客户', dataIndex: 'customer_name', ellipsis: true },
            {
              title: '商机 / 订单号',
              width: 200,
              render: (_: any, r: any) => (
                <div style={{ lineHeight: 1.4 }}>
                  <div>{r.inquiry_no || '-'}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{r.order_no}</div>
                </div>
              ),
            },
            { title: '订单金额（含税）', width: 160, align: 'right' as const, render: (_: any, r: any) => money(r.currency, r.amount) },
            { title: '付款方式', width: 110, render: (_: any, r: any) => CHANNEL[r.payment_channel] || '-' },
            { title: '开单时间', width: 110, render: (_: any, r: any) => String(r.order_created_at || '').slice(0, 10) },
            {
              title: '操作',
              width: 100,
              render: (_: any, r: any) => (
                <Button
                  type="primary"
                  size="small"
                  onClick={async () => {
                    await api.post('markTaxInvoice', { order_id: r.order_id, side: 'out', status: 'todo' })
                    message.success('已加入清单')
                    reload()
                  }}
                >
                  加入清单
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </Card>
  )
}
