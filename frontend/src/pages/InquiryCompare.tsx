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
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { ArrowLeftOutlined, InfoCircleOutlined, SaveOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../api'
import { DragHandle, OrderNoInput, dndStyles, reorder, useRowDnd } from '../utils/rowDnd'
import { freightAllocate } from '../utils/freight'
import type { FreightMode } from '../utils/freight'
import { FreightPicker } from './inquiry/DealTerms'

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

type StrategyType = 'none' | 'flat_pct' | 'per_item_pct' | 'per_item_fixed'

interface LineState {
  inquiry_item_id: number
  picked: number | null            // supplier_quote_item_id
  show_brand: boolean
  qty: number
  cost_price: number
  // 单行交期：默认继承所选供应商那行的货期，销售可以逐行改
  lead_time: string
  // per_item_* 时的单行 payload
  pct_or_fixed: number | null
}

const STRATEGY_OPTIONS: { label: string; value: StrategyType; hint: string }[] = [
  { label: '不加价', value: 'none', hint: '售价 = 成本价' },
  { label: '整单 +N%', value: 'flat_pct', hint: '每行成本价 × (1 + N%)' },
  { label: '逐行 +N%', value: 'per_item_pct', hint: '每行单独设百分比' },
  { label: '逐行加固定金额', value: 'per_item_fixed', hint: '每行单独加金额' },
]

export default function InquiryComparePage({
  inquiryId: propInquiryId,
  embedded = false,
  onGenerated,
}: {
  /** 嵌入商机步骤时由外部传入；独立路由下从 URL 取 */
  inquiryId?: number
  embedded?: boolean
  onGenerated?: () => void
} = {}) {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const inquiryId = propInquiryId ?? Number(id)

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [defaultPct, setDefaultPct] = useState<number>(15)
  const [currency, setCurrency] = useState<'IDR' | 'CNY'>('IDR')
  const sym = currency === 'CNY' ? '¥' : 'Rp'
  const [submitting, setSubmitting] = useState(false)

  const [strategy, setStrategy] = useState<StrategyType>('none')
  const [flatPct, setFlatPct] = useState<number>(15)
  const [lines, setLines] = useState<Record<number, LineState>>({})
  const [validDays, setValidDays] = useState<number>(7)
  const [productionCycle, setProductionCycle] = useState<string>('15-20 个工作日')
  // 运费在这里定（20261112）：到付 / 加进单价（按金额权重分摊）/ 我方承担
  const [freight, setFreight] = useState<{ mode: FreightMode; amount: number }>({ mode: 'collect', amount: 0 })

  /**
   * 行顺序拖拽（20260824）：这张表的每一行就是 inquiry_items，
   * 所以直接落库到 line_no（reorderInquiryItems 只改序号不重建行，
   * 供应商报价按 inquiry_item_id 关联，不会被打散）。
   * 顺序会一路带到生成出来的对客报价单和打印件上。
   */
  const [reordering, setReordering] = useState(false)
  const [existingQuoteNo, setExistingQuoteNo] = useState('')
  // 指定供应商（20261116）：给勾选的行指定一家供应商并填成本价；一张清单可以分给多家
  const [assignFor, setAssignFor] = useState<number[] | null>(null)
  const afterAssign = async (res: any, priced: Record<number, { price: number; lead_time: string }>) => {
    // 重新拉供应商报价（只换 offers，不动已经调好的加价 / 数量 / 顺序），并自动选中刚指定的这家
    const cmp = await api.get('compareInquiry', { id: inquiryId })
    const fresh: Row[] = cmp.rows || []
    const offersById: Record<number, Offer[]> = {}
    for (const r of fresh) offersById[r.inquiry_item_id] = r.offers
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.inquiry_item_id))
      return [...prev.map((r) => ({ ...r, offers: offersById[r.inquiry_item_id] || r.offers })), ...fresh.filter((r) => !known.has(r.inquiry_item_id))]
    })
    setLines((prev) => {
      const next = { ...prev }
      for (const [k, v] of Object.entries(priced)) {
        const iid = Number(k)
        const row = fresh.find((r) => r.inquiry_item_id === iid)
        next[iid] = {
          ...(next[iid] || { inquiry_item_id: iid, show_brand: true, qty: row?.qty || 1, pct_or_fixed: null }),
          picked: res.line_ids?.[iid] ?? next[iid]?.picked ?? null,
          cost_price: v.price,
          lead_time: v.lead_time || next[iid]?.lead_time || '',
        } as LineState
      }
      return next
    })
    setAssignFor(null)
    message.success(
      `已给 ${res.count} 行指定供应商` + (res.linked_quote_rows ? `，供货来源和成本价已记到报价单 ${res.quote_no}（售价不变）` : ''),
      6,
    )
  }
  const moveRow = (from: number, to: number) => {
    setRows((prev) => {
      const next = reorder(prev, from, to)
      setReordering(true)
      api
        .post('reorderInquiryItems', {
          inquiry_id: inquiryId,
          item_ids: next.map((r) => r.inquiry_item_id),
        })
        .catch((e: any) => {
          message.error(e?.response?.data?.message || e?.message || '顺序保存失败')
          setRows(prev)
        })
        .finally(() => setReordering(false))
      return next
    })
  }
  const rowDnd = useRowDnd(moveRow)
  // 单一供应商模式（20261116）：基本都是一个商机只找一家报价，没有「多家比价逐行点选」这回事。
  // 所有报价都来自同一家、每行最多一条时，表格不显示单选圆点，直接列「供应商 + 价格」；
  // 一旦出现第二家或同一行有两条报价，自动回到可点选的样子
  const singleSupplier = useMemo(() => {
    const ids = new Set<number>()
    let multi = false
    for (const r of rows) {
      if (r.offers.length > 1) multi = true
      for (const o of r.offers) ids.add(o.supplier_id)
    }
    return !multi && ids.size === 1
  }, [rows])

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
        setDefaultPct(pct)
        setFlatPct(pct)
        setCurrency(cmp.currency === 'CNY' ? 'CNY' : 'IDR')
        setFreight({ mode: (cmp.freight_mode || 'collect') as FreightMode, amount: Number(cmp.freight_amount || 0) })
        const cmpRows: Row[] = cmp.rows || []
        setRows(cmpRows)
        // 初始化每行：默认选最低价
        const init: Record<number, LineState> = {}
        for (const r of cmpRows) {
          const cheapest = [...r.offers].sort((a, b) => a.supplier_price - b.supplier_price)[0]
          init[r.inquiry_item_id] = {
            inquiry_item_id: r.inquiry_item_id,
            picked: cheapest?.supplier_quote_item_id ?? null,
            show_brand: true,
            qty: r.qty,
            cost_price: cheapest?.supplier_price ?? 0,
            lead_time: cheapest?.lead_time ?? '',
            pct_or_fixed: null,
          }
        }
        // 已有对客报价单：按报价单当前内容显示（20261116）。原来每次都从供应商报价重新算，
        // 报价单里手改过的价、后加的货品在这里就成了 Rp 0，看着像没填单价，误点生成还会把报价单覆盖坏
        const q = cmp.quote
        if (q?.items?.length) {
          let anyMarkup = false
          for (const qi of q.items) {
            const row = cmpRows.find((r) => r.inquiry_item_id === qi.inquiry_item_id)
            if (!row) continue
            const stillThere = row.offers.some((o) => o.supplier_quote_item_id === qi.source_supplier_quote_item_id)
            // 报价单上没记供货来源（老数据被清过）：成本价和某家报价一样，就认它
            const samePrice = row.offers.find((o) => Math.abs(Number(o.supplier_price) - Number(qi.cost_price)) < 0.01)
            const add = Math.round((Number(qi.sell_price) - Number(qi.cost_price)) * 100) / 100
            if (Math.abs(add) > 0.001) anyMarkup = true
            init[qi.inquiry_item_id] = {
              inquiry_item_id: qi.inquiry_item_id,
              picked: stillThere ? qi.source_supplier_quote_item_id : (samePrice?.supplier_quote_item_id ?? null),
              show_brand: !!qi.show_brand,
              qty: Number(qi.qty),
              cost_price: Number(qi.cost_price),
              lead_time: qi.lead_time || '',
              pct_or_fixed: add,
            }
          }
          // 售价和成本不一样的行，用「逐行加固定金额」还原，保证这里显示的售价 = 报价单上的售价
          if (anyMarkup) setStrategy('per_item_fixed')
          if (q.production_cycle) setProductionCycle(q.production_cycle)
          setExistingQuoteNo(q.no)
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

  // 运费分摊预览：先加点得到原单价，再按金额权重分摊运费（运费不加点），和后端同一套算法
  const freightCalc = useMemo(() => {
    const ls = rows
      .filter((r) => lines[r.inquiry_item_id])
      .map((r) => ({ qty: Number(lines[r.inquiry_item_id].qty || 0), price: calc.detail[r.inquiry_item_id]?.sell || 0 }))
    const res = freightAllocate(ls, freight.mode === 'in_price' ? freight.amount : 0, currency)
    const ids = rows.filter((r) => lines[r.inquiry_item_id]).map((r) => r.inquiry_item_id)
    const byId: Record<number, (typeof res.lines)[number]> = {}
    ids.forEach((id, i) => (byId[id] = res.lines[i]))
    return { ...res, byId }
  }, [rows, lines, calc, freight, currency])

  /**
   * 当前选价涉及哪几家供应商（20260824）
   * 长清单经常一半 A 家一半 B 家，选的时候就要看得见分布，
   * 不然生成完报价才发现漏了某家 / 某几行没选供应商。
   */
  const supplierMix = useMemo(() => {
    const map = new Map<string, { name: string; lines: number; cost: number }>()
    let unassigned = 0
    for (const r of rows) {
      const ln = lines[r.inquiry_item_id]
      if (!ln) continue
      const offer = r.offers.find((o) => o.supplier_quote_item_id === ln.picked)
      if (!offer) {
        if (Number(ln.cost_price) > 0) unassigned++
        continue
      }
      const key = String(offer.supplier_id)
      const prev = map.get(key) || { name: offer.supplier_name, lines: 0, cost: 0 }
      prev.lines += 1
      prev.cost += Number(ln.cost_price || 0) * Number(ln.qty || 0)
      map.set(key, prev)
    }
    return {
      list: [...map.values()].sort((a, b) => b.cost - a.cost),
      unassigned,
    }
  }, [rows, lines])

  const updateLine = (iid: number, patch: Partial<LineState>) =>
    setLines((prev) => ({ ...prev, [iid]: { ...prev[iid], ...patch } }))

  // 当 picked 改变时同步 cost_price
  const onPickOffer = (row: Row, offerId: number | null) => {
    const offer = row.offers.find((o) => o.supplier_quote_item_id === offerId)
    updateLine(row.inquiry_item_id, {
      picked: offerId,
      cost_price: offer?.supplier_price ?? 0,
      // 换了供应商，交期跟着换——不同家的货期本来就不一样，留着上一家的会报错交期
      lead_time: offer?.lead_time ?? '',
    })
  }

  const submit = async () => {
    const payloadItems = rows
      .filter(
        (r) =>
          lines[r.inquiry_item_id]?.picked != null ||
          lines[r.inquiry_item_id]?.cost_price > 0 ||
          // 成本还没填、但已经有售价的行（报价单里手填了售价）不能丢
          (calc.detail[r.inquiry_item_id]?.sell || 0) > 0,
      )
      .map((r) => {
        const ln = lines[r.inquiry_item_id]
        return {
          inquiry_item_id: r.inquiry_item_id,
          source_supplier_quote_item_id: ln.picked,
          show_brand: ln.show_brand ? 1 : 0,
          qty: ln.qty,
          cost_price: ln.cost_price,
          lead_time: ln.lead_time || '',
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

    // 生成会删掉该商机下的旧报价，而 orders.quote_id 是 ON DELETE CASCADE，
    // 覆盖已成交的报价等于连收款和返佣一起删。先问后端能不能覆盖（20260808-05）。
    let preview: any
    try {
      preview = await api.get('previewQuoteOverwrite', { inquiry_id: inquiryId })
    } catch (e: any) {
      message.error(e?.message || '预检失败，请重试')
      return
    }
    if (preview?.blocked) {
      Modal.error({
        title: '不能覆盖现有报价',
        content: preview.reason,
        okText: '知道了',
        zIndex: 9999,
      })
      return
    }
    const willReplace: string[] = (preview?.quotes || []).map((q: any) => q.no).filter(Boolean)
    // needs_confirm：旧报价下有空订单或已开票——不丢钱，但订单/发票号会重开，要说清楚
    if (willReplace.length > 0 || preview?.needs_confirm) {
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: preview?.needs_confirm ? '覆盖会连订单 / 发票一起重开' : '确认覆盖现有报价？',
          content: (
            <div style={{ lineHeight: 1.8 }}>
              <div>将删除旧报价 {willReplace.join('、')}，并生成一份新的。</div>
              {preview?.needs_confirm && (
                <div style={{ color: '#fa8c16', marginTop: 6 }}>{preview.warning}</div>
              )}
              <div style={{ color: '#888', marginTop: 6 }}>删除后无法恢复。</div>
            </div>
          ),
          okText: '覆盖并生成',
          okButtonProps: { danger: true },
          cancelText: '取消',
          zIndex: 9999,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (!ok) return
    }

    // 没加价 = 按成本价卖给客户（20261125）：「加价策略」默认是不加价，忘了改就会零利润报出去，生成前必须问一句
    const zeroMargin = Object.keys(calc.detail).length > 0 && Object.values(calc.detail).every((d) => Math.abs(d.markup) < 0.005)
    if (zeroMargin) {
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '这张报价单没有加价，确认按成本价报给客户吗？',
          content: (
            <div style={{ lineHeight: 1.8 }}>
              <div>每一行的售价都等于成本价，这单的利润是 0。</div>
              <div style={{ color: '#888' }}>要加价：点「取消」，在上面的「加价策略」里选「整单 +N%」或逐行加价。靠工厂返佣赚钱的单可以照这样报。</div>
            </div>
          ),
          okText: '就按成本价报',
          okButtonProps: { danger: true },
          cancelText: '取消，去加价',
          zIndex: 9999,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (!ok) return
    }

    setSubmitting(true)
    try {
      // 计算有效期。
      // 🔴 必须用本地时间：原先这里是 .toISOString()，那是 **UTC**，
      // 而后端其余地方一律 datetime('now','localtime')。雅加达 UTC+7、北京 UTC+8，
      // 于是「7 天有效期」实际短 7~8 小时，过期判定在临界那天会误报过期。
      // 改动只影响新生成的报价（把被截短的时间还回来），存量数据不动。（20260810-12）
      const validUntil = dayjs().add(validDays, 'day').format('YYYY-MM-DD HH:mm:ss')
      const data = await api.post('buildCustomerQuote', {
        inquiry_id: inquiryId,
        markup,
        items: payloadItems,
        valid_until: validUntil,
        production_cycle: productionCycle,
        freight_mode: freight.mode,
        freight_amount: freight.mode === 'collect' ? 0 : freight.amount,
        // 上面弹窗已经让操作者确认过空订单/发票会重开，后端凭这个放行（没有它会 409）
        confirm_overwrite: 1,
      })
      const replaced = (data.replaced || []) as string[]
      message.success(
        `已生成 ${data.no}，总价 ${Number(data.total).toLocaleString()}` +
          (replaced.length ? `，已覆盖旧报价 ${replaced.join('、')}` : ''),
      )
      if (embedded) {
        onGenerated?.()
      } else {
        // 报价已并入商机的「对客报价」步骤，回商机而不是已下线的菜单页
        nav('/admin/inquiries', { state: { openInquiryId: inquiryId } })
      }
    } catch (e: any) {
      // 预检和真正生成之间存在时间差（别人同时开了单），后端硬拦仍会在这里拒绝。
      // 原来只有 finally，错误会被静默吞掉，点了没反应——02 号单踩过同一个坑。
      message.error(e?.message || '生成失败')
    } finally {
      setSubmitting(false)
    }
  }

  // 整单周期一键铺到每行，再逐行改个别不同的，比一行行敲快
  const applyCycleToAllLines = () => {
    const v = productionCycle.trim()
    if (!v) return
    setLines((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        next[Number(k)] = { ...next[Number(k)], lead_time: v }
      }
      return next
    })
    message.success(`已把「${v}」写入 ${rows.length} 行交期`)
  }

  const columns = [
    {
      title: '',
      width: 32,
      align: 'center' as const,
      render: () => <DragHandle />,
    },
    {
      title: '#',
      width: 56,
      align: 'center' as const,
      render: (_: any, __: Row, i: number) => (
        <OrderNoInput index={i} total={rows.length} onJump={moveRow} disabled={reordering} />
      ),
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
            {r.target_price ? `（目标 ${sym}${Number(r.target_price).toLocaleString()}）` : ''}
          </div>
        </div>
      ),
    },
    {
      title: singleSupplier ? '供应商报价' : '供应商报价（点选）',
      render: (_: any, r: Row) => {
        if (!r.offers.length)
          return (
            <Space direction="vertical" size={4}>
              <Tag color="warning">尚无供应商报价</Tag>
              <a onClick={() => setAssignFor([r.inquiry_item_id])}>指定供应商</a>
            </Space>
          )
        const ln = lines[r.inquiry_item_id]
        if (singleSupplier) {
          const o = r.offers[0]
          return (
            <Space direction="vertical" size={2}>
              <Space size={4} wrap>
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>{o.supplier_name}</Tag>
                <strong>{sym} {Number(o.supplier_price).toLocaleString()}</strong>
                {o.lead_time && <span style={{ color: '#999' }}>· 货期 {o.lead_time}</span>}
              </Space>
              {(o.brand || o.model) && <span style={{ color: '#999', fontSize: 12 }}>{[o.brand, o.model].filter(Boolean).join(' ')}</span>}
              <a style={{ fontSize: 12 }} onClick={() => setAssignFor([r.inquiry_item_id])}>换一家供应商</a>
            </Space>
          )
        }
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
                    <strong>{sym} {Number(o.supplier_price).toLocaleString()}</strong>
                    {o.lead_time && <span style={{ color: '#999' }}>· 货期 {o.lead_time}</span>}
                  </Space>
                </Radio>
              ))}
              <Radio value={null}>不采用，手填成本</Radio>
              <a style={{ fontSize: 12, marginLeft: 24 }} onClick={() => setAssignFor([r.inquiry_item_id])}>
                换 / 加一家供应商
              </a>
            </Space>
          </Radio.Group>
        )
      },
    },
    {
      title: (
        <Tooltip title="留空的行，报价单上显示整单生产周期">
          <span>交期 <InfoCircleOutlined style={{ color: '#bfbfbf' }} /></span>
        </Tooltip>
      ),
      width: 120,
      render: (_: any, r: Row) => (
        <Input
          size="small"
          placeholder="同整单"
          value={lines[r.inquiry_item_id]?.lead_time ?? ''}
          onChange={(e) => updateLine(r.inquiry_item_id, { lead_time: e.target.value })}
        />
      ),
    },
    {
      title: '成本价',
      width: 170,
      render: (_: any, r: Row) => (
        <InputNumber
          size="small"
          min={0}
          step={0.01}
          style={{ width: '100%' }}
          controls={false}
          formatter={(v) => (v == null || `${v}` === '' ? '' : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','))}
          parser={(v) => (v ? Number(String(v).replace(/,/g, '')) : ('' as any))}
          value={lines[r.inquiry_item_id]?.cost_price}
          onChange={(v) => updateLine(r.inquiry_item_id, { cost_price: Number(v ?? 0) })}
        />
      ),
    },
    {
      title: strategy === 'per_item_fixed' ? '加固定金额' : '本行 %',
      width: 110,
      render: (_: any, r: Row) => {
        if (strategy === 'none') return <span style={{ color: '#999' }}>不加价</span>
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
          {sym} {(calc.detail[r.inquiry_item_id]?.sell ?? 0).toLocaleString()}
        </strong>
      ),
    },
    {
      title: '行小计',
      width: 150,
      render: (_: any, r: Row) => {
        const d = calc.detail[r.inquiry_item_id]
        const qty = Number(lines[r.inquiry_item_id]?.qty || 0)
        const profit = Math.round((d?.markup ?? 0) * qty * 100) / 100
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            {sym} {(d?.lineTotal ?? 0).toLocaleString()}
            {freight.mode === 'in_price' && freight.amount > 0 && freightCalc.byId[r.inquiry_item_id] && (
              <div style={{ fontSize: 11, color: '#1d57e0', fontWeight: 400 }}>
                分到运费 {freightCalc.byId[r.inquiry_item_id].alloc.toLocaleString()} · 含运费单价{' '}
                {freightCalc.byId[r.inquiry_item_id].price_with_freight.toLocaleString()}
              </div>
            )}
            <Tooltip
              title={`本行利润 ${sym} ${profit.toLocaleString()}（单件加价 ${sym} ${(d?.markup ?? 0).toLocaleString()} × ${qty}）`}
            >
              <InfoCircleOutlined style={{ marginLeft: 6, color: '#8c8c8c', cursor: 'help' }} />
            </Tooltip>
          </span>
        )
      },
    },
    {
      title: '排序',
      width: 72,
      align: 'center' as const,
      render: (_: any, __: Row, i: number) => (
        <Space size={2}>
          <Button size="small" type="text" disabled={i === 0} onClick={() => moveRow(i, i - 1)}>↑</Button>
          <Button size="small" type="text" disabled={i === rows.length - 1} onClick={() => moveRow(i, i + 1)}>↓</Button>
        </Space>
      ),
    },
  ]

  const inner = (
    <>
      <ProCard bordered headerBordered>
        {/* 工具栏：每组 label+控件用 inline-flex 垂直居中；控件全部走 antd，字体统一 */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px 20px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>加价策略</Typography.Text>
            <Select
              style={{ width: 150 }}
              options={STRATEGY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
              value={strategy}
              onChange={(v: any) => setStrategy(v)}
            />
          </label>
          {strategy === 'flat_pct' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>百分比</Typography.Text>
              <InputNumber
                style={{ width: 110 }}
                value={flatPct}
                onChange={(v) => setFlatPct(Number(v ?? defaultPct))}
                addonAfter="%"
              />
            </label>
          )}
          <Tooltip title="货币 / 含税 / 税率沿用所选供应商报价的设置">
            <Tag color="blue" style={{ cursor: 'help', marginInlineEnd: 0 }}>
              货币 · 税点 沿用供应商
            </Tag>
          </Tooltip>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>报价有效期</Typography.Text>
            <InputNumber
              style={{ width: 100 }}
              value={validDays}
              onChange={(v) => setValidDays(Number(v ?? 7))}
              addonAfter="天"
              min={1}
              max={365}
            />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title="整单默认周期。下面表格里逐行的「交期」留空时，报价单上就显示这个">
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                生产周期 <InfoCircleOutlined style={{ color: '#bfbfbf' }} />
              </Typography.Text>
            </Tooltip>
            <Input
              style={{ width: 180 }}
              value={productionCycle}
              onChange={(e) => setProductionCycle(e.target.value)}
              placeholder="如 15-20 个工作日 / 现货"
            />
            <Tooltip title="把整单周期写进每一行的交期，再逐行改个别不一样的">
              <Button size="small" onClick={applyCycleToAllLines} disabled={!productionCycle.trim()}>
                套用到每行
              </Button>
            </Tooltip>
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexBasis: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13, paddingTop: 5, whiteSpace: 'nowrap' }}>运费方式</Typography.Text>
            <FreightPicker value={freight} onChange={setFreight} currency={currency} />
          </div>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>预计报价总额</Typography.Text>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#1d57e0', fontVariantNumeric: 'tabular-nums' }}>
              {sym} {freightCalc.total.toLocaleString()}
            </span>
            {freight.mode === 'in_price' && freight.amount > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                （货品 {sym} {freightCalc.goods_total.toLocaleString()} + 运费 {sym} {freightCalc.freight.toLocaleString()}，按金额占比分摊进单价）
              </Typography.Text>
            )}
          </span>
        </div>
      </ProCard>

      <ProCard bordered style={{ marginTop: 16 }}>
        {loading ? (
          <Empty description="加载中..." />
        ) : rows.length === 0 ? (
          <Empty description="该询价单没有明细" />
        ) : (
          <>
          <style>{dndStyles}</style>
          <div className="muted" style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
            按住 ⠿ 上下拖动可调整行顺序；挪很远时直接改左边的序号数字回车更快。顺序会带到生成的对客报价单上
            {reordering && <Tag color="processing" style={{ marginLeft: 8 }}>保存顺序中…</Tag>}
          </div>
          {existingQuoteNo && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 10 }}
              message={`已有报价单 ${existingQuoteNo}，下表按它当前的内容显示（成本价、售价、数量、选的供应商）`}
              description="只是改价格、加减货品，请用下方报价单上的「修改报价单」。点右下角「生成客户报价」会用这张表重新生成并覆盖现有报价单。"
            />
          )}
          <div style={{ marginBottom: 10 }}>
            <Button
              type="primary"
              ghost
              onClick={() => {
                // 默认勾上还没有供应商报价的行；都有就全不勾，让人自己选
                const none = rows.filter((r) => !r.offers.length).map((r) => r.inquiry_item_id)
                setAssignFor(none)
              }}
            >
              指定供应商（可全选 / 单选货品）
            </Button>
            <span style={{ marginLeft: 10, fontSize: 12, color: '#8c8c8c' }}>
              后加的货品没有供应商报价、或一张清单要分给几家时用：选供应商 → 勾货品 → 填成本价
            </span>
          </div>
          <AssignSupplierModal
            open={assignFor !== null}
            inquiryId={inquiryId}
            rows={rows}
            lines={lines}
            preselect={assignFor || []}
            sym={sym}
            onClose={() => setAssignFor(null)}
            onDone={afterAssign}
          />
          {(supplierMix.list.length > 0 || supplierMix.unassigned > 0) && (
            <div
              style={{
                background: supplierMix.list.length > 1 ? '#fffbe6' : '#f6f9ff',
                border: `1px solid ${supplierMix.list.length > 1 ? '#ffe58f' : '#d6e4ff'}`,
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 10,
                fontSize: 13,
              }}
            >
              <Space size={[6, 6]} wrap>
                <span style={{ color: '#595959' }}>
                  {supplierMix.list.length > 1
                    ? `本单将由 ${supplierMix.list.length} 家供应商分别供货：`
                    : '供货来源：'}
                </span>
                {supplierMix.list.map((g) => (
                  <Tag key={g.name} color="purple" style={{ marginInlineEnd: 0 }}>
                    {g.name}
                    <span style={{ opacity: 0.75, marginLeft: 4 }}>
                      {g.lines}行 · {sym} {Math.round(g.cost).toLocaleString()}
                    </span>
                  </Tag>
                ))}
                {supplierMix.unassigned > 0 && (
                  <Tooltip title="这些行是手填成本价、没选供应商报价的，生成的报价单上会显示「未指定供应商」">
                    <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                      ⚠ {supplierMix.unassigned} 行未指定供应商
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            </div>
          )}
          <Table
            rowKey="inquiry_item_id"
            dataSource={rows}
            columns={columns as any}
            pagination={false}
            size="small"
            onRow={(_, index) => rowDnd.rowProps(index as number)}
          />
          </>
        )}

        {!loading && rows.some((r) => r.offers.length === 0) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message={
              existingQuoteNo
                ? '部分行还没有指定供应商（售价已经在报价单里，不影响客户看到的价格）。点这些行的「指定供应商」补上成本价和供货来源，毛利才算得准。'
                : '部分行还没有供应商报价。可以等供应商提交后再来生成；或者点「指定供应商」直接填成本价。'
            }
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
    </>
  )

  if (embedded) return inner
  return (
    <PageContainer
      title="询价对比 / 生成客户报价"
      onBack={() => nav('/admin/inquiries')}
      backIcon={<ArrowLeftOutlined />}
      extra={[
        <Link key="back" to="/admin/inquiries">
          <Button icon={<ArrowLeftOutlined />}>返回询价</Button>
        </Link>,
      ]}
    >
      {inner}
    </PageContainer>
  )
}


