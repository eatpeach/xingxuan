import { useEffect, useRef, useState } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import { Tag, message, Drawer, Descriptions, Table, Space, Button, Popconfirm } from 'antd'
import { api } from '../api'

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

  const cols: ProColumns<Quote>[] = [
    { title: '报价单号', dataIndex: 'no' },
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
      render: (_, r) => `¥ ${Number(r.total).toLocaleString()}`,
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
            <Descriptions.Item label="总金额">¥ {Number(data.total).toLocaleString()}</Descriptions.Item>
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
        </>
      )}
    </Drawer>
  )
}
