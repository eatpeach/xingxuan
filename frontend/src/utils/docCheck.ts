import { freightAllocate } from './freight.ts'

/**
 * 单据出门前的金额自检（20261113，INV20261110001 少开事故之后加的）
 *
 * 报价单 / 发票在导出 PDF、打印之前，前端再按明细独立算一遍，和单据上要印的金额逐项比对。
 * 只要有一项对不上，就不让导出、不让打印，并把原因写在页面顶上。
 * 后端开票时还有一道同样的校验（includes/money_audit.php），这里是最后一道：防止错的数字发到客户手里。
 */

const tolOf = (currency?: string) => (String(currency || '').toUpperCase() === 'CNY' ? 0.02 : 1)
const fmt = (n: number, cur?: string) =>
  (cur === 'CNY' ? '¥' : 'Rp ') + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: cur === 'CNY' ? 2 : 0 })

/** 单行在单据上印的单价 / 金额（和打印页一致） */
export function docLine(data: any, it: any) {
  const inPrice = (data?.freight_mode || 'collect') === 'in_price'
  const unit = Number(inPrice && it.price_with_freight != null ? it.price_with_freight : it.sell_price)
  const amount = inPrice && it.line_total != null ? Number(it.line_total) : Number(it.sell_price) * Number(it.qty)
  return { unit, amount }
}

export function checkQuoteDoc(data: any): string[] {
  const problems: string[] = []
  if (!data) return problems
  const cur = data.currency
  const tol = tolOf(cur)
  const items: any[] = data.items || []
  const total = Number(data.total || 0)
  // 历史补录的单金额是从老订单直接录的，不按明细重算
  if (data.status === 'confirmed') return problems

  const printed = items.reduce((s, it) => s + docLine(data, it).amount, 0)
  if (Math.abs(printed - total) > tol) {
    problems.push(`明细金额合计 ${fmt(printed, cur)} 和总额 ${fmt(total, cur)} 对不上`)
  }
  const mode = data.freight_mode || 'collect'
  const re = freightAllocate(
    items.map((it) => ({ qty: Number(it.qty) || 0, price: Number(it.sell_price) || 0 })),
    mode === 'in_price' ? Number(data.freight_amount || 0) : 0,
    cur,
  )
  if (Math.abs(re.total - total) > tol) {
    problems.push(`按明细重新计算总额应为 ${fmt(re.total, cur)}，单据上是 ${fmt(total, cur)}`)
  }
  items.forEach((it, i) => {
    const { unit, amount } = docLine(data, it)
    if (mode !== 'in_price' && Math.abs(unit * Number(it.qty) - amount) > tol) {
      problems.push(`第 ${i + 1} 行 单价 × 数量 ≠ 金额`)
    }
  })
  if (data.status === 'to_review') problems.push('报价单有追加物料还在待审批')
  return problems
}

export function checkInvoiceDoc(data: any): string[] {
  const problems = checkQuoteDoc(data).filter((p) => !p.includes('待审批'))
  if (!data) return problems
  const cur = data.currency
  const tol = tolOf(cur)
  const total = Number(data.total || 0)
  if (!data.invoice_no) {
    problems.push(data.invoice_void_at ? '这张发票已作废，请重新开具' : '还没有开发票')
    return problems
  }
  const amt = data.invoice_amount == null || data.invoice_amount === '' ? total : Number(data.invoice_amount)
  if (amt > total + tol) problems.push(`开票金额 ${fmt(amt, cur)} 超过报价总额 ${fmt(total, cur)}`)
  if (amt < total - tol && !Number(data.invoice_partial)) {
    problems.push(`开票金额 ${fmt(amt, cur)} 小于报价总额 ${fmt(total, cur)}，但没有确认过是部分开票，请重新开具`)
  }
  return problems
}
