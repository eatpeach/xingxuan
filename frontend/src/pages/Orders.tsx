import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Steps,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd'
import {
  CheckCircleOutlined,
  DeleteOutlined,
  FileImageOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { api } from '../api'
import { customerCellMerge, groupByCustomer } from '../utils/groupByCustomer'

const ORDER_STATUS: Record<string, { color: string; text: string }> = {
  pending_contract: { color: 'orange', text: '待签合同' },
  in_progress: { color: 'processing', text: '履约中' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
}

const CONTRACT_STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待确认' },
  signed: { color: 'success', text: '已签订' },
  archived: { color: 'default', text: '已归档' },
}

const PAYMENT_TYPES: Record<string, string> = {
  deposit: '定金',
  installment: '分期款',
  final: '尾款',
  full: '全款',
}

const COMMISSION_STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待结算' },
  settled: { color: 'blue', text: '已结算' },
  paid: { color: 'success', text: '已到账' },
}

interface Order {
  id: number
  no: string
  customer_id: number
  customer_name?: string
  status: string
  total_amount: number
  currency: string
  quote_no?: string
  invoice_no?: string
}

export default function OrdersPage() {
  const ref = useRef<ActionType>()
  const [detailId, setDetailId] = useState<number | null>(null)

  const cols: ProColumns<Order>[] = [
    {
      title: '搜索',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '订单号 / 客户名 / 简称 / 编号', allowClear: true },
    },
    {
      title: '#',
      search: false,
      width: 50,
      render: (_, r: any) => (r._gs > 1 ? <strong>{r._gi}</strong> : '-'),
    },
    {
      title: '客户',
      search: false,
      width: 160,
      ellipsis: true,
      render: (_, r: any) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.customer_short_name || r.customer_name || '-'}</div>
          {r._gs > 1 && (
            <div style={{ fontSize: 11, color: '#1d57e0' }}>共 {r._gs} 单</div>
          )}
        </div>
      ),
      onCell: customerCellMerge,
    },
    { title: '订单号', dataIndex: 'no', search: false, width: 130 },
    {
      title: '金额',
      dataIndex: 'total_amount',
      search: false,
      width: 130,
      render: (_, r: any) => (
        <strong>
          {(r.currency || 'IDR') === 'IDR' ? 'Rp' : '¥'} {Number(r.total_amount).toLocaleString()}
        </strong>
      ),
    },
    {
      title: '进度',
      width: 360,
      search: false,
      render: (_, r: any) => <OrderProgressBar order={r} onClick={() => setDetailId(r.id)} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, { text: v.text }])),
      width: 100,
      render: (_, r) => <Tag color={ORDER_STATUS[r.status]?.color}>{ORDER_STATUS[r.status]?.text || r.status}</Tag>,
    },
    { title: '创建', dataIndex: 'created_at', search: false, width: 110, render: (v: any) => v?.slice(0, 10) },
    {
      title: '操作',
      valueType: 'option',
      width: 60,
      render: (_, r: any) => [
        <a key="d" onClick={() => setDetailId(r.id)}>详情</a>,
      ],
    },
  ]

  return (
    <PageContainer title="订单履约">
      <ProTable<Order>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        request={async (params) => {
          const data = await api.get('listOrders', {
            keyword: (params as any).keyword || '',
            status: params.status,
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: groupByCustomer(data.items || []), total: data.total, success: true }
        }}
      />
      <OrderDetail
        id={detailId}
        onClose={() => {
          setDetailId(null)
          ref.current?.reload()
        }}
      />
    </PageContainer>
  )
}

function OrderDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const r = await api.get('getOrder', { id })
      setData(r)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (id) load()
    else setData(null)
  }, [id])

  if (!id) return null

  const order = data?.order
  const sym = order?.currency === 'CNY' ? '¥' : 'Rp'
  const total = Number(order?.total_amount || 0)
  const paidSum = Number(data?.paid_sum || 0)
  const balance = total - paidSum
  const contracts = data?.contracts || []
  const payments = data?.payments || []
  const commissions = data?.commissions || []

  const stepIdx = (() => {
    if (!order) return 0
    if (order.status === 'completed') return 4
    if (contracts.length === 0 || !contracts.some((c: any) => c.status === 'signed')) return 0
    if (paidSum < total) return 1
    if (!order.invoice_no) return 2
    if (commissions.length > 0 && commissions.some((c: any) => c.status !== 'paid')) return 3
    return 3 // 全部上一步完成但还没点完成
  })()

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={order ? `订单 ${order.no}` : '订单详情'}
      width={960}
      destroyOnClose
      extra={
        order && (
          <Tag color={ORDER_STATUS[order.status]?.color}>
            {ORDER_STATUS[order.status]?.text || order.status}
          </Tag>
        )
      }
    >
      {loading && '加载中...'}
      {order && (
        <>
          <Descriptions column={3} bordered size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="客户">{order.customer_short_name || order.customer_name}</Descriptions.Item>
            <Descriptions.Item label="报价单">{order.quote_no}</Descriptions.Item>
            <Descriptions.Item label="发票号">{order.invoice_no || '-'}</Descriptions.Item>
            <Descriptions.Item label="订单金额">
              <strong>{sym} {total.toLocaleString()}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="已收款">
              <span style={{ color: '#52c41a' }}>{sym} {paidSum.toLocaleString()}</span>
            </Descriptions.Item>
            <Descriptions.Item label="未收余款">
              <span style={{ color: balance > 0 ? '#fa8c16' : '#bfbfbf' }}>
                {sym} {balance.toLocaleString()}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="业务员" span={3}>
              <SalespersonSelector
                value={order.salesperson_id}
                onChange={async (v) => {
                  await api.post('updateOrder', { id: order.id, salesperson_id: v })
                  load()
                }}
              />
            </Descriptions.Item>
          </Descriptions>

          <OrderTimeline
            order={order}
            contracts={contracts}
            payments={payments}
            commissions={commissions}
            paidSum={paidSum}
            sym={sym}
          />

          <Tabs
            items={[
              {
                key: 'contract',
                label: `合同 (${contracts.length})`,
                children: <ContractTab orderId={order.id} contracts={contracts} onChange={load} />,
              },
              {
                key: 'payment',
                label: `付款 (${payments.length})`,
                children: (
                  <PaymentTab
                    orderId={order.id}
                    payments={payments}
                    sym={sym}
                    onChange={load}
                  />
                ),
              },
              {
                key: 'invoice',
                label: '发票',
                children: order.invoice_no ? (
                  <div>
                    <p>发票号：<Typography.Text copyable code>{order.invoice_no}</Typography.Text></p>
                    <p>到期日：{order.invoice_due_at?.slice(0, 10) || '-'}</p>
                    <p>状态：{order.quote_paid_at ? <Tag color="success">已收款</Tag> : <Tag color="orange">待收款</Tag>}</p>
                    <Button type="primary" onClick={() => window.open(`/quotes/${order.quote_id}/invoice`, '_blank')}>
                      打开发票
                    </Button>
                  </div>
                ) : (
                  <Empty
                    description="该订单尚未开具发票"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    <Button
                      type="primary"
                      onClick={async () => {
                        const r = await api.post('issueInvoice', { id: order.quote_id })
                        message.success(`已开具 ${r.invoice_no}`)
                        load()
                      }}
                    >
                      开具发票
                    </Button>
                  </Empty>
                ),
              },
              {
                key: 'commission',
                label: `返佣 (${commissions.length})`,
                children: (
                  <CommissionTab
                    orderId={order.id}
                    commissions={commissions}
                    sym={sym}
                    total={total}
                    onChange={load}
                  />
                ),
              },
              {
                key: 'completion',
                label: order.status === 'completed' ? '✓ 完成' : '完成',
                children: <CompletionTab order={order} onChange={load} />,
              },
            ]}
          />
        </>
      )}
    </Drawer>
  )
}

