import { useEffect, useState } from 'react'
import { PageContainer, ProCard, StatisticCard } from '@ant-design/pro-components'
import { Card, Empty, Row, Col, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const ORDER_STATUS: Record<string, { color: string; text: string }> = {
  pending_contract: { color: 'orange', text: '待签合同' },
  in_progress: { color: 'processing', text: '履约中' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
}

const sym = (c: string) => (c === 'CNY' ? '¥' : 'Rp')
const fmtCur = (c: string, n: number) => `${sym(c)} ${Math.round(n).toLocaleString()}`

interface Dashboard {
  overview: any
  deals: {
    by_currency: Array<{ currency: string; count: number; total: number; paid: number; unpaid: number }>
    this_month: Array<{ currency: string; cnt: number; total: number }>
    today: Array<{ currency: string; cnt: number; total: number }>
    by_supplier: Array<{ supplier_name: string; currency: string; cnt: number; total: number }>
    monthly: Array<{ ym: string; currency: string; cnt: number; total: number }>
    recent: any[]
  }
}

export default function DashboardPage() {
  const nav = useNavigate()
  const [data, setData] = useState<Dashboard | null>(null)
  useEffect(() => {
    api.get('dashboardOverview').then(setData)
  }, [])

  if (!data) return <PageContainer title="工作台">加载中...</PageContainer>

  const ov = data.overview
  const deals = data.deals
  const byCur = deals.by_currency || []
  const today = deals.today || []
  const month = deals.this_month || []
  const monthly = deals.monthly || []

  // 取每种货币的本月/今日合计
  const sumByCur = (arr: any[], cur: string) =>
    arr.filter((x) => x.currency === cur).reduce((s, x) => s + Number(x.total || 0), 0)

  // 月度柱状（按 IDR + CNY 分组合并）
  const monthlyByYm: Record<string, Record<string, number>> = {}
  for (const m of monthly) {
    if (!monthlyByYm[m.ym]) monthlyByYm[m.ym] = {}
    monthlyByYm[m.ym][m.currency] = Number(m.total)
  }
  const monthlyEntries = Object.entries(monthlyByYm).sort(([a], [b]) => a.localeCompare(b))
  const maxMonthly = Math.max(1, ...monthlyEntries.flatMap(([, v]) => Object.values(v)))

  return (
    <PageContainer title="工作台">
      {/* 顶部 KPI */}
      <Row gutter={[12, 12]}>
        {byCur.length === 0 && (
          <Col span={24}>
            <Empty description="还没有成交订单，先去「订单履约」录入或标记报价为已成交" />
          </Col>
        )}
        {byCur.map((c) => (
          <Col span={24 / Math.max(2, byCur.length)} key={c.currency}>
            <Card size="small">
              <Statistic
                title={`总成交额（${c.currency}）`}
                value={Math.round(c.total).toLocaleString()}
                prefix={<span style={{ color: '#1d57e0' }}>{sym(c.currency)}</span>}
                valueStyle={{ color: '#1d57e0' }}
                suffix={<span style={{ fontSize: 12, color: '#8c8c8c' }}>· {c.count} 单</span>}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: '#8c8c8c' }}>
                <Tag color="success">已收 {fmtCur(c.currency, c.paid)}</Tag>
                <Tag color="warning">未收 {fmtCur(c.currency, c.unpaid)}</Tag>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="今日新成交" value={today.length === 0 ? 0 : today.reduce((s, x) => s + x.cnt, 0)} suffix="单" />
            <div style={{ marginTop: 4, fontSize: 12, color: '#8c8c8c' }}>
              {today.map((t) => `${sym(t.currency)} ${Math.round(t.total).toLocaleString()}`).join(' / ') || '无'}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="本月新成交" value={month.length === 0 ? 0 : month.reduce((s, x) => s + x.cnt, 0)} suffix="单" />
            <div style={{ marginTop: 4, fontSize: 12, color: '#8c8c8c' }}>
              {month.map((t) => `${sym(t.currency)} ${Math.round(Number(t.total)).toLocaleString()}`).join(' / ') || '无'}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="履约中订单" value={ov.orders_in_progress} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已完成订单" value={ov.orders_completed} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
      </Row>

      {/* 月度趋势条形图 */}
      <Card size="small" title="月度成交趋势（最近 12 月）" style={{ marginTop: 12 }}>
        {monthlyEntries.length === 0 ? (
          <Empty description="还没有数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', height: 180, gap: 8, padding: '8px 0' }}>
            {monthlyEntries.map(([ym, vals]) => {
              const idr = vals['IDR'] || 0
              const cny = vals['CNY'] || 0
              const idrH = (idr / maxMonthly) * 140
              const cnyH = (cny / maxMonthly) * 140
              return (
                <div key={ym} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
                    {idr > 0 && (
                      <div title={`IDR ${idr.toLocaleString()}`} style={{ width: '40%', height: idrH, background: 'linear-gradient(180deg, #4096ff, #1d57e0)', borderRadius: '3px 3px 0 0' }} />
                    )}
                    {cny > 0 && (
                      <div title={`CNY ${cny.toLocaleString()}`} style={{ width: '40%', height: cnyH, background: 'linear-gradient(180deg, #ff7875, #cf1322)', borderRadius: '3px 3px 0 0' }} />
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: '#8c8c8c' }}>{ym.slice(5)}</span>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#1d57e0', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />
          IDR
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#cf1322', borderRadius: 2, margin: '0 4px 0 12px', verticalAlign: 'middle' }} />
          CNY
        </div>
      </Card>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        {/* 按供应商 */}
        <Col span={12}>
          <Card size="small" title="按供应商成交（Top 10）">
            {deals.by_supplier.length === 0 ? (
              <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                dataSource={deals.by_supplier}
                pagination={false}
                columns={[
                  { title: '供应商', dataIndex: 'supplier_name', render: (v) => <Tag color="purple">{v}</Tag> },
                  { title: '货币', dataIndex: 'currency', width: 60 },
                  { title: '单数', dataIndex: 'cnt', width: 60, align: 'right' as const },
                  {
                    title: '金额',
                    dataIndex: 'total',
                    align: 'right' as const,
                    render: (v: any, r: any) => <strong>{fmtCur(r.currency, Number(v))}</strong>,
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        {/* 最近成交流水 */}
        <Col span={12}>
          <Card
            size="small"
            title="最近成交流水"
            extra={<a onClick={() => nav('/orders')}>全部</a>}
          >
            {deals.recent.length === 0 ? (
              <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                dataSource={deals.recent}
                pagination={false}
                columns={[
                  {
                    title: '日期',
                    dataIndex: 'created_at',
                    width: 80,
                    render: (v: any) => v?.slice(5, 10),
                  },
                  {
                    title: '客户',
                    render: (_, r: any) => r.customer_short_name || r.customer_name || '-',
                  },
                  {
                    title: '订单',
                    dataIndex: 'no',
                    render: (v, r: any) => (
                      <a onClick={() => nav('/orders')} style={{ fontSize: 12 }}>
                        {r.contract_no || v}
                      </a>
                    ),
                  },
                  {
                    title: '金额',
                    align: 'right' as const,
                    render: (_, r: any) => <strong>{fmtCur(r.currency, Number(r.total_amount))}</strong>,
                  },
                  {
                    title: '',
                    width: 70,
                    render: (_, r: any) => (
                      <Tag color={ORDER_STATUS[r.status]?.color}>{ORDER_STATUS[r.status]?.text || r.status}</Tag>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* 原有 KPI */}
      <Card size="small" title="业务概览" style={{ marginTop: 12 }}>
        <Row gutter={[12, 12]}>
          {[
            ['客户总数', ov.customers],
            ['询价单总数', ov.inquiries_total],
            ['进行中询价', ov.inquiries_pending],
            ['待供应商回报', ov.dispatch_pending_response],
            ['报价草稿/待审', ov.quotes_draft],
            ['已发送报价', ov.quotes_sent],
          ].map(([t, v]) => (
            <Col span={4} key={t as string}>
              <StatisticCard size="small" statistic={{ title: t as string, value: v as number }} />
            </Col>
          ))}
        </Row>
      </Card>
    </PageContainer>
  )
}
