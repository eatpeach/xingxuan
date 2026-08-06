import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  PageContainer,
  ProCard,
  ProFormDigit,
  ProFormSelect,
} from '@ant-design/pro-components'
import {
  Alert,
  Button,
  Empty,
  InputNumber,
  Radio,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { api } from '../api'

interface Offer {
  supplier_quote_item_id: number
  supplier_quote_id: number
  supplier_id: number
  supplier_name: string
  brand: string
  model: string
  spec: string
  supplier_price: number
  lead_time: string
  remark: string
}
interface Row {
  inquiry_item_id: number
  line_no: number
  product_name: string
  spec: string
  qty: number
  unit: string
  target_price: number | null
  offers: Offer[]
}

type StrategyType = 'flat_pct' | 'per_item_pct' | 'per_item_fixed'

interface LineState {
  inquiry_item_id: number
  picked: number | null            // supplier_quote_item_id
  show_brand: boolean
  qty: number
  cost_price: number
  // per_item_* 时的单行 payload
  pct_or_fixed: number | null
}

const STRATEGY_OPTIONS: { label: string; value: StrategyType; hint: string }[] = [
  { label: '整单 +N%', value: 'flat_pct', hint: '每行成本价 × (1 + N%)' },
  { label: '逐行 +N%', value: 'per_item_pct', hint: '每行单独设百分比' },
  { label: '逐行加固定金额', value: 'per_item_fixed', hint: '每行单独加金额' },
]

export default function InquiryComparePage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const inquiryId = Number(id)

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [defaultPct, setDefaultPct] = useState<number>(15)
  const [hideBrandDefault, setHideBrandDefault] = useState<boolean>(true)
  const [submitting, setSubmitting] = useState(false)

  const [strategy, setStrategy] = useState<StrategyType>('flat_pct')
  const [flatPct, setFlatPct] = useState<number>(15)
  const [lines, setLines] = useState<Record<number, LineState>>({})
  const [validDays, setValidDays] = useState<number>(7)
  const [productionCycle, setProductionCycle] = useState<string>('15-20 个工作日')

  // 拉对比数据 + 系统设置
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cmp, settings] = await Promise.all([
          api.get('compareInquiry', { id: inquiryId }),
          api.get('listSettings'),
        ])
        if (!alive) return
        const sMap: Record<string, string> = Object.fromEntries(
          (settings.items || []).map((s: any) => [s.key, s.value]),
        )
        const pct = Number(sMap.default_markup_pct ?? 15)
        const hide = String(sMap.hide_supplier_brand_default ?? 'true') === 'true'
        setDefaultPct(pct)
        setFlatPct(pct)
        setHideBrandDefault(hide)
        const cmpRows: Row[] = cmp.rows || []
        setRows(cmpRows)
        // 初始化每行：默认选最低价
        const init: Record<number, LineState> = {}
        for (const r of cmpRows) {
          const cheapest = [...r.offers].sort((a, b) => a.supplier_price - b.supplier_price)[0]
          init[r.inquiry_item_id] = {
            inquiry_item_id: r.inquiry_item_id,
            picked: cheapest?.supplier_quote_item_id ?? null,
            show_brand: !hide,
            qty: r.qty,
            cost_price: cheapest?.supplier_price ?? 0,
            pct_or_fixed: null,
          }
        }
        setLines(init)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [inquiryId])

  // 实时算价（前端镜像 backend 的 applyMarkup 逻辑）
  const calc = useMemo(() => {
    let total = 0
    const detail: Record<number, { sell: number; markup: number; lineTotal: number }> = {}
    for (const r of rows) {
      const ln = lines[r.inquiry_item_id]
      if (!ln) continue
      const cost = Number(ln.cost_price) || 0
      let sell = cost
      if (strategy === 'flat_pct') {
        sell = cost * (1 + flatPct / 100)
      } else if (strategy === 'per_item_pct') {
        const pct = Number(ln.pct_or_fixed ?? 0)
        sell = cost * (1 + pct / 100)
      } else if (strategy === 'per_item_fixed') {
        const add = Number(ln.pct_or_fixed ?? 0)
        sell = cost + add
      }
      sell = Math.round(sell * 100) / 100
      const markup = Math.round((sell - cost) * 100) / 100
      const lineTotal = Math.round(sell * Number(ln.qty || 0) * 100) / 100
      total += lineTotal
      detail[r.inquiry_item_id] = { sell, markup, lineTotal }
    }
    return { total: Math.round(total * 100) / 100, detail }
  }, [rows, lines, strategy, flatPct])

  const updateLine = (iid: number, patch: Partial<LineState>) =>
    setLines((prev) => ({ ...prev, [iid]: { ...prev[iid], ...patch } }))

  // 当 picked 改变时同步 cost_price
  const onPickOffer = (row: Row, offerId: number | null) => {
    const offer = row.offers.find((o) => o.supplier_quote_item_id === offerId)
    updateLine(row.inquiry_item_id, {
      picked: offerId,
      cost_price: offer?.supplier_price ?? 0,
    })
  }

  const submit = async () => {
    const payloadItems = rows
      .filter((r) => lines[r.inquiry_item_id]?.picked != null || lines[r.inquiry_item_id]?.cost_price > 0)
      .map((r) => {
        const ln = lines[r.inquiry_item_id]
        return {
          inquiry_item_id: r.inquiry_item_id,
          source_supplier_quote_item_id: ln.picked,
          show_brand: ln.show_brand ? 1 : 0,
          qty: ln.qty,
          cost_price: ln.cost_price,
        }
      })

    if (payloadItems.length === 0) {
      message.warning('至少要为一行选择供应商或填成本价')
      return
    }

    let markup: any = { type: strategy, value: flatPct }
    if (strategy === 'per_item_pct' || strategy === 'per_item_fixed') {
      const payload: Record<string, number> = {}
      for (const r of rows) {
        const v = lines[r.inquiry_item_id]?.pct_or_fixed
        if (v != null) payload[String(r.inquiry_item_id)] = Number(v)
      }
      markup = { type: strategy, payload }
    }

    setSubmitting(true)
    try {
      // 计算有效期
      const validUntil = new Date(Date.now() + validDays * 86400000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ')
      const data = await api.post('buildCustomerQuote', {
        inquiry_id: inquiryId,
        markup,
        items: payloadItems,
        valid_until: validUntil,
        production_cycle: productionCycle,
      })
      message.success(`已生成 ${data.no}，总价 ${Number(data.total).toLocaleString()}（货币/税点已沿用所选供应商报价）`)
      // 报价已并入商机的「对客报价」步骤，回商机而不是已下线的菜单页
      nav('/admin/inquiries', { state: { openInquiryId: id } })
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      title: '#',
      dataIndex: 'line_no',
      width: 50,
      render: (_: any, r: Row) => r.line_no,
    },
    {
      title: '产品 / 规格 / 数量',
      width: 220,
      render: (_: any, r: Row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.product_name}</div>
          <div style={{ color: '#666', fontSize: 12 }}>{r.spec}</div>
          <div style={{ color: '#999', fontSize: 12 }}>
            {r.qty} {r.unit}
            {r.target_price ? `（目标 ¥${r.target_price}）` : ''}
          </div>
        </div>
      ),
    },
    {
      title: '供应商报价（点选）',
      render: (_: any, r: Row) => {
        if (!r.offers.length) return <Tag color="warning">尚无供应商报价</Tag>
        const ln = lines[r.inquiry_item_id]
        return (
          <Radio.Group
            value={ln?.picked ?? null}
            onChange={(e) => onPickOffer(r, e.target.value)}
          >
            <Space direction="vertical" size={4}>
              {r.offers.map((o) => (
                <Radio key={o.supplier_quote_item_id} value={o.supplier_quote_item_id}>
                  <Space size={4}>
                    <Tag color="blue">{o.supplier_name}</Tag>
                    {o.brand && <span style={{ color: '#666' }}>{o.brand}</span>}
                    {o.model && <span style={{ color: '#999', fontSize: 12 }}>{o.model}</span>}
                    <strong>¥ {Number(o.supplier_price).toLocaleString()}</strong>
                    {o.lead_time && <span style={{ color: '#999' }}>· 货期 {o.lead_time}</span>}
                  </Space>
                </Radio>
              ))}
              <Radio value={null}>不采用，手填成本</Radio>
            </Space>
          </Radio.Group>
        )
      },
    },
    {
      title: '成本价',
      width: 130,
      render: (_: any, r: Row) => (
        <InputNumber
          size="small"
          min={0}
          step={0.01}
          value={lines[r.inquiry_item_id]?.cost_price}
          onChange={(v) => updateLine(r.inquiry_item_id, { cost_price: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: strategy === 'per_item_fixed' ? '加固定金额' : '本行 %',
      width: 110,
      render: (_: any, r: Row) => {
        if (strategy === 'flat_pct') return <span style={{ color: '#999' }}>整单</span>
        return (
          <InputNumber
            size="small"
            value={lines[r.inquiry_item_id]?.pct_or_fixed ?? undefined}
            onChange={(v) => updateLine(r.inquiry_item_id, { pct_or_fixed: v == null ? null : Number(v) })}
          />
        )
      },
    },
    {
      title: '售价',
      width: 110,
      render: (_: any, r: Row) => (
        <strong style={{ color: '#1677ff' }}>
          ¥ {(calc.detail[r.inquiry_item_id]?.sell ?? 0).toLocaleString()}
        </strong>
      ),
    },
    {
      title: '行小计',
      width: 110,
      render: (_: any, r: Row) => (
        <span>¥ {(calc.detail[r.inquiry_item_id]?.lineTotal ?? 0).toLocaleString()}</span>
      ),
    },
    {
      title: (
        <Tooltip title={`默认值由系统设置 hide_supplier_brand_default 决定（当前 ${hideBrandDefault ? '隐藏' : '显示'}）`}>
          客户可见品牌
        </Tooltip>
      ),
      width: 110,
      render: (_: any, r: Row) => (
        <Switch
          size="small"
          checked={!!lines[r.inquiry_item_id]?.show_brand}
          onChange={(v) => updateLine(r.inquiry_item_id, { show_brand: v })}
        />
      ),
    },
  ]

  return (
    <PageContainer
      title={`询价对比 / 生成客户报价`}
      onBack={() => nav('/admin/inquiries')}
      backIcon={<ArrowLeftOutlined />}
      extra={[
        <Link key="back" to="/admin/inquiries">
          <Button icon={<ArrowLeftOutlined />}>返回询价</Button>
        </Link>,
      ]}
    >
      <ProCard bordered headerBordered>
        <Space size={16} wrap>
          <span>
            <Typography.Text type="secondary">加价策略</Typography.Text>
            <ProFormSelect
              noStyle
              fieldProps={{ style: { width: 160, marginLeft: 8 } }}
              options={STRATEGY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
              initialValue={strategy}
              onChange={(v: any) => setStrategy(v)}
            />
          </span>
          {strategy === 'flat_pct' && (
            <span>
              <Typography.Text type="secondary">百分比</Typography.Text>
              <InputNumber
                style={{ marginLeft: 8 }}
                value={flatPct}
                onChange={(v) => setFlatPct(Number(v ?? defaultPct))}
                addonAfter="%"
              />
            </span>
          )}
          <Tooltip title="货币 / 含税 / 税率沿用所选供应商报价的设置">
            <Tag color="blue" style={{ cursor: 'help' }}>
              货币 · 税点 沿用供应商
            </Tag>
          </Tooltip>
          <span>
            <Typography.Text type="secondary">报价有效期</Typography.Text>
            <InputNumber
              style={{ marginLeft: 8, width: 90 }}
              value={validDays}
              onChange={(v) => setValidDays(Number(v ?? 7))}
              addonAfter="天"
              min={1}
              max={365}
            />
          </span>
          <span>
            <Typography.Text type="secondary">生产周期</Typography.Text>
            <input
              style={{ marginLeft: 8, padding: '4px 8px', border: '1px solid #d9d9d9', borderRadius: 4, width: 160 }}
              value={productionCycle}
              onChange={(e) => setProductionCycle(e.target.value)}
              placeholder="如 15-20 个工作日 / 现货"
            />
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <Typography.Text type="secondary" style={{ marginRight: 8 }}>
              预计报价总额
            </Typography.Text>
            <Typography.Title level={3} style={{ display: 'inline', color: '#1677ff' }}>
              {calc.total.toLocaleString()}
            </Typography.Title>
          </span>
        </Space>
      </ProCard>

      <ProCard bordered style={{ marginTop: 16 }}>
        {loading ? (
          <Empty description="加载中..." />
        ) : rows.length === 0 ? (
          <Empty description="该询价单没有明细" />
        ) : (
          <Table
            rowKey="inquiry_item_id"
            dataSource={rows}
            columns={columns as any}
            pagination={false}
            size="small"
          />
        )}

        {!loading && rows.some((r) => r.offers.length === 0) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="部分行还没有供应商报价。可以等供应商提交后再来生成；或者直接填手动成本价生成预估报价。"
          />
        )}
      </ProCard>

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button
          type="primary"
          size="large"
          icon={<SaveOutlined />}
          loading={submitting}
          onClick={submit}
        >
          生成客户报价
        </Button>
      </div>
    </PageContainer>
  )
}
