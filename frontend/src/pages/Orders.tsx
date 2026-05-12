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
} from 'antd'
import { api } from '../api'

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
    { title: '订单号', dataIndex: 'no', search: false },
    { title: '客户', search: false, render: (_, r: any) => r.customer_short_name || r.customer_name || '-' },
    { title: '关联报价', dataIndex: 'quote_no', search: false },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, { text: v.text }])),
      render: (_, r) => <Tag color={ORDER_STATUS[r.status]?.color}>{ORDER_STATUS[r.status]?.text || r.status}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      search: false,
      render: (_, r: any) => `${(r.currency || 'IDR') === 'IDR' ? 'Rp' : '¥'} ${Number(r.total_amount).toLocaleString()}`,
    },
    { title: '发票', dataIndex: 'invoice_no', search: false },
    { title: '创建', dataIndex: 'created_at', search: false },
    {
      title: '操作',
      valueType: 'option',
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
          return { data: data.items, total: data.total, success: true }
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
    if (contracts.length === 0) return 0
    if (paidSum < total) return 1
    if (!order.invoice_no) return 2
    if (commissions.some((c: any) => c.status !== 'paid')) return 3
    return 4
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

          <Steps
            size="small"
            current={stepIdx}
            items={[
              { title: '合同' },
              { title: '收款' },
              { title: '发票' },
              { title: '返佣' },
              { title: '完成' },
            ]}
            style={{ marginBottom: 24 }}
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
  const [cn, setCn] = useState('')
  const [id, setId] = useState('')
  useEffect(() => {
    if (contract) {
      setCn(contract.content_cn || '')
      setId(contract.content_id || '')
    }
  }, [contract])
  if (!contract) return null
  return (
    <Modal
      open={!!contract}
      width={1100}
      onCancel={onClose}
      title={`合同 v${contract.version}`}
      onOk={async () => {
        await api.post('updateContract', { id: contract.id, content_cn: cn, content_id: id })
        message.success('已保存')
        onSaved()
      }}
      okText="保存"
      cancelText="关闭"
    >
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Typography.Text strong>中文版</Typography.Text>
          <Input.TextArea
            value={cn}
            onChange={(e) => setCn(e.target.value)}
            autoSize={{ minRows: 16, maxRows: 30 }}
            style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Typography.Text strong>Bahasa Indonesia</Typography.Text>
          <Input.TextArea
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoSize={{ minRows: 16, maxRows: 30 }}
          />
        </div>
      </div>
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
