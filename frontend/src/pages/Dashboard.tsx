import { useEffect, useState } from 'react'
import { PageContainer } from '@ant-design/pro-components'
import { Card, Col, Empty, Radio, Row, Table, Tag, message } from 'antd'
import {
  TeamOutlined,
  FileSearchOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  RiseOutlined,
  WarningOutlined,
  FileDoneOutlined,
  ThunderboltOutlined,
  AlertOutlined,
  BellOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { copyText } from '../utils/copyText'

const ORDER_STATUS: Record<string, { color: string; text: string }> = {
  pending_contract: { color: 'orange', text: '待签合同' },
  in_progress: { color: 'processing', text: '履约中' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
}

const sym = (c: string) => (c === 'CNY' ? '¥' : 'Rp')
const fmtCur = (c: string, n: number) => `${sym(c)} ${Math.round(n).toLocaleString()}`

// 紧凑金额：IDR 用 B/M，CNY 用 万
function fmtCompact(cur: string, n: number): string {
  if (cur === 'CNY') {
    if (Math.abs(n) >= 1e4) return `¥ ${(n / 1e4).toFixed(1)}万`
    return `¥ ${Math.round(n).toLocaleString()}`
  }
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`
  return `Rp ${Math.round(n).toLocaleString()}`
}

interface Dashboard {
  overview: any
  deals: {
    by_currency: Array<{ currency: string; count: number; total: number; paid: number; unpaid: number }>
    this_month: Array<{ currency: string; cnt: number; total: number }>
    today: Array<{ currency: string; cnt: number; total: number }>
    by_supplier: Array<{ supplier_name: string; currency: string; cnt: number; total: number }>
    monthly: Array<{ ym: string; currency: string; cnt: number; total: number }>
    recent: any[]
    unpaid_orders: any[]
  }
}

function Kpi({
  title,
  value,
  sub,
  color,
  icon,
  onClick,
}: {
  title: string
  value: React.ReactNode
  sub?: React.ReactNode
  color: string
  icon: React.ReactNode
  onClick?: () => void
}) {
  return (
    <div className="gn-kpi" onClick={onClick}>
      <div className="t">{title}</div>
      <div className="v" style={{ color }}>{value}</div>
      <div className="s">{sub || ' '}</div>
      <span className="ico" style={{ color, background: color + '1a' }}>{icon}</span>
    </div>
  )
}

export default function DashboardPage() {
  const nav = useNavigate()
  const [data, setData] = useState<Dashboard | null>(null)
  const [idleMonths, setIdleMonths] = useState(1)
  const [idle, setIdle] = useState<any[]>([])
  const [companyName, setCompanyName] = useState('星选建材')

  useEffect(() => {
    api.get('dashboardOverview').then(setData)
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries((r.items || []).map((s: any) => [s.key, s.value]))
      if (sm.company_name) setCompanyName(sm.company_name)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.get('dashboardIdleCustomers', { months: idleMonths }).then((r) => setIdle(r.items || [])).catch(() => {})
  }, [idleMonths])

  if (!data) return <PageContainer title="工作台">加载中...</PageContainer>

  const ov = data.overview
  const deals = data.deals
  const byCur = deals.by_currency || []
  const today = deals.today || []
  const month = deals.this_month || []
  const monthly = deals.monthly || []
  const unpaidOrders = deals.unpaid_orders || []
  const todayCnt = today.reduce((s, x) => s + x.cnt, 0)

  const cur = (c: string) => byCur.find((x) => x.currency === c)
  const dealCnt = byCur.reduce((s, x) => s + x.count, 0)
  const bothCur = (fn: (c: any) => number) =>
    ['IDR', 'CNY']
      .map((k) => ({ k, v: fn(cur(k) || { total: 0, paid: 0, unpaid: 0 }) }))
      .filter((x) => x.v > 0)
      .map((x) => fmtCompact(x.k, x.v))
      .join(' / ') || '—'
  const monthAmt = ['IDR', 'CNY']
    .map((k) => ({ k, v: month.filter((m) => m.currency === k).reduce((s, m) => s + Number(m.total), 0) }))
    .filter((x) => x.v > 0)
    .map((x) => fmtCompact(x.k, x.v))
    .join(' / ') || '—'
  const monthCnt = month.reduce((s, x) => s + x.cnt, 0)

  // 月度柱状（按 IDR + CNY 分组合并）
  const monthlyByYm: Record<string, Record<string, number>> = {}
  for (const m of monthly) {
    if (!monthlyByYm[m.ym]) monthlyByYm[m.ym] = {}
    monthlyByYm[m.ym][m.currency] = Number(m.total)
  }
  const monthlyEntries = Object.entries(monthlyByYm).sort(([a], [b]) => a.localeCompare(b))
  const maxMonthly = Math.max(1, ...monthlyEntries.flatMap(([, v]) => Object.values(v)))

  const grpName = (r: any) => `[${companyName} ${r.customer_code || r.customer_id || r.id}] ${r.customer_short_name || r.customer_name || r.short_name || r.name || '-'}`
  const copyCode = (code: any) => {
    const t = String(code || '')
    copyText(t).then(() => message.success(`已复制群编号：${t}`)).catch(() => message.error('复制失败'))
  }

  return (
    <PageContainer title="工作台">
      {/* KPI 卡片 */}
      <div className="gn-kpi-grid">
        <Kpi title="客户总数" value={ov.customers} sub={`本月新增 ${ov.customers_new_month ?? 0}`}
          color="#722ed1" icon={<TeamOutlined />} onClick={() => nav('/customers')} />
        <Kpi title="商机总数" value={ov.inquiries_total}
          sub={`进行中 ${ov.inquiries_pending} · 待供应商回报 ${ov.dispatch_pending_response}`}
          color="#1d57e0" icon={<FileSearchOutlined />} onClick={() => nav('/inquiries')} />
        <Kpi title="累计成交" value={dealCnt} sub={`履约中 ${ov.orders_in_progress} · 已完成 ${ov.orders_completed}`}
          color="#52c41a" icon={<CheckCircleOutlined />} onClick={() => nav('/orders')} />
        <Kpi title="累计营收" value={bothCur((c) => Number(c.total))} sub="全部成交口径 (IDR / CNY)"
          color="#faad14" icon={<DollarOutlined />} onClick={() => nav('/orders')} />
        <Kpi title="本月营收" value={monthAmt} sub={`本月成交 ${monthCnt} 单`}
          color="#fa8c16" icon={<RiseOutlined />} onClick={() => nav('/orders')} />
        <Kpi title="今日新成交" value={todayCnt}
          sub={today.map((t) => fmtCompact(t.currency, Number(t.total))).join(' / ') || '—'}
          color="#13c2c2" icon={<ThunderboltOutlined />} onClick={() => nav('/orders')} />
        <Kpi title="报价情况" value={ov.quotes_sent} sub={`已发送 · 草稿/待审 ${ov.quotes_draft}`}
          color="#2f54eb" icon={<FileDoneOutlined />} onClick={() => nav('/quotes')} />
        <Kpi title="未收金额" value={bothCur((c) => Number(c.unpaid))} sub={`已收 ${bothCur((c) => Number(c.paid))}`}
          color="#f5222d" icon={<WarningOutlined />} onClick={() => nav('/orders')} />
      </div>

      {/* 双提醒面板 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card
            className="gn-panel gn-alert red"
            bordered={false}
            title={
              <span>
                <AlertOutlined style={{ color: '#f5222d', marginRight: 6 }} />
                应收款预警
                <Tag color="red" style={{ marginLeft: 8 }}>{unpaidOrders.length}</Tag>
              </span>
            }
          >
            {unpaidOrders.length === 0 ? (
              <Empty description="没有待收款订单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                dataSource={unpaidOrders}
                pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
                columns={[
                  {
                    title: '客户群',
                    render: (_, r: any) => (
                      <a onClick={() => copyCode(r.customer_code || r.customer_id)} title="点击复制群编号">
                        {grpName(r)}
                      </a>
                    ),
                  },
                  { title: '单号', render: (_, r: any) => <span style={{ fontSize: 12 }}>{r.contract_no || r.no}</span>, width: 150 },
                  {
                    title: '未收金额',
                    align: 'right' as const,
                    width: 140,
                    render: (_, r: any) => (
                      <strong style={{ color: '#f5222d', whiteSpace: 'nowrap' }}>{fmtCur(r.currency, Number(r.unpaid))}</strong>
                    ),
                  },
                  {
                    title: '状态',
                    width: 90,
                    render: (_, r: any) => <Tag color={ORDER_STATUS[r.status]?.color}>{ORDER_STATUS[r.status]?.text || r.status}</Tag>,
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col span={12}>
          <Card
            className="gn-panel gn-alert orange"
            bordered={false}
            title={
              <span>
                <BellOutlined style={{ color: '#fa8c16', marginRight: 6 }} />
                未产生商机客户提醒
                <Tag color="orange" style={{ marginLeft: 8 }}>{idle.length}</Tag>
              </span>
            }
            extra={
              <Radio.Group size="small" value={idleMonths} onChange={(e) => setIdleMonths(e.target.value)}>
                <Radio.Button value={1}>1个月</Radio.Button>
                <Radio.Button value={2}>2个月</Radio.Button>
                <Radio.Button value={3}>3个月</Radio.Button>
              </Radio.Group>
            }
          >
            {idle.length === 0 ? (
              <Empty description="所有客户近期都有商机" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey="id"
                dataSource={idle}
                pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
                columns={[
                  { title: '客户', render: (_, r: any) => r.short_name || r.name, width: 130, ellipsis: true },
                  {
                    title: '客户群',
                    render: (_, r: any) => (
                      <a onClick={() => copyCode(r.code || r.id)} title="点击复制群编号">
                        <CopyOutlined style={{ marginRight: 4 }} />
                        [{companyName} {r.code || r.id}] {r.short_name || r.name}
                      </a>
                    ),
                  },
                  {
                    title: '最后商机',
                    width: 100,
                    render: (_, r: any) => (
                      <span style={{ color: '#fa8c16' }}>{r.last_inquiry_at ? r.last_inquiry_at.slice(0, 10) : '从未'}</span>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* 月度趋势 + 流水/供应商 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card title="月度成交趋势（最近 12 月）" className="gn-panel" bordered={false}>
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

        <Col span={12}>
          <Card
            title="最近成交流水"
            className="gn-panel"
            bordered={false}
            extra={<a onClick={() => nav('/orders')}>查看全部</a>}
          >
            {deals.recent.length === 0 ? (
              <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              deals.recent.slice(0, 7).map((r: any) => (
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

          <Card title="按供应商成交（Top 10）" className="gn-panel" bordered={false} style={{ marginTop: 16 }}>
            {deals.by_supplier.length === 0 ? (
              <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                size="small"
                rowKey={(r: any) => `${r.supplier_name}-${r.currency}`}
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