// =================== 合同 Tab ===================
function ContractTab({ orderId, contracts, onChange }: any) {
  const [editing, setEditing] = useState<any | null>(null)

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          onClick={async () => {
            const r = await api.post('createContract', { order_id: orderId })
            message.success('已生成合同 v' + r.version)
            onChange()
          }}
        >
          + 生成新版合同（默认模板）
        </Button>
      </div>
      {contracts.length === 0 ? (
        <Empty description="还没有合同" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={contracts}
          pagination={false}
          columns={[
            { title: '版本', dataIndex: 'version', width: 60, render: (v) => `v${v}` },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s) => <Tag color={CONTRACT_STATUS[s]?.color}>{CONTRACT_STATUS[s]?.text || s}</Tag>,
            },
            { title: '签订日', dataIndex: 'signed_at', width: 140, render: (v) => v?.slice(0, 10) || '-' },
            {
              title: '签字版',
              width: 130,
              render: (_, r: any) => (
                <VoucherUpload entity="contract" entityId={r.id} current={r.signed_pdf_path} onChange={onChange} />
              ),
            },
            { title: '创建', dataIndex: 'created_at', width: 140, render: (v) => v?.slice(0, 16) },
            {
              title: '操作',
              render: (_, r: any) => (
                <Space>
                  <a onClick={() => setEditing(r)}>查看 / 编辑</a>
                  {r.status === 'pending' && (
                    <a
                      onClick={async () => {
                        await api.post('updateContract', { id: r.id, status: 'signed' })
                        message.success('已标记为已签订')
                        onChange()
                      }}
                    >
                      标记已签订
                    </a>
                  )}
                  <Popconfirm
                    title="删除此版本？"
                    onConfirm={async () => {
                      await api.post('deleteContract', { id: r.id })
                      onChange()
                    }}
                  >
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}
      <ContractEditor
        contract={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          onChange()
        }}
      />
    </div>
  )
}

function ContractEditor({ contract, onClose, onSaved }: any) {
  const [clauses, setClauses] = useState<any[]>([])

  useEffect(() => {
    if (!contract) {
      setClauses([])
      return
    }
    let parsed: any[] = []
    try {
      if (contract.clauses_json) parsed = JSON.parse(contract.clauses_json)
    } catch {}
    // 兼容老数据
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const cn = (contract.content_cn || '').split('\n').filter(Boolean)
      const id2 = (contract.content_id || '').split('\n').filter(Boolean)
      parsed = cn.map((c: string, i: number) => ({
        title_cn: '',
        body_cn: c,
        title_id: '',
        body_id: id2[i] || '',
      }))
    }
    setClauses(parsed)
  }, [contract])

  if (!contract) return null

  const updateClause = (idx: number, patch: any) =>
    setClauses((p) => p.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const insertAfter = (idx: number) =>
    setClauses((p) => [
      ...p.slice(0, idx + 1),
      { title_cn: '', body_cn: '', title_id: '', body_id: '' },
      ...p.slice(idx + 1),
    ])
  const remove = (idx: number) => setClauses((p) => p.filter((_, i) => i !== idx))
  const move = (idx: number, dir: -1 | 1) => {
    if ((idx === 0 && dir === -1) || (idx === clauses.length - 1 && dir === 1)) return
    setClauses((p) => {
      const arr = [...p]
      const [it] = arr.splice(idx, 1)
      arr.splice(idx + dir, 0, it)
      return arr
    })
  }

  return (
    <Modal
      open={!!contract}
      width={980}
      onCancel={onClose}
      title={
        <Space>
          <span>合同 v{contract.version}</span>
          <Tag color="blue">{clauses.length} 条条款</Tag>
        </Space>
      }
      onOk={async () => {
        await api.post('updateContract', { id: contract.id, clauses })
        message.success('已保存')
        onSaved()
      }}
      okText="保存"
      cancelText="关闭"
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
    >
      <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 12 }}>
        每条款包含「中文」+「Bahasa Indonesia」上下排列，同一份合同内呈现。可调整顺序 / 增删条款。
      </div>
      {clauses.map((c, i) => (
        <div
          key={i}
          style={{
            background: '#fafbfc',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            padding: 14,
            marginBottom: 12,
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ color: '#1d57e0' }}>条款 {i + 1}</strong>
            <Space size={4}>
              <Button size="small" type="text" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
              <Button size="small" type="text" onClick={() => move(i, 1)} disabled={i === clauses.length - 1}>↓</Button>
              <Button size="small" type="text" onClick={() => insertAfter(i)}>＋插入</Button>
              <Popconfirm title="删除该条款？" onConfirm={() => remove(i)}>
                <Button size="small" type="text" danger><DeleteOutlined /></Button>
              </Popconfirm>
            </Space>
          </div>
          <Input
            size="small"
            placeholder="中文标题（如：四、付款方式）"
            value={c.title_cn}
            onChange={(e) => updateClause(i, { title_cn: e.target.value })}
            style={{ marginBottom: 6 }}
          />
          <Input.TextArea
            placeholder="中文条款内容"
            value={c.body_cn}
            onChange={(e) => updateClause(i, { body_cn: e.target.value })}
            autoSize={{ minRows: 2, maxRows: 10 }}
            style={{ marginBottom: 8 }}
          />
          <Input
            size="small"
            placeholder="Judul Klausa (Bahasa Indonesia)"
            value={c.title_id}
            onChange={(e) => updateClause(i, { title_id: e.target.value })}
            style={{ marginBottom: 6 }}
          />
          <Input.TextArea
            placeholder="Isi klausa dalam Bahasa Indonesia"
            value={c.body_id}
            onChange={(e) => updateClause(i, { body_id: e.target.value })}
            autoSize={{ minRows: 2, maxRows: 10 }}
          />
        </div>
      ))}
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={() => setClauses((p) => [...p, { title_cn: '', body_cn: '', title_id: '', body_id: '' }])}
      >
        新增条款
      </Button>
    </Modal>
  )
}

