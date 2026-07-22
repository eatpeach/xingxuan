import { useEffect, useState } from 'react'
import { PageContainer } from '@ant-design/pro-components'
import { Button, Card, Col, Divider, Empty, Row, Table, Tag } from 'antd'
import {
  RightOutlined,
  FileSearchOutlined,
  FileDoneOutlined,
  ContainerOutlined,
  TeamOutlined,
} from '@ant-design/icons'
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

function StatCell({ num, label, go, onClick }: { num: number | string; label: string; go?: string; onClick: () => void }) {
  return (
    <div className="gn-cell" onClick={onClick}>
      <div className="gn-cell-main">
        <span className="gn-cell-num">{num}</span>
        <span className="gn-cell-label">{label}</span>
      </div>
      <span className="gn-cell-go">
        {go || '前往查看'} <RightOutlined style={{ fontSize: 10 }} />
      </span>
    </div>
  )
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
  const todayCnt = today.reduce((s, x) => s + x.cnt, 0)

  // 取每种货币的本月合计
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
      <Row gutter={[16, 16]}>
        <Col span={17}>
          {/* 成交概览（资金信息式大数字） */}
          <Card title="成交概览" className="gn-panel" bordered={false}>
            {byCur.length === 0 ? (
              <Empty description="还没有成交订单，先去「订单履约」录入或标记报价为已成交" />
            ) : (
              byCur.map((c, i) => (
                <div key={c.currency}>
                  {i > 0 && <Divider dashed style={{ margin: '20px 0' }} />}
                  <div className="gn-fund">
                    <div className="gn-fund-item">
                      <div className="t">总成交额（{c.currency}）</div>
                      <div className="v">{fmtCur(c.currency, c.total)}</div>
                    </div>
                    <div className="gn-fund-item">
                      <div className="t">已收金额</div>
                      <div className="v blue">{fmtCur(c.currency, c.paid)}</div>
                    </div>
                    <div className="gn-fund-item">
                      <div className="t">未收金额</div>
                      <div className="v red">{fmtCur(c.currency, c.unpaid)}</div>
                    </div>
                    <div className="gn-fund-item">
                      <div className="t">本月成交</div>
                      <div className="v">{fmtCur(c.currency, sumByCur(month, c.currency))}</div>
                    </div>
                    <div className="gn-fund-item">
                      <div className="t">成交单数</div>
                      <div className="v">{c.count}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
            <Divider dashed style={{ margin: '20px 0 16px' }} />
            <div className="gn-actions">
              <Button className="gn-btn" icon={<FileSearchOutlined />} onClick={() => nav('/inquiries')}>
                新建商机
              </Button>
              <Button className="gn-btn" icon={<FileDoneOutlined />} onClick={() => nav('/quotes')}>
                客户报价
              </Button>
              <Button className="gn-btn" icon={<ContainerOutlined />} onClick={() => nav('/orders')}>
                订单履约
              </Button>
              <Button className="gn-btn" icon={<TeamOutlined />} onClick={() => nav('/customers')}>
                客户管理
              </Button>
            </div>
          </Card>

          {/* 我的业务（灰色格子网格） */}
          <Card title="我的业务" className="gn-panel" bordered={false} style={{ marginTop: 16 }}>
            <div className="gn-cells">
              <StatCell num={ov.customers} label="个客户" go="前往管理" onClick={() => nav('/customers')} />
              <StatCell num={ov.inquiries_total} label="个询价单" onClick={() => nav('/inquiries')} />
              <StatCell num={ov.inquiries_pending} label="个进行中询价" onClick={() => nav('/inquiries')} />
              <StatCell num={ov.dispatch_pending_response} label="个待供应商回报" onClick={() => nav('/inquiries')} />
              <StatCell num={ov.quotes_draft} label="个报价草稿/待审" onClick={() => nav('/quotes')} />
              <StatCell num={ov.quotes_sent} label="个已发送报价" onClick={() => nav('/quotes')} />
              <StatCell num={todayCnt} label="单今日新成交" onClick={() => nav('/orders')} />
              <StatCell num={ov.orders_in_progress} label="个履约中订单" onClick={() => nav('/orders')} />
              <StatCell num={ov.orders_completed} label="个已完成订单" onClick={() => nav('/orders')} />
            </div>
          </Card>

          {/* 月度趋势条形图 */}
          <Card title="月度成交趋势（最近 12 月）" className="gn-panel" bordered={false} style={{ marginTop: 16 }}>
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
        </Col>

        <Col span={7}>
          {/* 最近成交流水（公告式列表） */}
          <Card
            title="最近成交流水"
            className="gn-panel"
            bordered={false}
            extra={
              <a onClick={() => nav('/orders')}>
                查看全部 <RightOutlined style={{ fontSize: 10 }} />
              </a>
            }
          >
            {deals.recent.length === 0 ? (
              <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              deals.recent.map((r: any) => (
                <div className="gn-news-row" key={r.id} onClick={() => nav('/orders')}>
                  <span className="name">{r.customer_short_name || r.customer_name || '-'}</span>
                  <span className="amt">{fmtCur(r.currency, Number(r.total_amount))}</span>
                  <Tag color={ORDER_STATUS[r.status]?.color} style={{ marginInlineEnd: 0 }}>
                    {ORDER_STATUS[r.status]?.text || r.status}
                  </Tag>
                  <span className="date">{r.created_at?.slice(5, 10)}</span>
                </div>
              ))
            )}
          </Card>

          {/* 按供应商 */}
          <Card title="按供应商成交（Top 10）" className="gn-panel" bordered={false} style={{ marginTop: 16 }}>
            {deals.by_supplier.length === 0 ? (
              <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                dataSource={deals.by_supplier}
                pagination={false}
                columns={[
                  { title: '供应商', dataIndex: 'supplier_name', ellipsis: true, render: (v) => <Tag color="purple">{v}</Tag> },
                  { title: '单数', dataIndex: 'cnt', width: 50, align: 'right' as const },
                  {
                    title: '金额',
                    dataIndex: 'total',
                    align: 'right' as const,
                    render: (v: any, r: any) => (
                      <strong style={{ whiteSpace: 'nowrap' }}>{fmtCur(r.currency, Number(v))}</strong>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  )
}
