import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import {
  Tag,
  message,
  Drawer,
  Descriptions,
  Form,
  Table,
  Space,
  Button,
  Popconfirm,
  Input,
  InputNumber,
  Modal,
  Radio,
  Switch,
  Timeline,
  Upload,
  Empty,
  Typography,
} from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  PictureOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { ProFormSelect } from '@ant-design/pro-components'
import { api } from '../api'
import { customerCellMergeWithClass, customerRowClass, groupByCustomer } from '../utils/groupByCustomer'
import { convertPdfToImageIfNeeded } from '../utils/pdfToImages'

function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'))
    } catch (e) {
      reject(e)
    } finally {
      document.body.removeChild(ta)
    }
  })
}

const STATUS: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  to_review: { color: 'orange', text: '待审核' },
  sent: { color: 'blue', text: '已发送' },
  confirmed: { color: 'success', text: '客户已确认' },
  expired: { color: 'red', text: '已过期' },
}

interface Quote {
  id: number
  no: string
  inquiry_id: number
  customer_id: number
  status: string
  total: number
  valid_until: string
  created_at: string
}

export default function QuotesPage() {
  const ref = useRef<ActionType>()
  const [detailId, setDetailId] = useState<number | null>(null)
  const [companyName, setCompanyName] = useState('星选建材')

  useEffect(() => {
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries(
        (r.items || []).map((s: any) => [s.key, s.value]),
      )
      if (sm.company_name) setCompanyName(sm.company_name)
    })
  }, [])

  const groupName = (r: any) =>
    `[${companyName}${r.customer_code || r.customer_id}] ${r.customer_short_name || r.customer_name || '-'}`

  const cols: ProColumns<Quote>[] = [
    {
      title: '搜索',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: {
        placeholder: '群编号 / 客户名 / 简称 / 公司 / 电话 / 报价单号',
        allowClear: true,
      },
    },
    {
      title: '#',
      search: false,
      width: 50,
      render: (_, r: any) => (r._gs > 1 ? <strong>{r._gi}</strong> : '-'),
    },
    {
      title: '客户群名（点击复制）',
      width: 280,
      search: false,
      render: (_, r: any) => (
        <div>
          <Tag
            color="blue"
            style={{ cursor: 'pointer' }}
            icon={<CopyOutlined />}
            onClick={() => {
              const t = groupName(r)
              copyText(t)
                .then(() => message.success(`已复制：${t}`))
                .catch(() => message.error('复制失败'))
            }}
          >
            {groupName(r)}
          </Tag>
          {r._gs > 1 && (
            <div style={{ fontSize: 11, color: '#1d57e0', marginTop: 2 }}>共 {r._gs} 单</div>
          )}
        </div>
      ),
      onCell: customerCellMergeWithClass,
    },
    { title: '报价单号', dataIndex: 'no', search: false },
    { title: '询价单 ID', dataIndex: 'inquiry_id', search: false },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, { text: v.text }])),
      render: (_, r) => <Tag color={STATUS[r.status]?.color}>{STATUS[r.status]?.text}</Tag>,
    },
    {
      title: '总金额',
      dataIndex: 'total',
      search: false,
      render: (_, r: any) => `${(r.currency || 'IDR') === 'IDR' ? 'Rp' : '¥'} ${Number(r.total).toLocaleString()}`,
    },
    { title: '有效期', dataIndex: 'valid_until', search: false },
    { title: '创建时间', dataIndex: 'created_at', search: false },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => [
        <a key="view" onClick={() => setDetailId(row.id)}>
          详情
        </a>,
        row.status === 'draft' && (
          <a
            key="send"
            onClick={async () => {
              await api.post('sendCustomerQuote', { id: row.id })
              message.success('已发送')
              ref.current?.reload()
            }}
          >
            发送给客户
          </a>
        ),
        <Popconfirm
          key="del"
          title={`删除报价单 ${row.no}？`}
          description="将一并删除报价明细。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={async () => {
            await api.post('deleteCustomerQuote', { id: row.id })
            message.success('已删除')
            ref.current?.reload()
          }}
        >
          <a style={{ color: '#ff4d4f' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ]

  return (
    <PageContainer title="客户报价 / 发票">
      <ProTable<Quote>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        bordered
        onRow={(r: any) => customerRowClass(r)}
        request={async (params) => {
          const data = await api.get('listCustomerQuotes', {
            keyword: (params as any).keyword || '',
            status: params.status,
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: groupByCustomer(data.items || []), total: data.total, success: true }
        }}
        headerTitle="客户报价"
        toolBarRender={() => [
          <ConvertSupplierQuote key="cs" onOk={() => ref.current?.reload()} />,
          <QuickInvoice key="qi" onOk={() => ref.current?.reload()} />,
        ]}
      />
      <QuoteDetail
        id={detailId}
        onClose={() => {
          setDetailId(null)
          ref.current?.reload()
        }}
      />
    </PageContainer>
  )
}

export function QuoteDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) {
      setData(null)
      return
    }
    setLoading(true)
    api
      .get('getCustomerQuote', { id })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [id])

  const send = async () => {
    await api.post('sendCustomerQuote', { id })
    message.success('已发送')
    const r = await api.get('getCustomerQuote', { id })
    setData(r.data)
  }

  const del = async () => {
    await api.post('deleteCustomerQuote', { id })
    message.success('已删除')
    onClose()
  }

  return (
    <Drawer title={data ? `报价单 ${data.no}` : '报价详情'} width={900} open={!!id} onClose={onClose} destroyOnClose>
      {loading && <div>加载中...</div>}
      {data && (
        <>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="单号">{data.no}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS[data.status]?.color}>{STATUS[data.status]?.text}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="询价单">
              {data.inquiry_no || `#${data.inquiry_id}`}
              {data.inquiry_title && (
                <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 6 }}>{data.inquiry_title}</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="客户">
              {data.customer_short_name || data.customer_name || `#${data.customer_id}`}
              {data.customer_company && (
                <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 6 }}>/ {data.customer_company}</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="总金额">
              {(data.currency || 'IDR') === 'IDR' ? 'Rp' : '¥'} {Number(data.total).toLocaleString()}
              <Tag style={{ marginLeft: 8 }} color={Number(data.tax_included ?? 1) ? 'blue' : 'default'}>
                {Number(data.tax_included ?? 1) ? `含税 ${(Number(data.tax_rate ?? 0.11) * 100).toFixed(0)}%` : '不含税'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="报价有效期">
              <Typography.Text
                editable={{
                  text: (data.valid_until || '').slice(0, 10),
                  tooltip: '点击编辑（格式 YYYY-MM-DD）',
                  onChange: async (v) => {
                    if (!v) return
                    await api.post('updateQuoteTerms', {
                      id: data.id,
                      valid_until: v.length === 10 ? v + ' 23:59:59' : v,
                    })
                    message.success('已保存')
                    const r = await api.get('getCustomerQuote', { id: data.id })
                    setData(r.data)
                  },
                }}
                style={{ color: '#cf1322', fontWeight: 600 }}
              >
                {(data.valid_until || '').slice(0, 10) || '点击设置'}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="生产周期">
              <Typography.Text
                editable={{
                  text: data.production_cycle || '',
                  tooltip: '点击编辑（如：15-20 个工作日 / 现货）',
                  onChange: async (v) => {
                    await api.post('updateQuoteTerms', {
                      id: data.id,
                      production_cycle: v,
                    })
                    message.success('已保存')
                    const r = await api.get('getCustomerQuote', { id: data.id })
                    setData(r.data)
                  },
                }}
                style={{ color: '#1d57e0', fontWeight: 600 }}
              >
                {data.production_cycle || <span style={{ color: '#bfbfbf' }}>点击设置</span>}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="发票号">
              {data.invoice_no ? (
                <Space>
                  <Typography.Text copyable code>{data.invoice_no}</Typography.Text>
                  {data.paid_at ? (
                    <Tag color="success">已收款 {data.paid_at?.slice(0, 10)}</Tag>
                  ) : data.invoice_due_at && new Date(data.invoice_due_at) < new Date() ? (
                    <Tag color="red">已逾期</Tag>
                  ) : (
                    <Tag color="orange">待收款</Tag>
                  )}
                </Space>
              ) : (
                <span style={{ color: '#bfbfbf' }}>未开具</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="到期日">
              {data.invoice_due_at ? data.invoice_due_at.slice(0, 10) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="加价策略" span={2}>
              {data.markup_strategy ? JSON.stringify(data.markup_strategy) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              <Typography.Text
                editable={{
                  text: data.remark || '',
                  tooltip: '点击编辑',
                  autoSize: { minRows: 2, maxRows: 6 },
                  onChange: async (v) => {
                    await api.post('updateQuoteTerms', { id: data.id, remark: v })
                    message.success('已保存')
                    const r = await api.get('getCustomerQuote', { id: data.id })
                    setData(r.data)
                  },
                }}
              >
                {data.remark || <span style={{ color: '#bfbfbf' }}>点击添加备注</span>}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>

          <h4 style={{ marginTop: 16 }}>明细</h4>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={data.items}
            columns={[
              { title: '产品', dataIndex: 'product_name' },
              { title: '规格', dataIndex: 'spec' },
              {
                title: '品牌/型号（对客户）',
                render: (_, r: any) =>
                  r.show_brand ? (
                    <span>
                      {r.brand_display}
                      {r.model_display ? ` / ${r.model_display}` : ''}
                    </span>
                  ) : (
                    <Tag>已隐藏</Tag>
                  ),
              },
              { title: '数量', render: (_, r: any) => `${r.qty} ${r.unit}` },
              { title: '成本', dataIndex: 'cost_price', render: (v) => `¥ ${Number(v).toLocaleString()}` },
              {
                title: '售价',
                dataIndex: 'sell_price',
                render: (v) => <strong>¥ {Number(v).toLocaleString()}</strong>,
              },
              {
                title: '加价',
                dataIndex: 'markup_amount',
                render: (v) => `¥ ${Number(v).toLocaleString()}`,
              },
              {
                title: '行小计',
                render: (_, r: any) =>
                  `¥ ${(Number(r.sell_price) * Number(r.qty)).toLocaleString()}`,
              },
            ]}
          />

          {/* 成交状态 */}
          <div style={{ margin: '16px 0', padding: 12, background: '#fafbfc', borderRadius: 8 }}>
            <Space wrap>
              <Typography.Text type="secondary">成交状态：</Typography.Text>
              {data.deal_status === 'won' ? (
                <Tag color="success">✓ 已成交 {data.won_at?.slice(0, 10)}</Tag>
              ) : data.deal_status === 'lost' ? (
                <Tag color="default">✗ 未成交 {data.lost_at?.slice(0, 10)}{data.lost_reason ? `（${data.lost_reason}）` : ''}</Tag>
              ) : (
                <Tag color="orange">待定</Tag>
              )}
              {data.deal_status !== 'won' && (
                <Button
                  type="primary"
                  size="small"
                  onClick={async () => {
                    const r = await api.post('setDealStatus', { quote_id: id, status: 'won' })
                    message.success(`已标记成交，订单号 ${r.order_no}`)
                    const fresh = await api.get('getCustomerQuote', { id })
                    setData(fresh.data)
                    if (r.order_id) {
                      Modal.info({
                        title: '已生成订单',
                        content: `订单 ${r.order_no} 已创建，可在商机的「订单履约」步骤继续办理合同、收款、发票、返佣。`,
                        okText: '知道了',
                        zIndex: 9999,
                      })
                    }
                  }}
                >
                  标记已成交
                </Button>
              )}
              {data.deal_status !== 'lost' && (
                <Button
                  size="small"
                  onClick={() => {
                    let reason = ''
                    Modal.confirm({
                      title: '标记未成交',
                      content: (
                        <Input.TextArea
                          rows={3}
                          placeholder="未成交原因（可选）"
                          onChange={(e) => (reason = e.target.value)}
                        />
                      ),
                      zIndex: 9999,
                      onOk: async () => {
                        await api.post('setDealStatus', { quote_id: id, status: 'lost', reason })
                        message.success('已归档')
                        const fresh = await api.get('getCustomerQuote', { id })
                        setData(fresh.data)
                      },
                    })
                  }}
                >
                  标记未成交
                </Button>
              )}
              {data.deal_status !== 'pending' && (
                <Button
                  size="small"
                  type="link"
                  onClick={async () => {
                    await api.post('setDealStatus', { quote_id: id, status: 'pending' })
                    const fresh = await api.get('getCustomerQuote', { id })
                    setData(fresh.data)
                  }}
                >
                  重置
                </Button>
              )}
            </Space>
          </div>

          <Space style={{ marginTop: 16 }} wrap>
            <Button onClick={() => window.open(`/quotes/${id}/print`, '_blank')}>
              打印 / 导出 报价单
            </Button>
            {data.invoice_no ? (
              <>
                <Button
                  type="primary"
                  onClick={() => window.open(`/quotes/${id}/invoice`, '_blank')}
                >
                  打开发票 {data.invoice_no}
                </Button>
                {data.paid_at ? (
                  <Button
                    onClick={async () => {
                      await api.post('markInvoicePaid', { id, paid: 0 })
                      message.success('已标记为未收款')
                      const r = await api.get('getCustomerQuote', { id })
                      setData(r.data)
                    }}
                  >
                    撤销收款标记
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    ghost
                    onClick={async () => {
                      await api.post('markInvoicePaid', { id, paid: 1 })
                      message.success('已标记为已收款')
                      const r = await api.get('getCustomerQuote', { id })
                      setData(r.data)
                    }}
                  >
                    标记已收款
                  </Button>
                )}
              </>
            ) : (
              <IssueInvoiceButton
                quoteId={id!}
                onIssued={async () => {
                  const fresh = await api.get('getCustomerQuote', { id })
                  setData(fresh.data)
                }}
              />
            )}
            {data.invoice_no && (
              <EditInvoiceBankButton quote={data} onSaved={async () => {
                const fresh = await api.get('getCustomerQuote', { id })
                setData(fresh.data)
              }} />
            )}
            {data.status === 'draft' && (
              <Button onClick={send}>发送给客户</Button>
            )}
            {(data.status === 'draft' || data.status === 'to_review') && (
              <Popconfirm title="确认删除？" onConfirm={del}>
                <Button danger>删除</Button>
              </Popconfirm>
            )}
          </Space>

          <FollowLogs quoteId={id!} />
        </>
      )}
    </Drawer>
  )
}

function FollowLogs({ quoteId }: { quoteId: number }) {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const meId = Number(localStorage.getItem('user_id') || 0)
  const meRole = localStorage.getItem('role') || ''

  const load = async () => {
    if (!quoteId) return
    setLoading(true)
    try {
      const r = await api.get('listQuoteFollowLogs', { quote_id: quoteId })
      setLogs(r.items || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!quoteId) return
    load()
  }, [quoteId])

  const submit = async () => {
    if (!content.trim()) {
      message.warning('请输入跟进内容')
      return
    }
    setSubmitting(true)
    try {
      await api.post('addQuoteFollowLog', { quote_id: quoteId, content: content.trim() })
      setContent('')
      load()
    } finally {
      setSubmitting(false)
    }
  }

  const del = async (id: number) => {
    await api.post('deleteQuoteFollowLog', { id })
    load()
  }

  return (
    <div style={{ marginTop: 32 }}>
      <h4 style={{ marginBottom: 12 }}>跟进日志</h4>
      <Input.TextArea
        rows={2}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="例如：客户要求降价 5%；下周二再回访..."
        maxLength={2000}
        showCount
      />
      <div style={{ marginTop: 8, marginBottom: 16, textAlign: 'right' }}>
        <Button type="primary" loading={submitting} onClick={submit}>
          添加跟进
        </Button>
      </div>

      {loading ? (
        '加载中...'
      ) : logs.length === 0 ? (
        <Empty description="还没有跟进记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Timeline
          items={logs.map((l) => ({
            color: 'blue',
            children: (
              <div>
                <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>
                  <strong style={{ color: '#1f1f1f' }}>{l.user_name || '系统'}</strong>
                  <span style={{ marginLeft: 8 }}>{l.created_at}</span>
                  {(l.user_id === meId || meRole === 'admin') && (
                    <Popconfirm title="删除这条跟进？" onConfirm={() => del(l.id)}>
                      <a style={{ marginLeft: 12, color: '#ff4d4f', fontSize: 12 }}>
                        <DeleteOutlined /> 删除
                      </a>
                    </Popconfirm>
                  )}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{l.content}</div>
              </div>
            ),
          }))}
        />
      )}
    </div>
  )
}


function EditQuoteTermsButton({ quote, onSaved }: { quote: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [validUntil, setValidUntil] = useState<string>('')
  const [productionCycle, setProductionCycle] = useState<string>('')

  const init = () => {
    setValidUntil((quote.valid_until || '').slice(0, 10))
    setProductionCycle(quote.production_cycle || '')
    setOpen(true)
  }
  const submit = async () => {
    await api.post('updateQuoteTerms', {
      id: quote.id,
      valid_until: validUntil ? validUntil + ' 23:59:59' : null,
      production_cycle: productionCycle,
    })
    message.success('已更新')
    setOpen(false)
    onSaved()
  }
  return (
    <>
      <a onClick={init} style={{ fontSize: 12 }}>编辑</a>
      <Modal
        title="修改报价有效期 / 生产周期"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        zIndex={9999}
        destroyOnClose
        width={520}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Typography.Text type="secondary">报价有效期至（YYYY-MM-DD）</Typography.Text>
            <Input
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              placeholder="如 2026-07-15"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Typography.Text type="secondary">生产周期</Typography.Text>
            <Input
              value={productionCycle}
              onChange={(e) => setProductionCycle(e.target.value)}
              placeholder="如 15-20 个工作日 / 现货 / 30 天"
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </>
  )
}

function IssueInvoiceButton({ quoteId, onIssued }: { quoteId: number; onIssued: () => void }) {
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const init = async () => {
    const r = await api.get('listSettings')
    const sm: Record<string, string> = Object.fromEntries(
      (r.items || []).map((s: any) => [s.key, s.value]),
    )
    form.setFieldsValue({
      bank_name: sm.bank_name || 'BCA',
      bank_account_no: sm.bank_account_no || '',
      bank_account_name: sm.bank_account_name || '',
      bank_swift: sm.bank_swift || '',
    })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      const r = await api.post('issueInvoice', { id: quoteId, ...v })
      message.success(`已开具发票 ${r.invoice_no}`)
      setOpen(false)
      onIssued()
      window.open(`/quotes/${quoteId}/invoice`, '_blank')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button type="primary" onClick={init}>开具发票</Button>
      <Modal
        title="开具发票 — 确认收款账户"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="确认开票"
        cancelText="取消"
        confirmLoading={submitting}
        zIndex={9999}
        destroyOnClose
        width={520}
      >
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 16 }}>
          默认填入系统设置里的收款账户，可针对这一张发票临时调整。
        </div>
        <Form form={form} layout="vertical">
          <Form.Item name="bank_name" label="银行 Bank">
            <Input placeholder="如 BCA / Mandiri" />
          </Form.Item>
          <Form.Item name="bank_account_no" label="账号 Account No." rules={[{ required: true }]}>
            <Input placeholder="账号" />
          </Form.Item>
          <Form.Item name="bank_account_name" label="账户名 Account Name" rules={[{ required: true }]}>
            <Input placeholder="账户名（开户人）" />
          </Form.Item>
          <Form.Item name="bank_swift" label="SWIFT（可选）">
            <Input placeholder="跨境付款用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function EditInvoiceBankButton({ quote, onSaved }: { quote: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const init = async () => {
    const r = await api.get('listSettings')
    const sm: Record<string, string> = Object.fromEntries(
      (r.items || []).map((s: any) => [s.key, s.value]),
    )
    form.setFieldsValue({
      bank_name: quote.invoice_bank_name || sm.bank_name || '',
      bank_account_no: quote.invoice_bank_account_no || sm.bank_account_no || '',
      bank_account_name: quote.invoice_bank_account_name || sm.bank_account_name || '',
      bank_swift: quote.invoice_bank_swift || sm.bank_swift || '',
    })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setSubmitting(true)
    try {
      await api.post('issueInvoice', { id: quote.id, ...v })
      message.success('收款账户已更新')
      setOpen(false)
      onSaved()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button onClick={init}>改收款账户</Button>
      <Modal
        title="修改发票收款账户"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        zIndex={9999}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="bank_name" label="银行 Bank">
            <Input />
          </Form.Item>
          <Form.Item name="bank_account_no" label="账号 Account No." rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="bank_account_name" label="账户名 Account Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="bank_swift" label="SWIFT（可选）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function QuickInvoice({ onOk }: { onOk: () => void }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [customerId, setCustomerId] = useState<number | undefined>()
  const [currency, setCurrency] = useState<"IDR" | "CNY">("IDR")
  const [taxIncluded, setTaxIncluded] = useState(true)
  const [taxRate, setTaxRate] = useState(11)
  const [rows, setRows] = useState<any[]>([])
  const [remark, setRemark] = useState("")
  const [companyName, setCompanyName] = useState("星选建材")
  const [bankName, setBankName] = useState("BCA")
  const [bankNo, setBankNo] = useState("")
  const [bankHolder, setBankHolder] = useState("")

  useEffect(() => {
    api.get("listSettings").then((r) => {
      const sm: Record<string, string> = Object.fromEntries(
        (r.items || []).map((s: any) => [s.key, s.value]),
      )
      if (sm.company_name) setCompanyName(sm.company_name)
      setBankName(sm.bank_name || "BCA")
      setBankNo(sm.bank_account_no || "")
      setBankHolder(sm.bank_account_name || "")
    })
  }, [])

  const reset = () => {
    setCustomerId(undefined)
    setRows([])
    setRemark("")
    setCurrency("IDR")
    setTaxIncluded(true)
    setTaxRate(11)
  }

  const updateRow = (idx: number, patch: any) =>
    setRows((p) => p.map((r, i) => (i === idx ? { ...r, ...patch } : r)))

  const addRow = () =>
    setRows((p) => [...p, { product_name: "", spec: "", qty: 1, unit: "件", sell_price: 0, brand: "", model: "", show_brand: 1 }])

  const removeRow = (idx: number) =>
    setRows((p) => p.filter((_, i) => i !== idx))

  const aiTextRef = { current: "" } as { current: string }

  const aiParseText = async (text: string) => {
    if (!text.trim()) {
      message.warning("请粘贴文本")
      return
    }
    setAiParsing(true)
    try {
      const res = await api.post("aiParseInquiryText", { text })
      mergeAi(res)
    } catch (e: any) {
      message.error(e?.message || "AI 解析失败")
    } finally {
      setAiParsing(false)
    }
  }

  const aiParseFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      message.error("文件不能超过 20MB")
      return
    }
    setAiParsing(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await api.upload("aiParseInquiryFile", fd)
      mergeAi(res)
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || "AI 识别失败")
    } finally {
      setAiParsing(false)
    }
  }

  const mergeAi = (res: any) => {
    const aiItems = res.items || []
    if (aiItems.length === 0) {
      message.warning("AI 没识别到产品行")
      return
    }
    setRows((p) => [
      ...p,
      ...aiItems.map((it: any) => ({
        product_name: it.product_name || "",
        spec: it.spec || "",
        qty: Number(it.qty) || 1,
        unit: it.unit || "件",
        sell_price: 0,
        brand: "",
        model: "",
        show_brand: 1,
      })),
    ])
    if (res.remark) {
      setRemark((r) => (r ? r + "\n" + res.remark : res.remark))
    }
    message.success(`识别到 ${aiItems.length} 行，请补齐单价`)
  }

  const total = rows.reduce((s, r) => s + (Number(r.sell_price) || 0) * (Number(r.qty) || 0), 0)
  const sym = currency === "IDR" ? "Rp" : "¥"

  const submit = async () => {
    if (!customerId) return message.warning("请选择客户")
    const valid = rows.filter((r) => r.product_name && r.qty > 0 && r.sell_price > 0)
    if (valid.length === 0) return message.warning("请至少填一行有效明细（产品名/数量/单价）")
    setSubmitting(true)
    try {
      const res = await api.post("quickCreateInvoice", {
        customer_id: customerId,
        currency,
        tax_included: taxIncluded ? 1 : 0,
        tax_rate: taxRate / 100,
        items: valid,
        remark,
        bank_name: bankName,
        bank_account_no: bankNo,
        bank_account_name: bankHolder,
      })
      message.success(`已生成发票 ${res.invoice_no}`)
      window.open(`/quotes/${res.quote_id}/invoice`, "_blank")
      setOpen(false)
      reset()
      onOk()
    } catch (e: any) {
      message.error(e?.message || "生成失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setOpen(true)}>
        快速开发票
      </Button>
      <Modal
        title="快速开发票（跳过派单流程，直接生成）"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        okText={`开票（合计 ${sym} ${total.toLocaleString()}）`}
        cancelText="取消"
        width={1000}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Typography.Text type="secondary">客户 *</Typography.Text>
            <ProFormSelect
              noStyle
              fieldProps={{ style: { width: 480, marginLeft: 12 } }}
              showSearch
              placeholder="搜索客户名/编号/电话"
              onChange={(v: any) => setCustomerId(v)}
              request={async () => {
                const [data, st] = await Promise.all([
                  api.get("listCustomers", { page_size: 200 }),
                  api.get("listSettings"),
                ])
                const sm: Record<string, string> = Object.fromEntries(
                  (st.items || []).map((s: any) => [s.key, s.value]),
                )
                const cn = sm.company_name || companyName
                return data.items.map((c: any) => ({
                  label: `[${cn} ${c.code || c.id}] ${c.short_name || c.name}${c.company ? "（" + c.company + "）" : ""}`,
                  value: c.id,
                }))
              }}
            />
          </div>

          <Space wrap size={16}>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>货币</Typography.Text>
              <Radio.Group value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <Radio.Button value="IDR">Rp 印尼盾</Radio.Button>
                <Radio.Button value="CNY">¥ 人民币</Radio.Button>
              </Radio.Group>
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>单价含税</Typography.Text>
              <Switch checked={taxIncluded} onChange={setTaxIncluded} />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>税率</Typography.Text>
              <InputNumber value={taxRate} min={0} max={100} addonAfter="%" onChange={(v) => setTaxRate(Number(v ?? 11))} style={{ width: 110 }} />
            </span>
          </Space>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Typography.Text type="secondary">从供应商报价快速导入：</Typography.Text>
            <Input.TextArea
              rows={2}
              style={{ width: 360 }}
              placeholder="粘贴文字清单，回车后点「解析」"
              onChange={(e) => (aiTextRef.current = e.target.value)}
              onPressEnter={(e) => {
                e.preventDefault()
                aiParseText(aiTextRef.current)
              }}
            />
            <Button size="small" loading={aiParsing} onClick={() => aiParseText(aiTextRef.current)}>
              AI 解析文字
            </Button>
            <Upload
              accept="image/*,.pdf,.xlsx,.csv,.txt"
              showUploadList={false}
              beforeUpload={(f) => {
                aiParseFile(f)
                return false
              }}
            >
              <Button size="small" icon={<PictureOutlined />} loading={aiParsing}>
                AI 识别文件（图/PDF/Excel）
              </Button>
            </Upload>
          </div>

          <Table
            size="small"
            rowKey={(_, idx) => String(idx)}
            dataSource={rows}
            pagination={false}
            locale={{ emptyText: "点击下方「添加一行」或使用上方 AI 解析" }}
            columns={[
              { title: "#", width: 40, render: (_, _r, i) => i + 1 },
              {
                title: "产品名 *",
                width: 180,
                render: (_, r: any, i) => (
                  <Input size="small" value={r.product_name} onChange={(e) => updateRow(i, { product_name: e.target.value })} />
                ),
              },
              {
                title: "规格",
                width: 140,
                render: (_, r: any, i) => (
                  <Input size="small" value={r.spec} onChange={(e) => updateRow(i, { spec: e.target.value })} />
                ),
              },
              {
                title: "数量 *",
                width: 90,
                render: (_, r: any, i) => (
                  <InputNumber size="small" min={0} value={r.qty} onChange={(v) => updateRow(i, { qty: Number(v ?? 0) })} style={{ width: "100%" }} />
                ),
              },
              {
                title: "单位",
                width: 70,
                render: (_, r: any, i) => (
                  <Input size="small" value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} />
                ),
              },
              {
                title: "品牌",
                width: 110,
                render: (_, r: any, i) => (
                  <Input size="small" value={r.brand} onChange={(e) => updateRow(i, { brand: e.target.value })} placeholder="可选" />
                ),
              },
              {
                title: "型号",
                width: 110,
                render: (_, r: any, i) => (
                  <Input size="small" value={r.model} onChange={(e) => updateRow(i, { model: e.target.value })} placeholder="可选" />
                ),
              },
              {
                title: `单价 (${sym}) *`,
                width: 110,
                render: (_, r: any, i) => (
                  <InputNumber size="small" min={0} step={0.01} value={r.sell_price} onChange={(v) => updateRow(i, { sell_price: Number(v ?? 0) })} style={{ width: "100%" }} />
                ),
              },
              {
                title: "小计",
                width: 100,
                render: (_, r: any) => {
                  const sub = (Number(r.sell_price) || 0) * (Number(r.qty) || 0)
                  return <strong style={{ color: sub > 0 ? "#1d57e0" : "#bfbfbf" }}>{sym} {sub.toLocaleString()}</strong>
                },
              },
              {
                title: "",
                width: 40,
                render: (_, _r, i) => (
                  <Button size="small" type="link" danger onClick={() => removeRow(i)}>
                    <DeleteOutlined />
                  </Button>
                ),
              },
            ]}
            footer={() => (
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addRow}>
                添加一行
              </Button>
            )}
          />

          <div>
            <Typography.Text type="secondary">备注（可选）</Typography.Text>
            <Input.TextArea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} style={{ marginTop: 4 }} />
          </div>

          <div style={{ background: "#fafbfc", padding: 12, borderRadius: 6, borderLeft: "3px solid #1d57e0" }}>
            <Typography.Text strong style={{ color: "#1d57e0" }}>收款账户</Typography.Text>
            <span style={{ marginLeft: 8, color: "#8c8c8c", fontSize: 12 }}>默认填入系统设置，可临时改</span>
            <Space style={{ marginTop: 8, display: "flex" }} wrap>
              <Input style={{ width: 140 }} placeholder="银行" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              <Input style={{ width: 200 }} placeholder="账号" value={bankNo} onChange={(e) => setBankNo(e.target.value)} />
              <Input style={{ width: 200 }} placeholder="账户名" value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} />
            </Space>
          </div>
        </Space>
      </Modal>
    </>
  )
}