// =================== 付款 Tab ===================
function PaymentTab({ orderId, payments, sym, onChange }: any) {
  const [form] = Form.useForm()
  const submit = async () => {
    const v = await form.validateFields()
    await api.post('addPayment', { order_id: orderId, ...v })
    message.success('已记录')
    form.resetFields()
    onChange()
  }
  return (
    <div>
      <Form form={form} layout="inline" style={{ marginBottom: 12 }}>
        <Form.Item name="type" initialValue="deposit" rules={[{ required: true }]}>
          <Select
            style={{ width: 110 }}
            options={Object.entries(PAYMENT_TYPES).map(([k, t]) => ({ value: k, label: t }))}
          />
        </Form.Item>
        <Form.Item name="amount" rules={[{ required: true }]}>
          <InputNumber placeholder={`金额 ${sym}`} min={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="method">
          <Input placeholder="付款方式（银行转账/现金）" style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="remark">
          <Input placeholder="备注" style={{ width: 180 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" onClick={submit}>添加</Button>
        </Form.Item>
      </Form>
      {payments.length === 0 ? (
        <Empty description="还没有付款记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={payments}
          pagination={false}
          columns={[
            { title: '类型', dataIndex: 'type', width: 80, render: (t) => PAYMENT_TYPES[t] || t },
            { title: '金额', dataIndex: 'amount', width: 140, render: (v) => <strong>{sym} {Number(v).toLocaleString()}</strong> },
            { title: '方式', dataIndex: 'method', width: 140 },
            { title: '收款时间', dataIndex: 'paid_at', width: 140, render: (v) => v?.slice(0, 16) },
            {
              title: '凭证',
              width: 140,
              render: (_, r: any) => (
                <VoucherUpload entity="payment" entityId={r.id} current={r.voucher_path} onChange={onChange} />
              ),
            },
            { title: '备注', dataIndex: 'remark', ellipsis: true },
            {
              title: '',
              width: 50,
              render: (_, r: any) => (
                <Popconfirm title="删除？" onConfirm={async () => { await api.post('deletePayment', { id: r.id }); onChange() }}>
                  <a style={{ color: '#ff4d4f' }}>×</a>
                </Popconfirm>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}

// =================== 返佣 Tab ===================
function CommissionTab({ orderId, commissions, sym, total, onChange }: any) {
  const [form] = Form.useForm()
  const submit = async () => {
    const v = await form.validateFields()
    let amount = Number(v.amount || 0)
    if (v.pct && (!amount || amount === 0)) amount = (total * Number(v.pct)) / 100
    await api.post('addCommission', {
      order_id: orderId,
      beneficiary_id: v.beneficiary_id,
      amount,
      rule_snapshot: v.pct ? `${v.pct}%` : '',
      remark: v.remark,
    })
    message.success('已添加')
    form.resetFields()
    onChange()
  }
  return (
    <div>
      <Form form={form} layout="inline" style={{ marginBottom: 12 }}>
        <Form.Item name="beneficiary_id" rules={[{ required: true }]}>
          <SalespersonSelector />
        </Form.Item>
        <Form.Item name="pct">
          <InputNumber placeholder="佣金%" min={0} max={100} addonAfter="%" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="amount">
          <InputNumber placeholder={`或直接填金额 ${sym}`} min={0} style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="remark">
          <Input placeholder="备注" style={{ width: 160 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" onClick={submit}>添加</Button>
        </Form.Item>
      </Form>
      {commissions.length === 0 ? (
        <Empty description="还没有返佣记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={commissions}
          pagination={false}
          columns={[
            { title: '收益人', dataIndex: 'beneficiary_name' },
            { title: '规则', dataIndex: 'rule_snapshot', width: 100 },
            { title: '金额', dataIndex: 'amount', width: 140, render: (v) => `${sym} ${Number(v).toLocaleString()}` },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (s, r: any) => (
                <Select
                  size="small"
                  value={s}
                  style={{ width: 100 }}
                  options={Object.entries(COMMISSION_STATUS).map(([k, v]) => ({ value: k, label: v.text }))}
                  onChange={async (val) => {
                    await api.post('updateCommission', { id: r.id, status: val })
                    onChange()
                  }}
                />
              ),
            },
            { title: '结算时间', dataIndex: 'settled_at', width: 140, render: (v) => v?.slice(0, 16) || '-' },
            {
              title: '凭证',
              width: 140,
              render: (_, r: any) => (
                <VoucherUpload entity="commission" entityId={r.id} current={r.voucher_path} onChange={onChange} />
              ),
            },
            {
              title: '',
              width: 50,
              render: (_, r: any) => (
                <Popconfirm title="删除？" onConfirm={async () => { await api.post('deleteCommission', { id: r.id }); onChange() }}>
                  <a style={{ color: '#ff4d4f' }}>×</a>
                </Popconfirm>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}

/** Drawer 内：大版本时间线，每步显示状态 + 时间 + 关键数据 */
function OrderTimeline({ order, contracts, payments, commissions, paidSum, sym }: any) {
  const total = Number(order.total_amount || 0)
  const cSigned = contracts.find((c: any) => c.status === 'signed')
  const cPending = contracts.filter((c: any) => c.status !== 'signed').length
  const paidPct = total > 0 ? Math.min(100, Math.round((paidSum / total) * 100)) : 0
  const ccPaid = commissions.filter((c: any) => c.status === 'paid').length
  const isDone = order.status === 'completed'

  const stages = [
    {
      key: 'contract',
      title: '① 合同',
      done: !!cSigned,
      current: contracts.length > 0 && !cSigned,
      summary: cSigned
        ? `已签订 v${cSigned.version} · ${cSigned.signed_at?.slice(0, 10)}`
        : contracts.length > 0
        ? `${contracts.length} 版待签`
        : '尚未生成',
      extra: cPending > 0 && !cSigned ? `${cPending} 版等待客户确认` : '',
    },
    {
      key: 'pay',
      title: '② 收款',
      done: total > 0 && paidSum >= total,
      current: paidSum > 0 && paidSum < total,
      summary:
        total === 0
          ? '订单金额为 0'
          : paidSum >= total
          ? `全款已到账 ${sym} ${paidSum.toLocaleString()}`
          : paidSum > 0
          ? `${paidPct}% · ${sym} ${paidSum.toLocaleString()} / ${total.toLocaleString()}`
          : '未收款',
      extra: payments.length > 0 ? `${payments.length} 笔记录` : '',
    },
    {
      key: 'invoice',
      title: '③ 发票',
      done: !!order.invoice_paid_at || !!order.quote_paid_at,
      current: !!order.invoice_no && !order.invoice_paid_at && !order.quote_paid_at,
      summary: order.invoice_no
        ? `已开具 ${order.invoice_no}`
        : '尚未开具',
      extra: order.invoice_due_at ? `到期 ${order.invoice_due_at.slice(0, 10)}` : '',
    },
    {
      key: 'commission',
      title: '④ 返佣',
      done: commissions.length > 0 && ccPaid === commissions.length,
      current: commissions.length > 0 && ccPaid < commissions.length,
      summary:
        commissions.length === 0
          ? '未设置返佣'
          : ccPaid === commissions.length
          ? `${commissions.length} 条全部到账`
          : `${ccPaid}/${commissions.length} 条已到账`,
      extra: '',
    },
    {
      key: 'done',
      title: '⑤ 完成',
      done: isDone,
      current: !isDone && contracts.some((c: any) => c.status === 'signed')
        && paidSum >= total && order.invoice_no
        && (commissions.length === 0 || ccPaid === commissions.length),
      summary: isDone ? `已完成 · ${order.completed_at?.slice(0, 16)}` : '待确认完成',
      extra: '',
    },
  ]

  return (
    <div className="order-timeline" style={{ marginBottom: 24 }}>
      <style>{`
        .order-timeline {
          background: linear-gradient(135deg, #fafcff 0%, #f0f5ff 100%);
          border: 1px solid #e6f0ff;
          border-radius: 10px;
          padding: 16px 20px;
        }
        .ot-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; position: relative; }
        .ot-cell { position: relative; padding-top: 4px; }
        .ot-line {
          position: absolute;
          left: 0; right: 0; top: 12px;
          height: 2px;
          background: #d9d9d9;
          z-index: 0;
        }
        .ot-dot {
          width: 24px; height: 24px;
          border-radius: 50%;
          margin: 0 auto 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 700; color: #fff;
          position: relative; z-index: 1;
          box-shadow: 0 0 0 3px #fff;
        }
        .ot-dot-done    { background: #52c41a; }
        .ot-dot-current { background: #1d57e0; box-shadow: 0 0 0 3px #fff, 0 0 0 5px #bae0ff; }
        .ot-dot-todo    { background: #d9d9d9; }
        .ot-title { font-size: 13px; font-weight: 600; text-align: center; margin-bottom: 2px; }
        .ot-title-done { color: #389e0d; }
        .ot-title-current { color: #1d57e0; }
        .ot-title-todo { color: #8c8c8c; }
        .ot-summary { text-align: center; font-size: 12px; color: #595959; line-height: 1.4; }
        .ot-extra { text-align: center; font-size: 11px; color: #bfbfbf; margin-top: 2px; }
      `}</style>
      <div className="ot-grid">
        {/* 横线（连接圆点）*/}
        <div className="ot-line" style={{ left: '10%', right: '10%' }} />
        {stages.map((s) => {
          const cls = s.done ? 'done' : s.current ? 'current' : 'todo'
          return (
            <div key={s.key} className="ot-cell">
              <div className={`ot-dot ot-dot-${cls}`}>
                {s.done ? '✓' : ''}
              </div>
              <div className={`ot-title ot-title-${cls}`}>{s.title}</div>
              <div className="ot-summary">{s.summary}</div>
              {s.extra && <div className="ot-extra">{s.extra}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 列表行内的横向进度条 — 5 步 + 颜色 + tooltip */
function OrderProgressBar({ order, onClick }: { order: any; onClick?: () => void }) {
  const total = Number(order.total_amount || 0)
  const paid = Number(order.paid_sum || 0)
  const paidPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0

  // 5 步状态：done / current / todo
  const steps: Array<{ key: string; label: string; status: 'done' | 'current' | 'todo'; hint: string }> = []

  // 1. 合同
  const cSigned = Number(order.contracts_signed || 0) > 0
  const cCount = Number(order.contracts_count || 0)
  steps.push({
    key: 'contract',
    label: '合同',
    status: cSigned ? 'done' : cCount > 0 ? 'current' : 'todo',
    hint: cCount === 0 ? '未生成' : cSigned ? `已签订（${cCount} 版）` : `${cCount} 版未签`,
  })

  // 2. 收款
  const paidDone = total > 0 && paid >= total
  steps.push({
    key: 'pay',
    label: '收款',
    status: paidDone ? 'done' : paid > 0 ? 'current' : 'todo',
    hint: paidDone ? '全款已到' : paid > 0 ? `${paidPct}% (${paid.toLocaleString()})` : '未收款',
  })

  // 3. 发票
  const hasInvoice = !!order.invoice_no
  const invoicePaid = !!order.invoice_paid_at
  steps.push({
    key: 'invoice',
    label: '发票',
    status: invoicePaid ? 'done' : hasInvoice ? 'current' : 'todo',
    hint: hasInvoice ? (invoicePaid ? '已开 · 已核销' : '已开 ' + order.invoice_no) : '未开',
  })

  // 4. 返佣
  const ccCount = Number(order.commissions_count || 0)
  const ccPaid = Number(order.commissions_paid || 0)
  steps.push({
    key: 'commission',
    label: '返佣',
    status: ccCount === 0 ? 'todo' : ccPaid === ccCount ? 'done' : 'current',
    hint: ccCount === 0 ? '无' : ccPaid === ccCount ? `${ccCount} 条全部到账` : `${ccPaid}/${ccCount} 已到账`,
  })

  // 5. 完成
  const done = order.status === 'completed'
  steps.push({
    key: 'done',
    label: '完成',
    status: done ? 'done' : 'todo',
    hint: done ? `完成于 ${order.completed_at?.slice(0, 10)}` : '未完成',
  })

  const colorMap = {
    done: { bg: '#52c41a', fg: '#fff', line: '#52c41a' },
    current: { bg: '#1d57e0', fg: '#fff', line: '#bae0ff' },
    todo: { bg: '#f0f0f0', fg: '#8c8c8c', line: '#f0f0f0' },
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      title="点击查看详情"
    >
      {steps.map((s, i) => {
        const c = colorMap[s.status]
        return (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center' }}>
            <span
              title={`${s.label}: ${s.hint}`}
              style={{
                background: c.bg,
                color: c.fg,
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 12,
                whiteSpace: 'nowrap',
                lineHeight: '14px',
                minWidth: 36,
                textAlign: 'center',
              }}
            >
              {s.status === 'done' ? '✓ ' : ''}
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                style={{
                  width: 12,
                  height: 2,
                  background: steps[i + 1].status === 'todo' ? '#f0f0f0' : c.line,
                  margin: '0 2px',
                }}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

/** 完成订单 Tab */
function CompletionTab({ order, onChange }: any) {
  const [remark, setRemark] = useState(order.completion_remark || '')
  const isDone = order.status === 'completed'
  return (
    <div>
      {isDone ? (
        <div style={{
          background: '#f6ffed',
          border: '1px solid #b7eb8f',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}>
          <Space>
            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />
            <span style={{ fontSize: 14 }}>
              订单已于 <strong>{order.completed_at?.slice(0, 16)}</strong> 完成
            </span>
          </Space>
        </div>
      ) : (
        <div style={{
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          fontSize: 13,
        }}>
          确认所有付款已到账、商品已交付、返佣已结清后，点击「确认完成」。
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}>
          <strong>验收单 / 完工凭证</strong>
          <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12 }}>（图片或 PDF）</span>
        </div>
        <VoucherUpload
          entity="order"
          entityId={order.id}
          current={order.completion_voucher_path}
          onChange={onChange}
          size="middle"
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 6 }}><strong>完成备注</strong></div>
        <Input.TextArea
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          rows={3}
          placeholder="交付情况、客户反馈、特殊说明..."
          disabled={isDone}
        />
      </div>

      {!isDone && (
        <Button
          type="primary"
          size="large"
          icon={<CheckCircleOutlined />}
          onClick={async () => {
            await api.post('completeOrder', { id: order.id, remark })
            message.success('订单已标记完成')
            onChange()
          }}
        >
          确认完成订单
        </Button>
      )}
    </div>
  )
}

/** 通用凭证上传 + 预览组件 */
function VoucherUpload({
  entity,
  entityId,
  current,
  onChange,
  size = 'small',
}: {
  entity: 'payment' | 'commission' | 'contract' | 'order'
  entityId: number
  current?: string
  onChange?: () => void
  size?: 'small' | 'middle'
}) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(false)
  const url = current

  const handle = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      message.error('文件不能超过 20MB')
      return false
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('entity', entity)
      fd.append('entity_id', String(entityId))
      await api.upload('uploadVoucher', fd)
      message.success('已上传')
      onChange?.()
    } catch (e: any) {
      message.error(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
    return false
  }

  const isImage = !!url && /\.(png|jpe?g|gif|webp|bmp)$/i.test(url)

  return (
    <Space size={4}>
      {url ? (
        <>
          {isImage ? (
            <a onClick={() => setPreview(true)}>
              <FileImageOutlined /> 查看图片
            </a>
          ) : (
            <a href={url} target="_blank" rel="noreferrer">
              <FileImageOutlined /> 查看附件
            </a>
          )}
          <Upload
            accept="image/*,.pdf"
            showUploadList={false}
            beforeUpload={(f) => { handle(f); return false }}
          >
            <a><UploadOutlined /> 替换</a>
          </Upload>
        </>
      ) : (
        <Upload
          accept="image/*,.pdf"
          showUploadList={false}
          beforeUpload={(f) => { handle(f); return false }}
        >
          <Button size={size as any} icon={<UploadOutlined />} loading={uploading}>
            上传凭证
          </Button>
        </Upload>
      )}
      {isImage && (
        <Image
          src={url}
          style={{ display: 'none' }}
          preview={{ visible: preview, onVisibleChange: setPreview }}
        />
      )}
    </Space>
  )
}

function SalespersonSelector({ value, onChange }: { value?: number | null; onChange?: (v: number) => void }) {
  const [opts, setOpts] = useState<any[]>([])
  useEffect(() => {
    api.get('listSalespersons').then((r) => {
      setOpts((r.items || []).map((s: any) => ({
        value: s.id,
        label: `${s.name}${s.type === 'partner' ? '（合伙人）' : ''}`,
      })))
    })
  }, [])
  return (
    <Select
      placeholder="选业务员/合伙人"
      style={{ width: 200 }}
      value={value || undefined}
      onChange={onChange}
      options={opts}
      allowClear
    />
  )
}
