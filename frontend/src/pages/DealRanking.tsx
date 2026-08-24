import { useEffect, useMemo, useState } from 'react'
import { Alert, Empty, Modal, Radio, Table, Tabs, Tag, Tooltip } from 'antd'
import { TrophyOutlined } from '@ant-design/icons'
import { api } from '../api'

export interface CategoryRow {
  currency: string
  category: string
  total: number
  cost: number
  profit: number
  lines: number
  orders: number
  customers: number
}
export interface CustomerRow {
  customer_id: number
  customer_code: string
  customer_name: string
  customer_short_name: string
  customer_category: string
  currency: string
  orders: number
  total: number
  first_at: string
  last_at: string
}
export interface DealRanking {
  summary: { deal_customers: number; deal_orders: number; repeat_customers: number; avg_orders: number }
  categories: CategoryRow[]
  top_category: CategoryRow[]
  uncategorized_ratio: Array<{ currency: string; ratio: number }>
  customers: CustomerRow[]
}

export function useDealRanking() {
  const [data, setData] = useState<DealRanking | null>(null)
  useEffect(() => {
    api.get('dashboardDealRanking').then(setData).catch(() => {})
  }, [])
  return data
}

const RANK_COLOR = ['#d48806', '#8c8c8c', '#a8713a'] // 金银铜

function RankBadge({ i }: { i: number }) {
  if (i < 3) {
    return (
      <span style={{
        display: 'inline-block', width: 22, height: 22, lineHeight: '22px', textAlign: 'center',
        borderRadius: 11, fontSize: 12, fontWeight: 700, color: '#fff', background: RANK_COLOR[i],
      }}>{i + 1}</span>
    )
  }
  return <span style={{ color: '#8c8c8c', fontSize: 12 }}>{i + 1}</span>
}

/** 条形占比：一眼看出第一名甩开第二名多少 */
function Bar({ v, max, color }: { v: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0
  return (
    <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: 6, background: color, borderRadius: 3 }} />
    </div>
  )
}

