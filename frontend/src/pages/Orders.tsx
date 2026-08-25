import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import {
  Button,
  Card,
  DatePicker,
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
  Radio,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileImageOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { ProFormSelect } from '@ant-design/pro-components'
import dayjs, { Dayjs } from 'dayjs'
import { api } from '../api'
import { customerCellMergeWithClass, customerRowClass, groupByCustomer } from '../utils/groupByCustomer'
import IssueInvoiceButton from './IssueInvoiceButton'
import MarkInvoicePaidButton from './MarkInvoicePaidButton'
import EditQuoteItemsButton from './EditQuoteItemsButton'
import SupplierBreakdown, { SupplierTags } from './SupplierBreakdown'
import { convertPdfToImageIfNeeded } from '../utils/pdfToImages'

export const ORDER_STATUS: Record<string, { color: string; text: string }> = {
  pending_contract: { color: 'orange', text: '待签合同' },
  in_progress: { color: 'processing', text: '履约中' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
}

/**
 * 无合同成交的单，状态别再叫「待签合同」—— 这单压根不打算签，
 * 那个字眼会让人以为还有事没办。
 */
function orderStatusTag(o: any): { color: string; text: string } {
  const base = ORDER_STATUS[o?.status] || { color: 'default', text: o?.status || '-' }
  if (o?.flow_mode === 'simple' && o?.status === 'pending_contract') {
    return { color: 'orange', text: '待收款' }
  }
  return base
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
  const [suppliers, setSuppliers] = useState<Array<{ supplier_name: string; cnt: number; total: number }>>([])
  const [supplierFilter, setSupplierFilter] = useState<string>('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkSupplierOpen, setBulkSupplierOpen] = useState(false)
  const [bulkSupplierValue, setBulkSupplierValue] = useState('')

  const loadSuppliers = async () => {
    const r = await api.get('listOrderSuppliers')
    setSuppliers(r.items || [])
  }
  useEffect(() => { loadSuppliers() }, [])

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
      onCell: customerCellMergeWithClass,
    },
    {
      title: '供应商',
      dataIndex: 'supplier_name',
      search: false,
      width: 150,
      // 多供应商时 supplier_name 存成 "A / B / C"，这里拆成多个标签
      render: (v: any) => {
        const names = String(v || '').split('/').map((x) => x.trim()).filter(Boolean)
        if (names.length === 0) return <span style={{ color: '#bfbfbf' }}>-</span>
        return (
          <Space size={[2, 2]} wrap>
            {names.slice(0, 2).map((n, i) => (
              <Tag key={i} color="purple" style={{ marginInlineEnd: 0 }}>{n}</Tag>
            ))}
            {names.length > 2 && (
              <Tooltip title={names.join(' / ')}>
                <Tag style={{ marginInlineEnd: 0 }}>+{names.length - 2}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
    { title: '订单号', dataIndex: 'no', search: false, width: 130 },
    { title: '合同号', dataIndex: 'contract_no', search: false, width: 130, render: (v: any) => v || '-' },
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
      render: (_, r) => <Tag color={orderStatusTag(r).color}>{orderStatusTag(r).text}</Tag>,
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
      {suppliers.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }} bodyStyle={{ padding: '8px 12px' }}>
          <Space wrap size={6}>
            <span style={{ color: '#8c8c8c', fontSize: 12, marginRight: 4 }}>按供应商：</span>
            <Tag.CheckableTag
              checked={supplierFilter === ''}
              onChange={() => { setSupplierFilter(''); ref.current?.reload() }}
              style={{ fontSize: 13, padding: '4px 10px' }}
            >
              全部
            </Tag.CheckableTag>
            {suppliers.map((s) => (
              <Tag.CheckableTag
                key={s.supplier_name}
                checked={supplierFilter === s.supplier_name}
                onChange={() => {
                  setSupplierFilter((p) => (p === s.supplier_name ? '' : s.supplier_name))
                  setTimeout(() => ref.current?.reload(), 0)
                }}
                style={{ fontSize: 13, padding: '4px 10px' }}
              >
                {s.supplier_name}
                <span style={{ marginLeft: 4, opacity: 0.7 }}>({s.cnt})</span>
              </Tag.CheckableTag>
            ))}
          </Space>
        </Card>
      )}
      <ProTable<Order>
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
          preserveSelectedRowKeys: true,
        }}
        tableAlertRender={({ selectedRowKeys, onCleanSelected }) => (
          <Space size={16} wrap>
            <span>
              已选 <strong style={{ color: '#1d57e0' }}>{selectedRowKeys.length}</strong> 单
            </span>
            <Button type="primary" size="small" onClick={() => {
              setBulkSupplierValue('')
              setBulkSupplierOpen(true)
            }}>
              批量改供应商
            </Button>
            <Popconfirm
              title={`删除 ${selectedRowKeys.length} 单？`}
              description="将同时删除关联报价单 / 付款 / 返佣记录。不可撤销。"
              okText="删除"
              okType="danger"
              onConfirm={async () => {
                await api.post('bulkDeleteOrders', { ids: selectedRowKeys })
                message.success(`已删除 ${selectedRowKeys.length} 单`)
                setSelectedIds([])
                onCleanSelected()
                ref.current?.reload()
                loadSuppliers()
              }}
            >
              <Button danger size="small">批量删除</Button>
            </Popconfirm>
            <a onClick={onCleanSelected}>取消选择</a>
          </Space>
        )}
        tableAlertOptionRender={() => null}
        headerTitle="订单履约"
        toolBarRender={() => [
          <BatchImportButton key="bi" onCreated={() => { ref.current?.reload(); loadSuppliers() }} />,
          <ImportHistoricalOrderButton key="imp" onCreated={() => { ref.current?.reload(); loadSuppliers() }} />,
        ] as any}
        actionRef={ref}
        rowKey="id"
        columns={cols}
        bordered
        onRow={(r: any) => customerRowClass(r)}
        request={async (params) => {
          const data = await api.get('listOrders', {
            keyword: (params as any).keyword || '',
            status: params.status,
            supplier_name: supplierFilter || '',
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
      <Modal
        title={`批量改供应商（${selectedIds.length} 单）`}
        open={bulkSupplierOpen}
        onCancel={() => setBulkSupplierOpen(false)}
        onOk={async () => {
          if (selectedIds.length === 0) return
          await api.post('bulkUpdateOrderSupplier', {
            ids: selectedIds,
            supplier_name: bulkSupplierValue.trim(),
          })
          message.success(`已更新 ${selectedIds.length} 单`)
          setBulkSupplierOpen(false)
          setSelectedIds([])
          ref.current?.reload()
          loadSuppliers()
        }}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: '#8c8c8c', fontSize: 12 }}>
          选中的 {selectedIds.length} 单将全部改为下列供应商；留空 = 清掉供应商标签。
        </div>
        <Space wrap size={6} style={{ marginBottom: 12 }}>
          {suppliers.map((s) => (
            <Tag.CheckableTag
              key={s.supplier_name}
              checked={bulkSupplierValue === s.supplier_name}
              onChange={() => setBulkSupplierValue(s.supplier_name)}
              style={{ fontSize: 13, padding: '4px 10px' }}
            >
              {s.supplier_name}
            </Tag.CheckableTag>
          ))}
        </Space>
        <Input
          value={bulkSupplierValue}
          onChange={(e) => setBulkSupplierValue(e.target.value)}
          placeholder="选上方已有的或自己输入新供应商，如：神州电缆"
          autoFocus
        />
      </Modal>
    </PageContainer>
  )
}

export function OrderDetail({
  id,
  onClose,
  defaultTab,
  embedded,
}: {
  id: number | null
  onClose: () => void
  /** 打开时直接定位到某个 Tab（商机「收款」步骤点「收款」进来时用 'payment'） */
  defaultTab?: string
  /** 内嵌模式：不套 Drawer，内容直接平铺到调用方页面里 */
  embedded?: boolean
}) {
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
  const pendingSum = Number(data?.pending_sum || 0)
  const balance = total - paidSum
  const contracts = data?.contracts || []
  const orderSuppliers = data?.suppliers || []
  const payments = data?.payments || []
  const commissions = data?.commissions || []
  const refunds = data?.refunds || []

  const stepIdx = (() => {
    if (!order) return 0
    if (order.status === 'completed') return 4
    if (contracts.length === 0 || !contracts.some((c: any) => c.status === 'signed')) return 0
    if (paidSum < total) return 1
    if (!order.invoice_no) return 2
    if (commissions.length > 0 && commissions.some((c: any) => c.status !== 'paid')) return 3
    return 3 // 全部上一步完成但还没点完成
  })()

  const body = (
    <>
      {loading && '加载中...'}
      {order && (
        <>
          {/* 内嵌进商机「收款」步骤时，这些信息上方订单表里已经有了，不再重复占屏；
              时间线同理。只把业务员选择器单独留出来（返佣要用，别处没有入口） */}
          {embedded ? (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#888' }}>业务员</span>
              <SalespersonSelector
                value={order.salesperson_id}
                onChange={async (v) => {
                  await api.post('updateOrder', { id: order.id, salesperson_id: v })
                  load()
                }}
              />
            </div>
          ) : (
          <Descriptions column={3} bordered size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="客户">{order.customer_short_name || order.customer_name}</Descriptions.Item>
            <Descriptions.Item label="供应商">
              <SupplierTags suppliers={orderSuppliers} />
            </Descriptions.Item>
            <Descriptions.Item label="合同号">{order.contract_no || '-'}</Descriptions.Item>
            <Descriptions.Item label="报价单">{order.quote_no}</Descriptions.Item>
            <Descriptions.Item label="发票号">{order.invoice_no || '-'}</Descriptions.Item>
            <Descriptions.Item label="订单金额">
              <strong>{sym} {total.toLocaleString()}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="已收款">
              <span style={{ color: '#52c41a' }}>{sym} {paidSum.toLocaleString()}</span>
              {/* 待财务确认的单独标出来，否则销售会以为钱没到账 */}
              {pendingSum > 0 && (
                <Tag color="orange" style={{ marginLeft: 8 }}>
                  另有 {sym} {pendingSum.toLocaleString()} 待财务确认
                </Tag>
              )}
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
          )}

          {!embedded && (
            <OrderTimeline
              order={order}
              contracts={contracts}
              payments={payments}
              commissions={commissions}
              paidSum={paidSum}
              sym={sym}
              onChanged={load}
            />
          )}

          <Tabs
            // key 里带上 defaultTab：Drawer 不卸载时 defaultActiveKey 不会重新生效，
            // 换 key 强制重挂才能保证「点收款进来就落在付款页」
            key={`${id}-${defaultTab || ''}`}
            defaultActiveKey={defaultTab || 'contract'}
            items={[
              {
                key: 'suppliers',
                label: `供应商${orderSuppliers.filter((g: any) => g.supplier_id !== null).length > 1 ? ` (${orderSuppliers.filter((g: any) => g.supplier_id !== null).length} 家)` : ''}`,
                children: (
                  <div>
                    <div style={{ marginBottom: 10, fontSize: 12, color: '#8c8c8c' }}>
                      按报价明细里每行选中的供应商实时拆分。展开任一行可看该供应商具体供哪几项 —— 下单时照这个给各家发单。
                    </div>
                    <SupplierBreakdown suppliers={orderSuppliers} currency={order.currency} />
                  </div>
                ),
              },
              {
                key: 'contract',
                label: order.flow_mode === 'simple'
                  ? `合同 (${contracts.length}) · 本单不签`
                  : `合同 (${contracts.length})`,
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
                    total={total}
                    currency={order.currency}
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
                    <Space wrap>
                      <Button type="primary" onClick={() => window.open(`/quotes/${order.quote_id}/invoice`, '_blank')}>
                        打开发票
                      </Button>
                      {/* 20260810-11：发票级「标记已收款/撤销」入口，独立组件（不从死文件 Quotes.tsx 引） */}
                      <MarkInvoicePaidButton
                        quoteId={order.quote_id}
                        paid={!!order.quote_paid_at}
                        onChange={load}
                      />
                      {/* 20260824：收款后客户改需求也能原地改单，改完自动同步本订单金额 */}
                      <EditQuoteItemsButton
                        quote={{
                          id: order.quote_id,
                          no: order.quote_no,
                          currency: order.currency,
                          total: order.total_amount,
                          paid_at: order.quote_paid_at,
                          deal_status: 'won',
                        }}
                        onSaved={load}
                      />
                    </Space>
                    <div style={{ marginTop: 10, fontSize: 12, color: '#8c8c8c' }}>
                      客户付款后有变动（加减产品 / 改数量），点「修改报价单」原地改，
                      订单金额会自动跟着更新，发票号和已收款记录不受影响。
                    </div>
                  </div>
                ) : (
                  <Empty
                    description="该订单尚未开具发票"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  >
                    {/* 20260808-06：开票必须带上收款主体+账户，弹窗在 IssueInvoiceButton 里 */}
                    <IssueInvoiceButton
                      quoteId={order.quote_id}
                      onIssued={load}
                      openAfterIssue={false}
                    />
                  </Empty>
                ),
              },
              {
                key: 'refund',
                label: `退款 (${refunds.length})`,
                children: (
                  <RefundTab
                    orderId={order.id}
                    refunds={refunds}
                    sym={sym}
                    refundable={paidSum}
                    onChange={load}
                  />
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
    </>
  )

  // 内嵌模式：直接平铺进商机「收款」步骤，不再弹抽屉（弹窗套弹窗太深，找不到东西）
  if (embedded) return body

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={order ? `订单 ${order.no}` : '订单详情'}
      width={960}
      destroyOnClose
      extra={
        order && (
          <Tag color={orderStatusTag(order).color}>
            {orderStatusTag(order).text}
          </Tag>
        )
      }
    >
      {body}
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
function PaymentTab({ orderId, payments, sym, total, currency, onChange }: any) {
  const [form] = Form.useForm()
  const [accounts, setAccounts] = useState<any[]>([])
  const [company, setCompany] = useState('星选建材')
  const isFirst = (payments?.length || 0) === 0
  // 财务/管理员才能确认到账（后端 confirmPayment 同样校验，前端只是少给个入口）
  const canConfirm = ['admin', 'finance'].includes(localStorage.getItem('role') || '')
  const [ratio, setRatio] = useState<string>(isFirst ? '50%' : '100%')
  const [customRatio, setCustomRatio] = useState<number | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  /** 录款时选中的付款凭证，addPayment 拿到 id 后再上传 */
  const [voucherFile, setVoucherFile] = useState<File | null>(null)

  useEffect(() => {
    api.get('listPaymentAccounts', { only_active: 1 })
      .then((r: any) => setAccounts((r.items || []).filter((a: any) => !currency || a.currency === currency)))
      .catch(() => {})
    api.get('listSettings')
      .then((r: any) => {
        const sm: Record<string, string> = Object.fromEntries((r.items || []).map((s: any) => [s.key, s.value]))
        if (sm.company_name) setCompany(sm.company_name)
      })
      .catch(() => {})
  }, [currency])

  const pct = ratio === 'custom' ? Number(customRatio || 0) : Number(String(ratio).replace('%', ''))
  useEffect(() => {
    if (pct > 0 && Number(total) > 0) setAmount(Math.round(Number(total) * pct / 100))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, customRatio, total])

  const submit = async () => {
    const v = await form.validateFields()
    const amt = Number(amount || 0)
    if (amt <= 0) { message.warning('请填写收款金额'); return }
    if (isFirst && Number(total) > 0 && amt + 0.005 < Number(total) * 0.5) {
      message.warning('首款不得低于订单总额的 50%'); return
    }
    const r: any = await api.post('addPayment', {
      order_id: orderId,
      type: v.type,
      amount: amt,
      payment_ratio: ratio === 'custom' ? `${customRatio}%` : ratio,
      account_id: v.account_id,
      remark: v.remark || '',
    })
    // 录款时选的付款凭证，等拿到收款记录 id 再传上去
    if (voucherFile && r?.id) {
      try {
        const fd = new FormData()
        fd.append('file', voucherFile)
        fd.append('entity', 'payment')
        fd.append('entity_id', String(r.id))
        await api.upload('uploadVoucher', fd)
      } catch (e: any) {
        message.warning(`收款已记录，但凭证上传失败：${e?.message || ''}。可在下方列表补传`)
      }
    }
    message.success('已记录，等财务确认到账后才计入已收金额')
    form.resetFields()
    setAmount(null); setRatio(isFirst ? '50%' : '100%'); setCustomRatio(null); setVoucherFile(null)
    onChange()
  }

  return (
    <div>
      <div style={{ marginBottom: 12, padding: '6px 10px', background: '#f6f8fb', borderRadius: 6, fontSize: 13 }}>
        收款方抬头：<strong>{company}</strong>
        {isFirst && <span style={{ color: '#d46b00', marginLeft: 12 }}>首款不得低于订单总额 50%</span>}
      </div>
      <Form form={form} layout="inline" style={{ marginBottom: 12, rowGap: 8 }}>
        <Form.Item name="type" initialValue="deposit" rules={[{ required: true }]}>
          <Select
            style={{ width: 110 }}
            options={Object.entries(PAYMENT_TYPES).map(([k, t]) => ({ value: k, label: t }))}
          />
        </Form.Item>
        <Form.Item label="比例">
          <Radio.Group value={ratio} onChange={(e) => setRatio(e.target.value)} optionType="button" buttonStyle="solid">
            <Radio.Button value="100%">全款</Radio.Button>
            <Radio.Button value="50%">50%</Radio.Button>
            <Radio.Button value="custom">手写</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {ratio === 'custom' && (
          <Form.Item>
            <InputNumber min={50} max={100} addonAfter="%" placeholder="≥50" value={customRatio} onChange={(n) => setCustomRatio(n as number)} style={{ width: 120 }} />
          </Form.Item>
        )}
        <Form.Item>
          <InputNumber
            placeholder={`金额 ${sym}`}
            min={0}
            value={amount}
            onChange={(v) => setAmount(v as number)}
            style={{ width: 160 }}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number(String(v).replace(/,/g, '')) as any}
          />
        </Form.Item>
        <Form.Item name="account_id" rules={[{ required: true, message: '选收款账户' }]}>
          <Select
            style={{ width: 240 }}
            placeholder="收款账户"
            options={accounts.map((a: any) => ({ value: Number(a.id), label: `${a.bank_name || ''} ${a.account_number || ''}`.trim() }))}
          />
        </Form.Item>
        <Form.Item name="remark">
          <Input placeholder="备注" style={{ width: 160 }} />
        </Form.Item>
        {/* 付款凭证：录款时就能选，提交后自动挂到这笔收款上（也可事后在下方列表补传） */}
        <Form.Item>
          <Upload
            accept="image/*,.pdf"
            showUploadList={false}
            beforeUpload={(file) => {
              if (file.size > 20 * 1024 * 1024) {
                message.error('文件不能超过 20MB')
                return false
              }
              setVoucherFile(file)
              return false
            }}
          >
            <Button icon={<UploadOutlined />}>{voucherFile ? '已选凭证' : '付款凭证'}</Button>
          </Upload>
          {voucherFile && (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#52c41a' }}>
              {voucherFile.name.length > 14 ? voucherFile.name.slice(0, 14) + '…' : voucherFile.name}
              <a style={{ marginLeft: 6, color: '#ff4d4f' }} onClick={() => setVoucherFile(null)}>×</a>
            </span>
          )}
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
          // 列多（加了到账状态后更宽），不给 scroll 的话凭证列会被挤出视野
          scroll={{ x: 1080 }}
          columns={[
            { title: '类型', dataIndex: 'type', width: 80, render: (t) => PAYMENT_TYPES[t] || t },
            { title: '金额', dataIndex: 'amount', width: 140, render: (v) => <strong>{sym} {Number(v).toLocaleString()}</strong> },
            { title: '比例', dataIndex: 'payment_ratio', width: 70, render: (v) => v || '-' },
            {
              title: '到账状态',
              width: 190,
              render: (_, r: any) => {
                const confirmed = r.status === 'confirmed'
                return (
                  <Space size={6}>
                    <Tag color={confirmed ? 'success' : 'orange'}>{confirmed ? '已确认到账' : '待财务确认'}</Tag>
                    {/* 确认/撤销只对财务和管理员开放，后端同样拦一遍 */}
                    {canConfirm && !confirmed && (
                      <Popconfirm
                        title="确认这笔款已到账？"
                        description="确认后才计入已收金额"
                        onConfirm={async () => {
                          await api.post('confirmPayment', { id: r.id })
                          message.success('已确认到账')
                          onChange()
                        }}
                      >
                        <a>确认</a>
                      </Popconfirm>
                    )}
                    {canConfirm && confirmed && (
                      <Popconfirm
                        title="撤销确认？"
                        description="撤销后这笔款不再计入已收金额"
                        onConfirm={async () => {
                          await api.post('unconfirmPayment', { id: r.id })
                          message.success('已撤销确认')
                          onChange()
                        }}
                      >
                        <a style={{ color: '#fa8c16' }}>撤销</a>
                      </Popconfirm>
                    )}
                  </Space>
                )
              },
            },
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
// =================== 退款 Tab ===================
/** 退款申请 + 处理。已退款(done)的会从订单已收金额里扣掉，尾款追踪同步变化 */
function RefundTab({ orderId, refunds, sym, refundable, onChange }: any) {
  const [form] = Form.useForm()
  const canHandle = ['admin', 'finance'].includes(localStorage.getItem('role') || '')
  const STATUS: Record<string, { text: string; color: string }> = {
    pending: { text: '待处理', color: 'orange' },
    done: { text: '已退款', color: 'green' },
    rejected: { text: '已驳回', color: 'default' },
  }
  const submit = async () => {
    const v = await form.validateFields()
    await api.post('createRefund', { order_id: orderId, amount: v.amount, reason: v.reason || '' })
    message.success('退款申请已提交，等财务处理')
    form.resetFields()
    onChange()
  }
  return (
    <div>
      <div style={{ marginBottom: 12, padding: '6px 10px', background: '#fff7e6', borderRadius: 6, fontSize: 13 }}>
        可退金额（已确认收款 − 已退款）：<strong>{sym} {Number(refundable || 0).toLocaleString()}</strong>
      </div>
      <Form form={form} layout="inline" style={{ marginBottom: 12 }}>
        <Form.Item name="amount" rules={[{ required: true, message: '填退款金额' }]}>
          <InputNumber
            placeholder={`退款金额 ${sym}`}
            min={0}
            style={{ width: 180 }}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number(String(v).replace(/,/g, '')) as any}
          />
        </Form.Item>
        <Form.Item name="reason" rules={[{ required: true, message: '填退款原因' }]}>
          <Input placeholder="退款原因（多收 / 订单取消 / 客户要求）" style={{ width: 300 }} />
        </Form.Item>
        <Form.Item>
          <Button danger onClick={submit}>提交退款申请</Button>
        </Form.Item>
      </Form>
      {refunds.length === 0 ? (
        <Empty description="没有退款记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={refunds}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: '退款金额',
              dataIndex: 'amount',
              width: 140,
              render: (v) => <strong style={{ color: '#ff4d4f' }}>{sym} {Number(v).toLocaleString()}</strong>,
            },
            { title: '原因', dataIndex: 'reason', ellipsis: true },
            {
              title: '状态',
              width: 90,
              render: (_, r: any) => <Tag color={STATUS[r.status]?.color}>{STATUS[r.status]?.text || r.status}</Tag>,
            },
            { title: '申请时间', dataIndex: 'created_at', width: 140, render: (v) => v?.slice(0, 16) },
            {
              title: '退款凭证',
              width: 140,
              render: (_, r: any) => (
                <VoucherUpload entity="refund" entityId={r.id} current={r.voucher_path} onChange={onChange} />
              ),
            },
            {
              title: '操作',
              width: 150,
              render: (_, r: any) =>
                canHandle ? (
                  <Space size={8}>
                    {r.status !== 'done' && (
                      <Popconfirm
                        title="确认已完成退款？"
                        description="确认后从已收金额里扣除"
                        onConfirm={async () => {
                          await api.post('handleRefund', { id: r.id, status: 'done' })
                          message.success('已标记为已退款')
                          onChange()
                        }}
                      >
                        <a>已退款</a>
                      </Popconfirm>
                    )}
                    {r.status === 'pending' && (
                      <Popconfirm
                        title="驳回？"
                        onConfirm={async () => {
                          await api.post('handleRefund', { id: r.id, status: 'rejected' })
                          onChange()
                        }}
                      >
                        <a style={{ color: '#fa8c16' }}>驳回</a>
                      </Popconfirm>
                    )}
                  </Space>
                ) : (
                  <span style={{ color: '#bbb' }}>待财务</span>
                ),
            },
          ]}
        />
      )}
    </div>
  )
}

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
function OrderTimeline({ order, contracts, payments, commissions, paidSum, sym, onChanged }: any) {
  const total = Number(order.total_amount || 0)
  const cSigned = contracts.find((c: any) => c.status === 'signed')
  const cPending = contracts.filter((c: any) => c.status !== 'signed').length
  const paidPct = total > 0 ? Math.min(100, Math.round((paidSum / total) * 100)) : 0
  const ccPaid = commissions.filter((c: any) => c.status === 'paid').length
  const isDone = order.status === 'completed'

  // 无合同成交：很多客户报完价直接打款，不签合同。
  // 这类单不该再摆一排走不完的待办 —— 合同不显示，发票/返佣标成「可选」，
  // 收满款就是完成。判定在后端（传了付款凭证且无合同即自动切换），这里只负责怎么显示。
  const simple = order.flow_mode === 'simple'
  const hasVoucher = payments.some((p: any) => p.voucher_path)

  const stages = [
    ...(simple
      ? [{
          key: 'voucher',
          title: '① 付款凭证',
          done: hasVoucher,
          current: !hasVoucher,
          summary: hasVoucher ? '已上传，本单按无合同成交' : '上传付款凭证即视为成交',
          extra: '',
        }]
      : [{
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
        }]),
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
      title: simple ? '③ 发票（可选）' : '③ 发票',
      done: simple ? true : (!!order.invoice_paid_at || !!order.quote_paid_at),
      current: !!order.invoice_no && !order.invoice_paid_at && !order.quote_paid_at,
      summary: order.invoice_no
        ? `已开具 ${order.invoice_no}`
        : '尚未开具',
      extra: order.invoice_due_at ? `到期 ${order.invoice_due_at.slice(0, 10)}` : '',
    },
    {
      key: 'commission',
      title: simple ? '④ 返佣（可选）' : '④ 返佣',
      done: simple ? true : (commissions.length > 0 && ccPaid === commissions.length),
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
      current: !isDone && (simple
        ? paidSum >= total && total > 0
        : contracts.some((c: any) => c.status === 'signed')
          && paidSum >= total && order.invoice_no
          && (commissions.length === 0 || ccPaid === commissions.length)),
      summary: isDone
        ? `已完成 · ${order.completed_at?.slice(0, 16)}`
        : simple
        ? '收满款自动完成'
        : '待确认完成',
      extra: '',
    },
  ]

  const switchMode = async (to: string) => {
    await api.post('setOrderFlowMode', { id: order.id, flow_mode: to })
    message.success(to === 'simple' ? '已切为无合同成交' : '已切回标准流程')
    onChanged?.()
  }

  return (
    <div className="order-timeline" style={{ marginBottom: 24, ['--ot-cols' as any]: stages.length }}>
      <style>{`
        .order-timeline {
          background: linear-gradient(135deg, #fafcff 0%, #f0f5ff 100%);
          border: 1px solid #e6f0ff;
          border-radius: 10px;
          padding: 16px 20px;
        }
        .ot-grid { display: grid; grid-template-columns: repeat(var(--ot-cols, 5), 1fr); gap: 0; position: relative; }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12 }}>
        {simple ? (
          <>
            <Tag color="green" style={{ marginInlineEnd: 0 }}>无合同成交</Tag>
            <Typography.Text type="secondary">
              这单不签合同，凭付款凭证成交；收满款自动标记完成。发票和返佣按需要办，不影响完成。
            </Typography.Text>
            <a style={{ marginLeft: 'auto' }} onClick={() => switchMode('')}>这单要签合同 → 切回标准流程</a>
          </>
        ) : (
          <>
            <Tag style={{ marginInlineEnd: 0 }}>标准流程</Tag>
            <Typography.Text type="secondary">合同 → 收款 → 发票 → 返佣 → 完成</Typography.Text>
            <a style={{ marginLeft: 'auto' }} onClick={() => switchMode('simple')}>这单不签合同 → 凭付款凭证成交</a>
          </>
        )}
      </div>
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

  // 1. 合同（无合同成交的单不摆这一步，摆了就是永远走不完的待办）
  const simple = order.flow_mode === 'simple'
  const cSigned = Number(order.contracts_signed || 0) > 0
  const cCount = Number(order.contracts_count || 0)
  if (simple) {
    steps.push({
      key: 'voucher',
      label: '凭证',
      status: 'done',
      hint: '无合同成交：凭付款凭证',
    })
  } else {
    steps.push({
      key: 'contract',
      label: '合同',
      status: cSigned ? 'done' : cCount > 0 ? 'current' : 'todo',
      hint: cCount === 0 ? '未生成' : cSigned ? `已签订（${cCount} 版）` : `${cCount} 版未签`,
    })
  }

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
  entity: 'payment' | 'commission' | 'contract' | 'order' | 'refund'
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

// ====================== 录入历史订单 ======================
function ImportHistoricalOrderButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [customerId, setCustomerId] = useState<number | undefined>()
  const [supplierName, setSupplierName] = useState<string>('')
  const [contractNo, setContractNo] = useState<string>('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiHint, setAiHint] = useState<string>('')
  const [orderDate, setOrderDate] = useState<Dayjs>(dayjs())
  const [currency, setCurrency] = useState<'IDR' | 'CNY'>('IDR')
  const [taxIncluded, setTaxIncluded] = useState(true)
  const [taxRate, setTaxRate] = useState(11)
  const [rows, setRows] = useState<any[]>([
    { product_name: '', spec: '', qty: 1, unit: '件', sell_price: 0 },
  ])
  const [totalOverride, setTotalOverride] = useState<number | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<'none' | 'partial' | 'full'>('full')
  const [paidAmount, setPaidAmount] = useState<number>(0)
  const [paidAt, setPaidAt] = useState<Dayjs | null>(null)
  const [paymentMethod, setPaymentMethod] = useState('银行转账')
  const [isCompleted, setIsCompleted] = useState(true)
  const [completedAt, setCompletedAt] = useState<Dayjs | null>(null)
  const [salespersonId, setSalespersonId] = useState<number | undefined>()
  const [commissionAmount, setCommissionAmount] = useState<number>(0)
  const [issueInvoice, setIssueInvoice] = useState(true)
  const [remark, setRemark] = useState('')

  const sym = currency === 'CNY' ? '¥' : 'Rp'
  const sumTotal = rows.reduce(
    (s, r) => s + (Number(r.qty) || 0) * (Number(r.sell_price) || 0),
    0,
  )
  const finalTotal = totalOverride && totalOverride > 0 ? totalOverride : sumTotal

  const aiUpload = async (file: File) => {
    if (file.size > 30 * 1024 * 1024) {
      message.error('文件不能超过 30MB')
      return false
    }
    setAiBusy(true)
    setAiHint('')
    try {
      // PDF → 浏览器内转图
      let uploadFile = file
      try {
        uploadFile = await convertPdfToImageIfNeeded(file)
        if (uploadFile !== file) message.info('PDF 已在浏览器内转为图片', 1.5)
      } catch (e: any) {
        message.error('PDF 转图失败：' + (e?.message || ''))
        setAiBusy(false)
        return false
      }
      const fd = new FormData()
      fd.append('file', uploadFile)
      const r = await api.upload('aiParseHistoricalOrderImage', fd)
      const aiRows: any[] = r.rows || []
      if (aiRows.length === 0) {
        message.warning('AI 没识别到内容')
        return false
      }
      // 自动合并所有行 → 填入表单
      const sum = (k: string) =>
        aiRows.reduce((s, r) => s + (Number(String(r[k]).replace(/[\s,]/g, '')) || 0), 0)
      const first = (k: string) =>
        aiRows.find((r) => String(r[k] || '').trim() !== '')?.[k] || ''
      const total = sum('total') || sum('total_ex_tax')

      if (first('contract_no')) setContractNo(String(first('contract_no')))

      // 明细：每个 AI row 变成一个 item
      const newRows = aiRows
        .filter((r) => r.product_summary || r.total || r.total_ex_tax)
        .map((r) => {
          const lineTotal = Number(String(r.total).replace(/[\s,]/g, '')) || 0
          const qty = Number(r.qty) || 1
          return {
            product_name: r.product_summary || r.contract_no || '商品',
            spec: r.spec || '',
            qty,
            unit: r.unit || '件',
            sell_price: qty > 0 ? lineTotal / qty : lineTotal,
          }
        })
      if (newRows.length > 0) setRows(newRows)

      // 付款状态
      const paid = sum('paid_amount')
      if (paid >= total && total > 0) {
        setPaymentStatus('full')
      } else if (paid > 0) {
        setPaymentStatus('partial')
        setPaidAmount(paid)
      }

      // 已开票/已送货
      if (first('is_invoiced') === '是') setIssueInvoice(true)
      const delivered = first('delivered_at')
      if (delivered && typeof delivered === 'string' && /^\d{4}-\d{2}-\d{2}/.test(delivered)) {
        setOrderDate(dayjs(delivered))
      }

      // 业务员
      if (first('salesperson_name')) setRemark((r) => r ? r + '\n业务员：' + first('salesperson_name') : '业务员：' + first('salesperson_name'))

      // 总额覆盖：把 AI 算到的总价填进去，因为明细行的 sell_price 是按金额/数量算的，万一有舍入差
      if (total > 0) setTotalOverride(total)

      setAiHint(`已识别 ${aiRows.length} 行明细 → 合并为一单（金额合计 ${total.toLocaleString()}）。请补客户、检查货币/付款状态后点录入。`)
      message.success(`AI 识别完成，请补客户后点录入`)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || 'AI 识别失败')
    } finally {
      setAiBusy(false)
    }
    return false
  }

  const reset = () => {
    setCustomerId(undefined)
    setSupplierName('')
    setContractNo('')
    setAiHint('')
    setOrderDate(dayjs())
    setRows([{ product_name: '', spec: '', qty: 1, unit: '件', sell_price: 0 }])
    setTotalOverride(null)
    setPaymentStatus('full')
    setPaidAmount(0)
    setPaidAt(null)
    setIsCompleted(true)
    setCompletedAt(null)
    setSalespersonId(undefined)
    setCommissionAmount(0)
    setRemark('')
  }

  const updateRow = (i: number, patch: any) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRow = () =>
    setRows((p) => [...p, { product_name: '', spec: '', qty: 1, unit: '件', sell_price: 0 }])
  const removeRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (!customerId) return message.warning('请选客户')
    const valid = rows.filter((r) => r.product_name && r.qty > 0 && r.sell_price > 0)
    if (valid.length === 0) return message.warning('至少一行有效明细（产品名/数量/单价）')

    setSubmitting(true)
    try {
      const res = await api.post('importHistoricalOrder', {
        customer_id: customerId,
        supplier_name: supplierName,
        contract_no: contractNo,
        order_date: orderDate.format('YYYY-MM-DD'),
        currency,
        tax_included: taxIncluded ? 1 : 0,
        tax_rate: taxRate / 100,
        items: valid,
        total_override: totalOverride,
        payment_status: paymentStatus,
        paid_amount: paymentStatus === 'full' ? finalTotal : paidAmount,
        paid_at: paidAt?.format('YYYY-MM-DD HH:mm:00'),
        payment_method: paymentMethod,
        is_completed: isCompleted ? 1 : 0,
        completed_at: completedAt?.format('YYYY-MM-DD HH:mm:00'),
        salesperson_id: salespersonId,
        commission_amount: commissionAmount,
        issue_invoice: issueInvoice ? 1 : 0,
        remark,
      })
      message.success(`已录入订单 ${res.order_no}${res.invoice_no ? ' 发票 ' + res.invoice_no : ''}`)
      setOpen(false)
      reset()
      onCreated()
    } catch (e: any) {
      message.error(e?.message || '录入失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button icon={<CloudUploadOutlined />} onClick={() => setOpen(true)}>
        录入历史订单
      </Button>
      <Modal
        title="录入历史订单（补录旧单）"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        okText={`录入（${sym} ${finalTotal.toLocaleString()}）`}
        cancelText="取消"
        width={1100}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* AI 识别上传 */}
          <div style={{ background: '#f0f5ff', padding: 12, borderRadius: 6, borderLeft: '3px solid #1d57e0' }}>
            <Space wrap>
              <Typography.Text strong style={{ color: '#1d57e0' }}>
                AI 识别录入
              </Typography.Text>
              <Upload
                accept="image/*,.pdf,application/pdf"
                showUploadList={false}
                beforeUpload={(f) => { aiUpload(f); return false }}
              >
                <Button
                  type="primary"
                  ghost
                  icon={<FileImageOutlined />}
                  loading={aiBusy}
                >
                  {aiBusy ? '识别中...' : '上传图片 / PDF 自动填表'}
                </Button>
              </Upload>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                供应商发的报价单/合同/送货单 → 一键填好下方所有字段
              </Typography.Text>
            </Space>
            {aiHint && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#52c41a' }}>
                ✓ {aiHint}
              </div>
            )}
          </div>

          <Space wrap size={16}>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>供应商 / 厂家</Typography.Text>
              <Input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="如：神州电缆"
                style={{ width: 200 }}
              />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>合同号</Typography.Text>
              <Input
                value={contractNo}
                onChange={(e) => setContractNo(e.target.value)}
                placeholder="如 SZXL07L260417"
                style={{ width: 200 }}
              />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>客户 *</Typography.Text>
              <ProFormSelect
                noStyle
                fieldProps={{ style: { width: 360 } }}
                showSearch
                placeholder="搜索客户名 / 编号 / 电话"
                onChange={(v: any) => setCustomerId(v)}
                request={async () => {
                  const data = await api.get('listCustomers', { page_size: 200 })
                  return data.items.map((c: any) => ({
                    label: `${c.short_name || c.name}${c.company ? '（' + c.company + '）' : ''}${c.code ? ' #' + c.code : ''}`,
                    value: c.id,
                  }))
                }}
              />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>下单日期 *</Typography.Text>
              <DatePicker value={orderDate} onChange={(d) => d && setOrderDate(d)} format="YYYY-MM-DD" />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>货币</Typography.Text>
              <Radio.Group value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <Radio.Button value="IDR">Rp</Radio.Button>
                <Radio.Button value="CNY">¥</Radio.Button>
              </Radio.Group>
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>含税</Typography.Text>
              <Switch checked={taxIncluded} onChange={setTaxIncluded} />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>税率</Typography.Text>
              <InputNumber
                value={taxRate}
                onChange={(v) => setTaxRate(Number(v ?? 11))}
                addonAfter="%"
                min={0}
                max={100}
                style={{ width: 100 }}
              />
            </span>
          </Space>

          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            dataSource={rows}
            pagination={false}
            columns={[
              { title: '#', width: 40, render: (_, _r, i) => i + 1 },
              { title: '产品名 *', render: (_, r: any, i) => <Input size="small" value={r.product_name} onChange={(e) => updateRow(i, { product_name: e.target.value })} /> },
              { title: '规格', width: 140, render: (_, r: any, i) => <Input size="small" value={r.spec} onChange={(e) => updateRow(i, { spec: e.target.value })} /> },
              { title: '数量 *', width: 90, render: (_, r: any, i) => <InputNumber size="small" min={0} value={r.qty} onChange={(v) => updateRow(i, { qty: Number(v ?? 0) })} style={{ width: '100%' }} /> },
              { title: '单位', width: 70, render: (_, r: any, i) => <Input size="small" value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} /> },
              { title: `单价(${sym}) *`, width: 130, render: (_, r: any, i) => <InputNumber size="small" min={0} value={r.sell_price} onChange={(v) => updateRow(i, { sell_price: Number(v ?? 0) })} style={{ width: '100%' }} /> },
              { title: '小计', width: 120, render: (_, r: any) => <strong>{sym} {((Number(r.sell_price) || 0) * (Number(r.qty) || 0)).toLocaleString()}</strong> },
              { title: '', width: 40, render: (_, _r, i) => <Button size="small" type="text" danger onClick={() => removeRow(i)}><DeleteOutlined /></Button> },
            ]}
            footer={() => <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addRow}>添加一行</Button>}
          />

          <Space wrap>
            <span>
              <Typography.Text type="secondary">明细合计 {sym} {sumTotal.toLocaleString()}</Typography.Text>
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>覆盖总额（可选）</Typography.Text>
              <InputNumber
                placeholder="留空 = 用明细合计"
                value={totalOverride as any}
                onChange={(v) => setTotalOverride(v == null ? null : Number(v))}
                style={{ width: 180 }}
              />
            </span>
          </Space>

          <div style={{ background: '#fafbfc', padding: 12, borderRadius: 6, borderLeft: '3px solid #1d57e0' }}>
            <Typography.Text strong style={{ color: '#1d57e0' }}>付款情况</Typography.Text>
            <Space wrap style={{ marginTop: 8, display: 'flex' }}>
              <Radio.Group value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
                <Radio.Button value="full">已全款</Radio.Button>
                <Radio.Button value="partial">部分付款</Radio.Button>
                <Radio.Button value="none">未收款</Radio.Button>
              </Radio.Group>
              {paymentStatus === 'partial' && (
                <InputNumber
                  placeholder={`已收金额 ${sym}`}
                  value={paidAmount}
                  onChange={(v) => setPaidAmount(Number(v ?? 0))}
                  style={{ width: 180 }}
                />
              )}
              {paymentStatus !== 'none' && (
                <DatePicker
                  placeholder="收款日期"
                  value={paidAt}
                  onChange={setPaidAt}
                  format="YYYY-MM-DD"
                />
              )}
              {paymentStatus !== 'none' && (
                <Input placeholder="付款方式（如银行转账）" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={{ width: 180 }} />
              )}
            </Space>
          </div>

          <Space wrap>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>同时开发票号</Typography.Text>
              <Switch checked={issueInvoice} onChange={setIssueInvoice} />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>标记已完成</Typography.Text>
              <Switch checked={isCompleted} onChange={setIsCompleted} />
            </span>
            {isCompleted && (
              <DatePicker placeholder="完成日期（不填默认下单日）" value={completedAt} onChange={setCompletedAt} format="YYYY-MM-DD" />
            )}
          </Space>

          <Space wrap>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>业务员（可选）</Typography.Text>
              <SalespersonSelector value={salespersonId} onChange={(v) => setSalespersonId(v)} />
            </span>
            {salespersonId && (
              <span>
                <Typography.Text type="secondary" style={{ marginRight: 8 }}>佣金金额</Typography.Text>
                <InputNumber
                  placeholder={`佣金 ${sym}`}
                  value={commissionAmount}
                  onChange={(v) => setCommissionAmount(Number(v ?? 0))}
                  style={{ width: 180 }}
                />
              </span>
            )}
          </Space>

          <div>
            <Typography.Text type="secondary">备注</Typography.Text>
            <Input.TextArea
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="补录说明"
              style={{ marginTop: 4 }}
            />
          </div>

          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            提示：录入后会自动生成 询价(已成交) → 客户报价 → 订单 三条链路记录，已勾选"开发票"则同时分配发票号。所有日期可追溯到下单日。
          </Typography.Text>
        </Space>
      </Modal>
    </>
  )
}

// ====================== Excel 批量导入 ======================
function BatchImportButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [parsedRows, setParsedRows] = useState<any[] | null>(null)
  const [result, setResult] = useState<any>(null)
  const [batchSupplier, setBatchSupplier] = useState<string>('')
  const [mergeIntoOne, setMergeIntoOne] = useState(false)

  const handleExcel = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      message.error('文件不能超过 20MB')
      return false
    }
    setUploading(true)
    setResult(null)
    setParsedRows(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (batchSupplier.trim()) fd.append('default_supplier_name', batchSupplier.trim())
      const r = await api.upload('importHistoricalOrdersBatch', fd)
      setResult(r)
      message.success(`处理完成：成功 ${r.success.length} / 失败 ${r.failed.length}`)
      if (r.success.length > 0) onCreated()
    } catch (e: any) {
      message.error(e?.message || '导入失败')
    } finally {
      setUploading(false)
    }
    return false
  }

  const handleImage = async (file: File) => {
    if (file.size > 30 * 1024 * 1024) {
      message.error('文件不能超过 30MB')
      return false
    }
    setAiBusy(true)
    setResult(null)
    setParsedRows(null)
    try {
      // PDF → 浏览器内转图
      let uploadFile = file
      try {
        uploadFile = await convertPdfToImageIfNeeded(file)
        if (uploadFile !== file) message.info('PDF 已在浏览器内转为图片，开始识别…', 2)
      } catch (e: any) {
        message.error('PDF 转图失败：' + (e?.message || ''))
        setAiBusy(false)
        return false
      }
      const fd = new FormData()
      fd.append('file', uploadFile)
      const r = await api.upload('aiParseHistoricalOrderImage', fd)
      if (!r.rows || r.rows.length === 0) {
        message.warning('AI 没识别到行')
      } else {
        setParsedRows(r.rows)
        message.success(`识别到 ${r.rows.length} 行，请核对后点确认导入`)
      }
    } catch (e: any) {
      message.error(e?.message || 'AI 识别失败')
    } finally {
      setAiBusy(false)
    }
    return false
  }

  const confirmImport = async () => {
    if (!parsedRows) return
    setUploading(true)

    let toSend = parsedRows
    if (mergeIntoOne && parsedRows.length > 1) {
      // 合并为单一订单：金额累加 / 商品名拼接 / 文本字段取第一条非空
      const sum = (k: string) =>
        parsedRows.reduce((s, r) => s + (Number(String(r[k]).replace(/[\s,]/g, '')) || 0), 0)
      const firstNonEmpty = (k: string) =>
        parsedRows.find((r) => String(r[k] || '').trim() !== '')?.[k] || ''
      const allProducts = parsedRows
        .map((r) => r.product_summary || '')
        .filter(Boolean)
        .join(' / ')
      const firstPct = parsedRows.find((r) => Number(r.commission_pct) > 0)?.commission_pct || ''
      const merged = {
        contract_no: firstNonEmpty('contract_no'),
        name: firstNonEmpty('name'),
        product_summary: allProducts || firstNonEmpty('product_summary'),
        total: sum('total'),
        total_ex_tax: sum('total_ex_tax'),
        cost_amount: sum('cost_amount'),
        paid_amount: sum('paid_amount'),
        commission_gross: sum('commission_gross'),
        pph_deduction: sum('pph_deduction'),
        commission_net: sum('commission_net'),
        commission_pct: firstPct,
        is_invoiced: firstNonEmpty('is_invoiced'),
        is_delivered: firstNonEmpty('is_delivered'),
        delivered_at: firstNonEmpty('delivered_at'),
        salesperson_name: firstNonEmpty('salesperson_name'),
        remark: parsedRows.map((r) => r.remark).filter(Boolean).join(' / '),
      }
      toSend = [merged]
    }

    try {
      const r = await api.post('importHistoricalOrdersFromJson', {
        rows: toSend,
        default_supplier_name: batchSupplier.trim(),
      })
      setResult(r)
      setParsedRows(null)
      message.success(`处理完成：成功 ${r.success.length} / 失败 ${r.failed.length}`)
      if (r.success.length > 0) onCreated()
    } catch (e: any) {
      message.error(e?.message || '导入失败')
    } finally {
      setUploading(false)
    }
  }

  const updateParsedRow = (idx: number, patch: any) =>
    setParsedRows((p) => p && p.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const removeParsedRow = (idx: number) =>
    setParsedRows((p) => p && p.filter((_, i) => i !== idx))

  const downloadTemplate = async () => {
    try {
      await api.download('downloadOrderImportTemplate', {}, '历史订单批量导入模板.xlsx')
    } catch (e: any) {
      message.error(e?.message || '下载失败')
    }
  }

  return (
    <>
      <Button icon={<UploadOutlined />} onClick={() => setOpen(true)}>
        Excel 批量导入
      </Button>
      <Modal
        title="批量导入历史订单（Excel 或 图片识别）"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={1200}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text>
            三种方式：① <strong>Excel</strong> — 下载模板逐行填写；② <strong>图片/截图</strong> — AI 识别表格；③ <strong>PDF</strong> — AI 抽文字 / 转图识别。预览后确认导入。
          </Typography.Text>
          <div style={{ background: '#f9fbff', padding: 12, borderRadius: 6, borderLeft: '3px solid #722ed1' }}>
            <Typography.Text strong style={{ color: '#722ed1' }}>本批次供应商：</Typography.Text>
            <Input
              placeholder="如：神州电缆（这批所有订单都会标这个供应商，可空）"
              value={batchSupplier}
              onChange={(e) => setBatchSupplier(e.target.value)}
              style={{ width: 380, marginLeft: 8 }}
            />
          </div>
          <Space wrap>
            <Button type="primary" ghost icon={<CloudUploadOutlined />} onClick={downloadTemplate}>
              下载模板
            </Button>
            <Upload
              accept=".xlsx"
              showUploadList={false}
              beforeUpload={(f) => { handleExcel(f); return false }}
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                {uploading ? '导入中...' : '上传 Excel'}
              </Button>
            </Upload>
            <Upload
              accept="image/*,.pdf,application/pdf"
              showUploadList={false}
              beforeUpload={(f) => { handleImage(f); return false }}
            >
              <Button icon={<FileImageOutlined />} loading={aiBusy}>
                {aiBusy ? '识别中...' : '上传图片 / PDF 识别（AI）'}
              </Button>
            </Upload>
          </Space>

          {parsedRows && parsedRows.length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  <span>AI 识别预览（{parsedRows.length} 行，可编辑）</span>
                  <Tag.CheckableTag
                    checked={mergeIntoOne}
                    onChange={setMergeIntoOne}
                    style={{ fontSize: 13, padding: '2px 10px', background: mergeIntoOne ? '#1d57e0' : '#f0f0f0', color: mergeIntoOne ? '#fff' : '#595959' }}
                  >
                    {mergeIntoOne ? '✓ ' : ''}合并为一个订单
                  </Tag.CheckableTag>
                </Space>
              }
              extra={
                <Button type="primary" loading={uploading} onClick={confirmImport}>
                  确认导入 {mergeIntoOne ? '1 单（合并）' : `${parsedRows.length} 条`}
                </Button>
              }
            >
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                dataSource={parsedRows}
                pagination={false}
                scroll={{ x: 1500, y: 380 }}
                columns={[
                  { title: '#', width: 40, render: (_, _r, i) => i + 1 },
                  { title: '合同号', width: 130, render: (_, r: any, i) => <Input size="small" value={r.contract_no} onChange={(e) => updateParsedRow(i, { contract_no: e.target.value })} /> },
                  { title: '客户', width: 90, render: (_, r: any, i) => <Input size="small" value={r.name} onChange={(e) => updateParsedRow(i, { name: e.target.value })} /> },
                  { title: '含税', width: 130, render: (_, r: any, i) => <Input size="small" value={r.total} onChange={(e) => updateParsedRow(i, { total: e.target.value })} /> },
                  { title: '不含税', width: 130, render: (_, r: any, i) => <Input size="small" value={r.total_ex_tax} onChange={(e) => updateParsedRow(i, { total_ex_tax: e.target.value })} /> },
                  { title: '厂家直出', width: 130, render: (_, r: any, i) => <Input size="small" value={r.cost_amount} onChange={(e) => updateParsedRow(i, { cost_amount: e.target.value })} /> },
                  { title: '提点%', width: 70, render: (_, r: any, i) => <Input size="small" value={r.commission_pct} onChange={(e) => updateParsedRow(i, { commission_pct: e.target.value })} /> },
                  { title: '已收', width: 130, render: (_, r: any, i) => <Input size="small" value={r.paid_amount} onChange={(e) => updateParsedRow(i, { paid_amount: e.target.value })} /> },
                  { title: '开票', width: 60, render: (_, r: any, i) => <Input size="small" value={r.is_invoiced} onChange={(e) => updateParsedRow(i, { is_invoiced: e.target.value })} /> },
                  { title: '送货', width: 60, render: (_, r: any, i) => <Input size="small" value={r.is_delivered} onChange={(e) => updateParsedRow(i, { is_delivered: e.target.value })} /> },
                  { title: '送货日期', width: 110, render: (_, r: any, i) => <Input size="small" value={r.delivered_at} onChange={(e) => updateParsedRow(i, { delivered_at: e.target.value })} /> },
                  { title: '返点', width: 110, render: (_, r: any, i) => <Input size="small" value={r.commission_gross} onChange={(e) => updateParsedRow(i, { commission_gross: e.target.value })} /> },
                  { title: 'PPh', width: 80, render: (_, r: any, i) => <Input size="small" value={r.pph_deduction} onChange={(e) => updateParsedRow(i, { pph_deduction: e.target.value })} /> },
                  { title: '最终', width: 110, render: (_, r: any, i) => <Input size="small" value={r.commission_net} onChange={(e) => updateParsedRow(i, { commission_net: e.target.value })} /> },
                  { title: '业务员', width: 80, render: (_, r: any, i) => <Input size="small" value={r.salesperson_name} onChange={(e) => updateParsedRow(i, { salesperson_name: e.target.value })} /> },
                  { title: '备注', width: 100, render: (_, r: any, i) => <Input size="small" value={r.remark} onChange={(e) => updateParsedRow(i, { remark: e.target.value })} /> },
                  { title: '', width: 40, render: (_, _r, i) => <Button size="small" type="text" danger onClick={() => removeParsedRow(i)}><DeleteOutlined /></Button> },
                ]}
              />
            </Card>
          )}

          {result && (
            <div>
              <Space size={16} style={{ marginBottom: 12 }}>
                <Tag color="success" style={{ fontSize: 14, padding: '4px 10px' }}>
                  成功 {result.success.length} 条
                </Tag>
                <Tag color="error" style={{ fontSize: 14, padding: '4px 10px' }}>
                  失败 {result.failed.length} 条
                </Tag>
                <span>共 {result.total} 行</span>
              </Space>

              {result.success.length > 0 && (
                <Card size="small" title="成功" style={{ marginBottom: 12 }}>
                  <Table
                    size="small"
                    rowKey={(_, i) => String(i)}
                    dataSource={result.success}
                    pagination={false}
                    columns={[
                      { title: 'Excel 行', dataIndex: 'row', width: 80 },
                      { title: '订单号', dataIndex: 'order_no' },
                      { title: '金额', dataIndex: 'amount', render: (v: any) => Number(v).toLocaleString() },
                    ]}
                    scroll={{ y: 200 }}
                  />
                </Card>
              )}

              {result.failed.length > 0 && (
                <Card size="small" title="失败（请修正后单独补录）">
                  <Table
                    size="small"
                    rowKey={(_, i) => String(i)}
                    dataSource={result.failed}
                    pagination={false}
                    columns={[
                      { title: 'Excel 行', dataIndex: 'row', width: 80 },
                      { title: '错误', dataIndex: 'error', render: (v: any) => <span style={{ color: '#ff4d4f' }}>{v}</span> },
                    ]}
                    scroll={{ y: 200 }}
                  />
                </Card>
              )}
            </div>
          )}
        </Space>
      </Modal>
    </>
  )
}

// 缺少的导入：Card
