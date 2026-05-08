import { useEffect, useState } from 'react'
import { PageContainer, StatisticCard } from '@ant-design/pro-components'
import { Row, Col } from 'antd'
import { api } from '../api'

interface Overview {
  customers: number
  inquiries_total: number
  inquiries_pending: number
  dispatch_pending_response: number
  quotes_draft: number
  quotes_sent: number
}

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null)
  useEffect(() => {
    api.get('/dashboard/overview').then((r) => setData(r.data))
  }, [])
  const cards: Array<[string, number | undefined]> = [
    ['客户总数', data?.customers],
    ['询价单总数', data?.inquiries_total],
    ['进行中询价', data?.inquiries_pending],
    ['待供应商回报', data?.dispatch_pending_response],
    ['报价草稿/待审', data?.quotes_draft],
    ['已发送报价', data?.quotes_sent],
  ]
  return (
    <PageContainer title="工作台">
      <Row gutter={16}>
        {cards.map(([t, v]) => (
          <Col span={8} key={t} style={{ marginBottom: 16 }}>
            <StatisticCard statistic={{ title: t, value: v ?? '-' }} />
          </Col>
        ))}
      </Row>
    </PageContainer>
  )
}
