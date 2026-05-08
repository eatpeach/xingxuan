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
  Table,
  Space,
  Button,
  Popconfirm,
  Input,
  Timeline,
  Empty,
} from 'antd'
import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '../api'

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
    `[${companyName} ${r.customer_code || r.customer_id}] ${r.customer_short_name || r.customer_name || '-'}`

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
    { title: '报价单号', dataIndex: 'no', search: false },
    {
      title: '客户群名（点击复制）',
      width: 280,
      search: false,
      render: (_, r: any) => (
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
      ),
    },
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
    <PageContainer title="客户报价">
      <ProTable<Quote>
        actionRef={ref}
        rowKey="id"
        columns={cols}
        request={async (params) => {
          const data = await api.get('listCustomerQuotes', {
            keyword: (params as any).keyword || '',
            status: params.status,
            page: params.current,
            page_size: params.pageSize,
          })
          return { data: data.items, total: data.total, success: true }
        }}
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

function QuoteDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
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
            <Descriptions.Item label="询价单">{data.inquiry_id}</Descriptions.Item>
            <Descriptions.Item label="客户">{data.customer_id}</Descriptions.Item>
            <Descriptions.Item label="总金额">
              {(data.currency || 'IDR') === 'IDR' ? 'Rp' : '¥'} {Number(data.total).toLocaleString()}
              <Tag style={{ marginLeft: 8 }} color={Number(data.tax_included ?? 1) ? 'blue' : 'default'}>
                {Number(data.tax_included ?? 1) ? `含税 ${(Number(data.tax_rate ?? 0.11) * 100).toFixed(0)}%` : '不含税'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="有效期">{data.valid_until || '-'}</Descriptions.Item>
            <Descriptions.Item label="加价策略" span={2}>
              {data.markup_strategy ? JSON.stringify(data.markup_strategy) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {data.remark || '-'}
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

          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => window.open(`/quotes/${id}/print`, '_blank')}>
              打印 / 导出 PDF
            </Button>
            {data.status === 'draft' && (
              <Button type="primary" onClick={send}>
                发送给客户
              </Button>
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