// ============== 转换供应商报价 ==============
function ConvertSupplierQuote({ onOk }: { onOk: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [customerId, setCustomerId] = useState<number | undefined>()
  const [supplierName, setSupplierName] = useState('')
  const [markupPct, setMarkupPct] = useState<number>(15)
  const [currency, setCurrency] = useState<'IDR' | 'CNY'>('IDR')
  const [taxIncluded, setTaxIncluded] = useState(true)
  const [taxRate, setTaxRate] = useState(11)
  const [productionCycle, setProductionCycle] = useState('15-20 个工作日')
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')

  const reset = () => {
    setCustomerId(undefined)
    setSupplierName('')
    setMarkupPct(15)
    setCurrency('IDR')
    setTaxIncluded(true)
    setTaxRate(11)
    setInputMode('file')
    setFile(null)
    setText('')
  }

  const submit = async () => {
    if (!customerId) return message.warning('请选客户')
    if (inputMode === 'file' && !file) return message.warning('请上传供应商报价文件')
    if (inputMode === 'text' && !text.trim()) return message.warning('请粘贴报价文本')
    setBusy(true)
    try {
      const fd = new FormData()
      if (inputMode === 'text') {
        fd.append('text', text.trim())
      } else {
        // PDF → 浏览器内转图（绕过服务器 poppler / open_basedir 限制）
        let uploadFile = file!
        try {
          uploadFile = await convertPdfToImageIfNeeded(file!)
          if (uploadFile !== file) {
            message.info('PDF 已在浏览器内转为图片，开始识别…', 2)
          }
        } catch (e: any) {
          message.error('PDF 转图失败：' + (e?.message || ''))
          setBusy(false)
          return
        }
        fd.append('file', uploadFile)
      }
      fd.append('customer_id', String(customerId))
      fd.append('supplier_name', supplierName)
      fd.append('currency', currency)
      fd.append('tax_included', taxIncluded ? '1' : '0')
      fd.append('tax_rate', String(taxRate / 100))
      fd.append('markup_pct', String(markupPct))
      fd.append('production_cycle', productionCycle)
      const res = await api.upload('convertSupplierQuote', fd)
      const imgs = res.extracted_images || []
      const sym = currency === 'IDR' ? 'Rp' : '¥'
      const det = res.detected || {}
      const detTxt = det.supplier_name ? `（AI 识别供应商: ${det.supplier_name}）` : ''
      message.success(`已生成 ${res.quote_no}，${res.items_count} 行，合计 ${sym} ${Number(res.total).toLocaleString()}${imgs.length ? `，提取 ${imgs.length} 张产品图` : ''}${detTxt}`)
      if (imgs.length > 0) {
        Modal.info({
          title: `从 PDF 提取的产品图（${imgs.length} 张）`,
          width: 720,
          content: (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, maxHeight: 480, overflow: 'auto' }}>
              {imgs.map((u: string, i: number) => (
                <div key={i} style={{ border: '1px solid #f0f0f0', borderRadius: 4, padding: 4 }}>
                  <img src={u} style={{ width: '100%', height: 100, objectFit: 'contain' }} />
                  <a href={u} target="_blank" rel="noreferrer" style={{ fontSize: 11, display: 'block', textAlign: 'center', marginTop: 2 }}>下载</a>
                </div>
              ))}
            </div>
          ),
          okText: '关闭',
        })
      }
      setOpen(false)
      reset()
      onOk()
      window.open(`/quotes/${res.quote_id}/print`, '_blank')
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '转换失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="primary" ghost onClick={() => setOpen(true)}>
        🎯 一键转化商机
      </Button>
      <Modal
        title="一键转化商机 — 供应商报价 → 星选报价单"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={busy}
        okText="开始识别转换"
        cancelText="取消"
        width={780}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ background: '#f0f5ff', padding: 12, borderRadius: 6, borderLeft: '3px solid #1d57e0', fontSize: 13 }}>
            三种输入：<strong>📎 上传文件</strong>（图片 / PDF / Excel / CSV）或 <strong>📝 粘贴文字</strong>（微信里复制的报价文本）。AI 提取产品/规格/数量/单价 → 按下面的加价% 算对外价 → 生成星选抬头报价单。
          </div>

          <div>
            <Typography.Text type="secondary">客户 *</Typography.Text>
            <ProFormSelect
              noStyle
              fieldProps={{ style: { width: 420, marginLeft: 12 } }}
              showSearch
              placeholder="选择客户"
              onChange={(v: any) => setCustomerId(v)}
              request={async () => {
                const data = await api.get('listCustomers', { page_size: 200 })
                return data.items.map((c: any) => ({
                  label: `${c.short_name || c.name}${c.company ? '（' + c.company + '）' : ''}${c.code ? ' #' + c.code : ''}`,
                  value: c.id,
                }))
              }}
            />
          </div>

          <div>
            <Typography.Text type="secondary" style={{ marginRight: 8 }}>报价来源 *</Typography.Text>
            <Radio.Group value={inputMode} onChange={(e) => setInputMode(e.target.value)}>
              <Radio.Button value="file">📎 文件（图/PDF/Excel）</Radio.Button>
              <Radio.Button value="text">📝 粘贴文字</Radio.Button>
            </Radio.Group>
            {inputMode === 'file' && (
              <div style={{ marginTop: 8 }}>
                <Upload
                  accept="image/*,.pdf,.xlsx,.csv"
                  beforeUpload={(f) => { setFile(f); return false }}
                  onRemove={() => setFile(null)}
                  fileList={file ? [{ uid: '1', name: file.name, size: file.size, status: 'done' as const }] : []}
                >
                  <Button icon={<UploadOutlined />}>选择文件（≤30MB）</Button>
                </Upload>
              </div>
            )}
            {inputMode === 'text' && (
              <div style={{ marginTop: 8 }}>
                <Input.TextArea
                  rows={8}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`直接粘贴供应商发的报价内容，比如：\n\n50机制岩棉板  526米  Rp350,000  184,100,000\n3.5角铝  30支  Rp220,000  6,600,000\n6*8T梁  30支  Rp550,000  16,500,000\n合计 Rp207,200,000  PPN11% Rp22,792,000  总计 Rp229,992,000`}
                  maxLength={30000}
                  showCount
                />
              </div>
            )}
          </div>

          <Space wrap size={16}>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>供应商名（备注用，可空）</Typography.Text>
              <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="如 神州电缆" style={{ width: 180 }} />
            </span>
            <span>
              <Typography.Text type="secondary" style={{ marginRight: 8 }}>加价</Typography.Text>
              <InputNumber value={markupPct} onChange={(v) => setMarkupPct(Number(v ?? 0))} min={0} max={500} addonAfter="%" style={{ width: 110 }} />
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
              <InputNumber value={taxRate} onChange={(v) => setTaxRate(Number(v ?? 11))} min={0} max={100} addonAfter="%" style={{ width: 110 }} />
            </span>
          </Space>

          <div>
            <Typography.Text type="secondary" style={{ marginRight: 8 }}>生产周期</Typography.Text>
            <Input value={productionCycle} onChange={(e) => setProductionCycle(e.target.value)} placeholder="如 15-20 个工作日 / 现货" style={{ width: 280 }} />
          </div>

          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            提示：识别后自动建一条「客户报价（草稿）」，PDF 嵌入的产品图会一并提取出来（如有）。点开始后会自动打开星选抬头的报价单打印页。
          </Typography.Text>
        </Space>
      </Modal>
    </>
  )
}
