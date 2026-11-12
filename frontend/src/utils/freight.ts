/**
 * 运费分摊（与后端 backend/includes/freight.php 是同一套算法，改一边必须改另一边）
 *
 * 每行分摊运费 = 总运费 × (该行金额 ÷ 所有货品总金额)
 * 含运费单价   = 原单价 + 该行分摊运费 ÷ 该行数量，取整（IDR 到 1，CNY 到 0.01）
 * 每行小计     = 含运费单价 × 数量（取整）；尾差加到行金额最大的那一行，保证总价 = 货品总额 + 运费
 * 后端是权威结果，这里只为编辑页实时预览。
 */

export type FreightMode = 'collect' | 'in_price' | 'absorb'

export const FREIGHT_MODE_OPTIONS: { value: FreightMode; label: string }[] = [
  { value: 'collect', label: '到付' },
  { value: 'in_price', label: '加进单价' },
  { value: 'absorb', label: '我方承担' },
]

export const FREIGHT_MODE_HINT: Record<FreightMode, string> = {
  collect: '客户收货时自付，不计入订单金额，报价单 / 发票上注明「运费：到付」',
  in_price: '总运费按金额占比分摊进各行单价，客户看到的是含运费单价',
  absorb: '不加到客户单价，运费记入这单的成本（影响毛利），单据上写「运费：免运费」',
}

/** 报价单 / 发票上那一行运费说明；加进单价时运费已在单价里，不单列 */
export function freightNote(mode?: string): string {
  if (mode === 'in_price') return '单价已含运费'
  if (mode === 'absorb') return '运费：免运费'
  return '运费：到付'
}

export interface FreightLineIn {
  qty: number
  price: number
}

export interface FreightLineOut {
  goods: number
  share: number
  alloc: number
  price_with_freight: number
  subtotal: number
  tail: number
}

export interface FreightResult {
  lines: FreightLineOut[]
  goods_total: number
  freight: number
  total: number
  tail_index: number | null
  unallocated: boolean
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function roundUnit(currency?: string) {
  return String(currency || '').toUpperCase() === 'CNY' ? 0.01 : 1
}

function roundTo(v: number, unit: number) {
  return r2(Math.round(v / unit) * unit)
}

export function freightAllocate(lines: FreightLineIn[], freight: number, currency = 'IDR'): FreightResult {
  const unit = roundUnit(currency)
  const goods = lines.map((l) => (Number(l.qty) || 0) * (Number(l.price) || 0))
  const G = r2(goods.reduce((s, g) => s + g, 0))
  const F = Math.max(0, r2(Number(freight) || 0))

  if (F <= 0 || G <= 0) {
    return {
      lines: lines.map((l, i) => ({
        goods: goods[i],
        share: G > 0 ? goods[i] / G : 0,
        alloc: 0,
        price_with_freight: Number(l.price) || 0,
        subtotal: goods[i],
        tail: 0,
      })),
      goods_total: G,
      freight: G > 0 ? 0 : F,
      total: G,
      tail_index: null,
      unallocated: G <= 0 && F > 0,
    }
  }

  let sum = 0
  let maxIdx: number | null = null
  const out = lines.map((l, i) => {
    const qty = Number(l.qty) || 0
    const price = Number(l.price) || 0
    const share = goods[i] / G
    const alloc = F * share
    const pwf = qty > 0 ? roundTo(price + alloc / qty, unit) : price
    const sub = roundTo(pwf * qty, unit)
    sum += sub
    if (maxIdx === null || goods[i] > goods[maxIdx]) maxIdx = i
    return { goods: goods[i], share, alloc: r2(alloc), price_with_freight: pwf, subtotal: sub, tail: 0 }
  })
  const target = r2(G + F)
  const diff = r2(target - sum)
  if (maxIdx !== null && Math.abs(diff) > 0.0001) {
    out[maxIdx].subtotal = r2(out[maxIdx].subtotal + diff)
    out[maxIdx].tail = diff
  }
  return {
    lines: out,
    goods_total: G,
    freight: F,
    total: target,
    tail_index: Math.abs(diff) > 0.0001 ? maxIdx : null,
    unallocated: false,
  }
}