export default function DealRankingModal({
  open,
  onClose,
  data,
  defaultTab = 'category',
  fmt,
}: {
  open: boolean
  onClose: () => void
  data: DealRanking | null
  defaultTab?: 'category' | 'customer'
  fmt: (cur: string, n: number) => string
}) {
  const [tab, setTab] = useState<string>(defaultTab)
  const [cur, setCur] = useState('IDR')
  useEffect(() => { if (open) setTab(defaultTab) }, [open, defaultTab])

  const cats = data?.categories || []
  const custs = data?.customers || []

  // 只在真有两种货币时才显示切换，避免平白多一排按钮
  const currencies = useMemo(() => {
    const s = new Set<string>()
    cats.forEach((c) => s.add(c.currency))
    custs.forEach((c) => s.add(c.currency))
    return Array.from(s)
  }, [cats, custs])
  useEffect(() => {
    if (currencies.length && !currencies.includes(cur)) setCur(currencies[0])
  }, [currencies])

  const catRows = cats.filter((c) => c.currency === cur)
  const custRows = custs.filter((c) => c.currency === cur)
  const catMax = Math.max(1, ...catRows.map((c) => c.total))
  const custMax = Math.max(1, ...custRows.map((c) => c.total))
  const catSum = catRows.reduce((s, c) => s + c.total, 0)
  const uncatRatio = data?.uncategorized_ratio?.find((r) => r.currency === cur)?.ratio || 0

  const curSwitch = currencies.length > 1 ? (
    <Radio.Group size="small" value={cur} onChange={(e) => setCur(e.target.value)} style={{ marginBottom: 12 }}>
      {currencies.map((c) => <Radio.Button key={c} value={c}>{c === 'CNY' ? '人民币' : '印尼盾'}</Radio.Button>)}
    </Radio.Group>
  ) : null

  const categoryPane = (
    <>
      {curSwitch}
      {uncatRatio > 0.3 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`有 ${Math.round(uncatRatio * 100)}% 的成交额归到「未分类」`}
          description="品类是从产品名和供应商经营品类推出来的。去「供应商管理」把经营品类填上，或在品类管理里补齐品类名，这个排行就准了。"
        />
      )}
      {catRows.length === 0 ? <Empty description="还没有成交数据" /> : (
        <Table
          rowKey={(r) => r.category}
          size="small"
          pagination={false}
          dataSource={catRows}
          columns={[
            { title: '', width: 44, align: 'center' as const, render: (_: any, __: any, i: number) => <RankBadge i={i} /> },
            {
              title: '品类', dataIndex: 'category',
              render: (v: string) => v === '未分类'
                ? <Tag color="default">未分类</Tag>
                : <span style={{ fontWeight: 600 }}>{v}</span>,
            },
            {
              title: '成交额', dataIndex: 'total', width: 200,
              render: (v: number, r: CategoryRow) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{fmt(r.currency, v)}</div>
                  <Bar v={v} max={catMax} color="#1d57e0" />
                </div>
              ),
            },
            {
              title: '占比', width: 70, align: 'right' as const,
              render: (_: any, r: CategoryRow) => `${catSum > 0 ? ((r.total / catSum) * 100).toFixed(1) : '0.0'}%`,
            },
            { title: '订单', dataIndex: 'orders', width: 64, align: 'right' as const },
            { title: '客户', dataIndex: 'customers', width: 64, align: 'right' as const },
            {
              title: '毛利', dataIndex: 'profit', width: 130, align: 'right' as const,
              render: (v: number, r: CategoryRow) => v > 0
                ? <span style={{ color: '#52c41a' }}>{fmt(r.currency, v)}</span>
                : <Tooltip title="历史补录单没有成本价，毛利算不出来"><span style={{ color: '#bfbfbf' }}>—</span></Tooltip>,
            },
          ]}
        />
      )}
    </>
  )

  const customerPane = (
    <>
      {curSwitch}
      {custRows.length === 0 ? <Empty description="还没有成交数据" /> : (
        <Table
          rowKey={(r) => `${r.customer_id}-${r.currency}`}
          size="small"
          pagination={custRows.length > 20 ? { pageSize: 20, size: 'small' } : false}
          dataSource={custRows}
          columns={[
            { title: '', width: 44, align: 'center' as const, render: (_: any, __: any, i: number) => <RankBadge i={i} /> },
            {
              title: '客户',
              render: (_: any, r: CustomerRow) => (
                <div>
                  <span style={{ fontWeight: 600 }}>{r.customer_short_name || r.customer_name || `#${r.customer_id}`}</span>
                  {r.customer_category && <Tag color="blue" style={{ marginLeft: 6 }}>{r.customer_category}</Tag>}
                </div>
              ),
            },
            {
              title: '成交额', dataIndex: 'total', width: 200,
              render: (v: number, r: CustomerRow) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{fmt(r.currency, v)}</div>
                  <Bar v={v} max={custMax} color="#52c41a" />
                </div>
              ),
            },
            {
              title: '成交单数', dataIndex: 'orders', width: 100, align: 'center' as const,
              render: (v: number) => v >= 2
                ? <Tag color="gold">{v} 单 · 复购</Tag>
                : <span>{v} 单</span>,
            },
            {
              title: '单均', width: 130, align: 'right' as const,
              render: (_: any, r: CustomerRow) => fmt(r.currency, r.orders > 0 ? r.total / r.orders : 0),
            },
            {
              title: '最近成交', dataIndex: 'last_at', width: 110,
              render: (v: string) => (v || '').slice(0, 10) || '—',
            },
          ]}
        />
      )}
    </>
  )

  const s = data?.summary
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={880}
      title={<span><TrophyOutlined style={{ color: '#d48806', marginRight: 8 }} />成交排行榜</span>}
    >
      {s && (
        <div style={{ display: 'flex', gap: 24, padding: '10px 14px', marginBottom: 12,
          background: '#f5f8ff', borderRadius: 8, border: '1px solid #e6efff' }}>
          <SumItem label="成交客户" value={`${s.deal_customers} 家`} />
          <SumItem label="成交订单" value={`${s.deal_orders} 单`} />
          <SumItem label="复购客户" value={`${s.repeat_customers} 家`} hint="成交 2 单及以上" />
          <SumItem label="人均成交" value={`${s.avg_orders} 单`} />
        </div>
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'category', label: '按品类', children: categoryPane },
          { key: 'customer', label: '按客户', children: customerPane },
        ]}
      />
    </Modal>
  )
}

function SumItem({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const body = (
    <div>
      <div style={{ fontSize: 12, color: '#8c8c8c' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#1d57e0' }}>{value}</div>
    </div>
  )
  return hint ? <Tooltip title={hint}>{body}</Tooltip> : body
}