/** 指定供应商：选一家供应商，勾选货品行（可全选 / 单选），填成本价 */
function AssignSupplierModal({
  open,
  inquiryId,
  rows,
  lines,
  preselect,
  sym,
  onClose,
  onDone,
}: {
  open: boolean
  inquiryId: number
  rows: Row[]
  lines: Record<number, LineState>
  preselect: number[]
  sym: string
  onClose: () => void
  onDone: (res: any, priced: Record<number, { price: number; lead_time: string }>) => void
}) {
  const [suppliers, setSuppliers] = useState<{ label: string; value: number }[]>([])
  const [supplierId, setSupplierId] = useState<number>()
  const [selected, setSelected] = useState<number[]>([])
  const [prices, setPrices] = useState<Record<number, number | null>>({})
  const [leads, setLeads] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(preselect)
    setSupplierId(undefined)
    // 成本价默认带出对比表里现在填的
    const init: Record<number, number | null> = {}
    for (const r of rows) init[r.inquiry_item_id] = Number(lines[r.inquiry_item_id]?.cost_price) || null
    setPrices(init)
    setLeads({})
    api
      .get('listSuppliers', { page: 1, page_size: 5000 })
      .then((r) => setSuppliers((r.items || []).map((x: any) => ({ label: `${x.name}${x.code ? ` [${x.code}]` : ''}`, value: x.id }))))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 选了供应商：这家已经报过价的行，带出它的价格和货期
  const pickSupplier = (sid: number) => {
    setSupplierId(sid)
    setPrices((p) => {
      const next = { ...p }
      for (const r of rows) {
        const o = r.offers.find((x) => x.supplier_id === sid)
        if (o) next[r.inquiry_item_id] = Number(o.supplier_price)
      }
      return next
    })
    setLeads((p) => {
      const next = { ...p }
      for (const r of rows) {
        const o = r.offers.find((x) => x.supplier_id === sid)
        if (o?.lead_time) next[r.inquiry_item_id] = o.lead_time
      }
      return next
    })
  }

  const submit = async () => {
    if (!supplierId) return message.warning('请选择供应商')
    if (!selected.length) return message.warning('请至少勾选一行货品')
    const noPrice = rows.find((r) => selected.includes(r.inquiry_item_id) && !(Number(prices[r.inquiry_item_id]) > 0))
    if (noPrice) return message.warning(`「${noPrice.product_name}」还没填成本价`)
    setSaving(true)
    try {
      const priced: Record<number, { price: number; lead_time: string }> = {}
      for (const id of selected) priced[id] = { price: Number(prices[id]), lead_time: leads[id] || '' }
      const res = await api.post('assignSupplierToItems', {
        inquiry_id: inquiryId,
        supplier_id: supplierId,
        items: selected.map((id) => ({ inquiry_item_id: id, supplier_price: Number(prices[id]), lead_time: leads[id] || '' })),
      })
      onDone(res, priced)
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const total = rows
    .filter((r) => selected.includes(r.inquiry_item_id))
    .reduce((s, r) => s + (Number(prices[r.inquiry_item_id]) || 0) * (Number(lines[r.inquiry_item_id]?.qty ?? r.qty) || 0), 0)

  return (
    <Modal
      title="指定供应商"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={`保存（${selected.length} 行）`}
      confirmLoading={saving}
      width={920}
      zIndex={9999}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Typography.Text strong style={{ marginRight: 8 }}>供应商</Typography.Text>
          <Select
            style={{ width: 360 }}
            showSearch
            optionFilterProp="label"
            placeholder="选择这些货品由哪家供货"
            options={suppliers}
            value={supplierId}
            onChange={pickSupplier}
          />
        </div>
        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
          勾选要给这家的货品（表头的方框可以全选），填上这家的成本价。没勾的行不受影响，可以再指定给别家。
        </div>
        <Table
          size="small"
          rowKey="inquiry_item_id"
          pagination={false}
          scroll={{ y: 380 }}
          dataSource={rows}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as number[]) }}
          columns={[
            { title: '#', width: 44, render: (_: any, __: any, i: number) => i + 1 },
            {
              title: '货品',
              render: (_: any, r: Row) => (
                <div>
                  <div>{r.product_name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    {[r.spec, `${Number(lines[r.inquiry_item_id]?.qty ?? r.qty).toLocaleString()} ${r.unit}`].filter(Boolean).join(' · ')}
                  </div>
                </div>
              ),
            },
            {
              title: '现有供应商报价',
              width: 220,
              render: (_: any, r: Row) =>
                r.offers.length ? (
                  <Space size={[4, 4]} wrap>
                    {r.offers.map((o) => (
                      <Tag key={o.supplier_quote_item_id} color={o.supplier_id === supplierId ? 'blue' : undefined} style={{ marginInlineEnd: 0 }}>
                        {o.supplier_name} {sym} {Number(o.supplier_price).toLocaleString()}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <Tag color="warning">尚无</Tag>
                ),
            },
            {
              title: `成本价（${sym}）`,
              width: 150,
              render: (_: any, r: Row) => (
                <InputNumber
                  size="small"
                  min={0}
                  style={{ width: '100%' }}
                  disabled={!selected.includes(r.inquiry_item_id)}
                  value={prices[r.inquiry_item_id] ?? undefined}
                  formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v) => Number(String(v || '').replace(/,/g, '')) as any}
                  onChange={(v) => setPrices((p) => ({ ...p, [r.inquiry_item_id]: v == null ? null : Number(v) }))}
                />
              ),
            },
            {
              title: '货期',
              width: 120,
              render: (_: any, r: Row) => (
                <Input
                  size="small"
                  placeholder="选填"
                  disabled={!selected.includes(r.inquiry_item_id)}
                  value={leads[r.inquiry_item_id] || ''}
                  onChange={(e) => setLeads((p) => ({ ...p, [r.inquiry_item_id]: e.target.value }))}
                />
              ),
            },
          ]}
        />
        <div style={{ textAlign: 'right' }}>
          已勾 {selected.length} 行，成本合计 <b>{sym} {Math.round(total).toLocaleString()}</b>
        </div>
      </Space>
    </Modal>
  )
}
