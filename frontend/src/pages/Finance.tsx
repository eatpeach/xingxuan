import { useEffect, useState } from 'react'
import { PageContainer } from '@ant-design/pro-components'
import { Button, Card, Empty, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { api } from '../api'

/**
 * 财务管理（财务工作台）
 *
 * 三件事：
 * 1. 客户收款确认——销售录的收款先是 pending，财务核对银行流水后点确认，才计入已收金额
 * 2. 尾款追踪——只收了首款 / 部分开票的单子，差额都在这里，不用一单单点进去看
 * 3. 退款处理——多收、订单取消、客户要求退回；财务标记「已退款」后从已收金额里扣掉
 *
 * 权限：确认 / 处理退款只对 admin / finance 显示，后端也会各拦一遍。
 */

const money = (currency: string, v: any) =>
  `${currency === 'CNY' ? '¥' : 'Rp'} ${Math.round(Number(v || 0)).toLocaleString()}`

export default function FinancePage() {
  const [tab, setTab] = useState<'pending' | 'receivable' | 'refund'>('pending')
  const [pending, setPending] = useState<any[]>([])
  const [receivables, setReceivables] = useState<any[]>([])
  const [refunds, setRefunds] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [voucher, setVoucher] = useState<string | null>(null)
  const canConfirm = ['admin', 'finance'].includes(localStorage.getItem('role') || '')

  const load = async () => {
    setLoading(true)
    try {
      const [p, r, rf] = await Promise.all([
        api.get('listPendingPayments'),
        api.get('listReceivables'),
        api.get('listRefunds'),
      ])
      setPending(p.items || [])
      setReceivables(r.items || [])
      setRefunds(rf.items || [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const confirm = async (id: number) => {
    await api.post('confirmPayment', { id })
    message.success('已确认到账')
    load()
  }

  const pendingCols = [
    { title: '订单号', dataIndex: 'order_no', width: 150 },
    {
      title: '客户',
      width: 150,
      render: (_: any, r: any) => r.customer_short_name || r.customer_name || '-',
      ellipsis: true,
    },
    {
      title: '本次收款',
      width: 150,
      align: 'right' as const,
      render: (_: any, r: any) => <strong>{money(r.currency, r.amount)}</strong>,
    },
    { title: '比例', dataIndex: 'payment_ratio', width: 70, render: (v: any) => v || '-' },
    {
      title: '订单总额',
      width: 150,
      align: 'right' as const,
      render: (_: any, r: any) => (
        <span style={{ color: '#888' }}>{money(r.currency, r.total_amount)}</span>
      ),
    },
    {
      title: '发票',
      width: 140,
      render: (_: any, r: any) => (r.invoice_no ? <Tag color="blue">{r.invoice_no}</Tag> : <span style={{ color: '#bbb' }}>未开</span>),
    },
    { title: '录入时间', dataIndex: 'paid_at', width: 150, render: (v: any) => v?.slice(0, 16) },
    {
      title: '付款凭证',
      width: 100,
      render: (_: any, r: any) =>
        r.voucher_path ? (
          <a onClick={() => setVoucher(r.voucher_path)}>查看</a>
        ) : (
          <Tooltip title="销售还没上传付款凭证，确认前建议先核对银行流水">
            <span style={{ color: '#fa8c16' }}>无凭证</span>
          </Tooltip>
        ),
    },
    { title: '备注', dataIndex: 'remark', ellipsis: true },
    {
      title: '操作',
      width: 90,
      fixed: 'right' as const,
      render: (_: any, r: any) =>
        canConfirm ? (
          <Popconfirm
            title="确认这笔款已到账？"
            description="确认后计入已收金额，可再撤销"
            onConfirm={() => confirm(r.id)}
          >
            <a>确认到账</a>
          </Popconfirm>
        ) : (
          <span style={{ color: '#bbb' }}>待财务</span>
        ),
    },
  ]

  const recvCols = [
    { title: '订单号', dataIndex: 'order_no', width: 150 },
    {
      title: '客户',
      width: 150,
      render: (_: any, r: any) => r.customer_short_name || r.customer_name || '-',
      ellipsis: true,
    },
    {
      title: '订单总额',
      width: 150,
      align: 'right' as const,
      render: (_: any, r: any) => money(r.currency, r.total_amount),
    },
    {
      title: '已收（已确认）',
      width: 150,
      align: 'right' as const,
      render: (_: any, r: any) => (
        <span style={{ color: '#52c41a' }}>{money(r.currency, r.paid_sum)}</span>
      ),
    },
    {
      title: '待收尾款',
      width: 160,
      align: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          <strong style={{ color: '#fa8c16' }}>{money(r.currency, r.balance)}</strong>
          {Number(r.pending_sum || 0) > 0 && (
            <Tooltip title={`另有 ${money(r.currency, r.pending_sum)} 已录入待财务确认`}>
              <Tag color="orange">待确认</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '发票',
      width: 190,
      render: (_: any, r: any) =>
        r.invoice_no ? (
          <Space size={4} wrap>
            <a onClick={() => window.open(`/quotes/${r.quote_id || ''}/invoice`, '_blank')}>{r.invoice_no}</a>
            {Number(r.invoice_amount || 0) > 0
              && Number(r.invoice_amount) < Number(r.total_amount) - 0.005 && (
              <Tooltip title={`这张发票只开了 ${money(r.currency, r.invoice_amount)}，不是全额`}>
                <Tag>部分开票</Tag>
              </Tooltip>
            )}
          </Space>
        ) : (
          <span style={{ color: '#bbb' }}>未开票</span>
        ),
    },
    {
      title: '到期日',
      width: 130,
      render: (_: any, r: any) =>
        r.invoice_due_at ? (
          <span style={{ color: r.overdue ? '#ff4d4f' : undefined }}>
            {String(r.invoice_due_at).slice(0, 10)}
            {r.overdue && <Tag color="red" style={{ marginLeft: 6 }}>已逾期</Tag>}
          </span>
        ) : (
          <span style={{ color: '#bbb' }}>-</span>
        ),
    },
  ]

  const REFUND_STATUS: Record<string, { text: string; color: string }> = {
    pending: { text: '待处理', color: 'orange' },
    done: { text: '已退款', color: 'green' },
    rejected: { text: '已驳回', color: 'default' },
  }

  const refundCols = [
    { title: '订单号', dataIndex: 'order_no', width: 150 },
    {
      title: '客户',
      width: 140,
      render: (_: any, r: any) => r.customer_short_name || r.customer_name || '-',
      ellipsis: true,
    },
    {
      title: '退款金额',
      width: 140,
      align: 'right' as const,
      render: (_: any, r: any) => <strong style={{ color: '#ff4d4f' }}>{money(r.currency, r.amount)}</strong>,
    },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '状态',
      width: 90,
      render: (_: any, r: any) => (
        <Tag color={REFUND_STATUS[r.status]?.color}>{REFUND_STATUS[r.status]?.text || r.status}</Tag>
      ),
    },
    {
      title: '申请 / 处理',
      width: 170,
      render: (_: any, r: any) => (
        <div style={{ fontSize: 12, color: '#888' }}>
          <div>{r.created_by_name || '-'} {String(r.created_at || '').slice(5, 16)}</div>
          {r.handled_at && <div>经办 {r.handled_by_name || '-'} {String(r.handled_at).slice(5, 16)}</div>}
        </div>
      ),
    },
    {
      title: '退款凭证',
      width: 100,
      render: (_: any, r: any) =>
        r.voucher_path ? <a onClick={() => setVoucher(r.voucher_path)}>查看</a> : <span style={{ color: '#bbb' }}>无</span>,
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, r: any) =>
        canConfirm ? (
          <Space size={8}>
            {r.status !== 'done' && (
              <Popconfirm
                title="确认已完成退款？"
                description="确认后从该订单的已收金额里扣除"
                onConfirm={async () => {
                  await api.post('handleRefund', { id: r.id, status: 'done' })
                  message.success('已标记为已退款')
                  load()
                }}
              >
                <a>已退款</a>
              </Popconfirm>
            )}
            {r.status === 'pending' && (
              <Popconfirm
                title="驳回这笔退款申请？"
                onConfirm={async () => {
                  await api.post('handleRefund', { id: r.id, status: 'rejected' })
                  message.success('已驳回')
                  load()
                }}
              >
                <a style={{ color: '#fa8c16' }}>驳回</a>
              </Popconfirm>
            )}
            <Popconfirm
              title="删除这条退款记录？"
              onConfirm={async () => {
                await api.post('deleteRefund', { id: r.id })
                message.success('已删除')
                load()
              }}
            >
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>
          </Space>
        ) : (
          <span style={{ color: '#bbb' }}>待财务</span>
        ),
    },
  ]

  const overdueCount = receivables.filter((r) => r.overdue).length
  const pendingRefundCount = refunds.filter((r) => r.status === 'pending').length

  return (
    <PageContainer
      header={{ title: '财务管理' }}
      tabList={[
        { tab: `客户收款确认 (${pending.length})`, key: 'pending' },
        { tab: `尾款追踪 (${receivables.length})`, key: 'receivable' },
        { tab: `退款处理${pendingRefundCount ? ` (${pendingRefundCount})` : ''}`, key: 'refund' },
      ]}
      tabActiveKey={tab}
      onTabChange={(k) => setTab(k as any)}
      extra={[<Button key="r" onClick={load}>刷新</Button>]}
    >
      {tab === 'pending' ? (
        <Card>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            销售录入的收款要财务在这里核对确认，确认后才计入订单的「已收款」。确认前建议先看付款凭证或银行流水。
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={pending}
            columns={pendingCols}
            pagination={false}
            scroll={{ x: 1300 }}
            locale={{ emptyText: <Empty description="没有待确认的收款" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      ) : tab === 'receivable' ? (
        <Card>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            只算已确认到账的收款（已退款的会扣掉），差额就是还没收回来的钱。
            {overdueCount > 0 && (
              <span style={{ color: '#ff4d4f', marginLeft: 8 }}>其中 {overdueCount} 单发票已过期未收齐。</span>
            )}
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={receivables}
            columns={recvCols}
            pagination={false}
            scroll={{ x: 1250 }}
            locale={{ emptyText: <Empty description="所有订单都已收齐" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      ) : (
        <Card>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            多收、订单取消、客户要求退回都走这里。标记「已退款」后，该笔金额会从订单的已收金额里扣除，
            尾款追踪也会跟着变。退款凭证可在标记后上传留档。
          </Typography.Paragraph>
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={refunds}
            columns={refundCols}
            pagination={false}
            scroll={{ x: 1200 }}
            locale={{ emptyText: <Empty description="没有退款记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      )}

      <Modal
        open={!!voucher}
        title="付款凭证"
        footer={null}
        onCancel={() => setVoucher(null)}
        width={720}
      >
        {voucher && (
          /\.pdf$/i.test(voucher) ? (
            <iframe src={`/backend/storage/${voucher}`} style={{ width: '100%', height: 560, border: 0 }} />
          ) : (
            <img src={`/backend/storage/${voucher}`} alt="凭证" style={{ width: '100%' }} />
          )
        )}
      </Modal>
    </PageContainer>
  )
}
