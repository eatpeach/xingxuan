import { useRef } from 'react'
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components'
import { Tag, message, Button } from 'antd'
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
      ],
    },
  ]

  return (
    <PageContainer
      title="客户报价"
      extra={[
        <Button key="hint" type="link" disabled>
          从询价对比页选行后生成报价
        </Button>,
      ]}
    >
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
    </PageContainer>
  )
}
