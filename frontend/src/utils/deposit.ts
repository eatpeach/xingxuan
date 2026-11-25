/**
 * 定金 / 分期收款的换算（20261125）
 *
 * 起因：系统里的「订单金额」是不含 PPN 的货款，客户实际要付的是含 PPN 的总额。
 * 原来开票时要自己填金额：想收 30% 定金，按含税总额算好填进去，系统却拿它除以不含税货款，
 * 显示成 33.3%，还会在上面再加一遍 PPN —— 差点收错钱。
 * 现在只需要选比例（任意百分比），所有金额由这里统一换算，页面、发票、收款三处用同一套。
 *
 * 约定：netTotal = 订单货款（不含 PPN）。taxIncluded=true 的老单货款里已含税，不再加。
 */
const r = (n: number, cur?: string) => (String(cur || '').toUpperCase() === 'CNY' ? Math.round(n * 100) / 100 : Math.round(n))

export interface DepositCalc {
  /** 整单：货款、税、客户总共要付 */
  netTotal: number
  taxTotal: number
  grossTotal: number
  /** 本次：比例（%）、对应货款（= 存库的开票金额）、税、客户这次要付 */
  pct: number
  net: number
  tax: number
  due: number
  /** 这次付完还剩多少（含税） */
  remaining: number
}

const addRate = (taxRate: number, taxIncluded: boolean) => (taxRate > 0 && !taxIncluded ? taxRate : 0)

function build(netTotal: number, net: number, taxRate: number, taxIncluded: boolean, cur?: string): DepositCalc {
  const rate = addRate(taxRate, taxIncluded)
  const taxTotal = r(netTotal * rate, cur)
  const grossTotal = r(netTotal + taxTotal, cur)
  const full = net >= netTotal - (cur === 'CNY' ? 0.005 : 0.5)
  const n = full ? netTotal : net
  const tax = full ? taxTotal : r(n * rate, cur)
  const due = r(n + tax, cur)
  return {
    netTotal, taxTotal, grossTotal,
    pct: netTotal > 0 ? (n / netTotal) * 100 : 0,
    net: n, tax, due,
    remaining: r(grossTotal - due, cur),
  }
}

/** 按比例：收 pct% */
export function depositByPct(netTotal: number, pct: number, taxRate = 0, taxIncluded = false, cur?: string): DepositCalc {
  const p = Math.min(100, Math.max(0, Number(pct) || 0))
  const c = build(netTotal, p >= 100 ? netTotal : r((netTotal * p) / 100, cur), taxRate, taxIncluded, cur)
  return { ...c, pct: p }
}

/** 按金额：客户这次付 due（含税）—— 谈好一个整数定金时用 */
export function depositByDue(netTotal: number, due: number, taxRate = 0, taxIncluded = false, cur?: string): DepositCalc {
  const rate = addRate(taxRate, taxIncluded)
  const net = r(Math.max(0, Number(due) || 0) / (1 + rate), cur)
  return build(netTotal, Math.min(net, netTotal), taxRate, taxIncluded, cur)
}

/** 按已存的开票金额（不含税货款）还原：发票打印页用 */
export function depositByNet(netTotal: number, net: number, taxRate = 0, taxIncluded = false, cur?: string): DepositCalc {
  return build(netTotal, Math.min(Math.max(0, Number(net) || 0), netTotal), taxRate, taxIncluded, cur)
}

/** 比例显示：30 → "30%"，33.333 → "33.3%" */
export const pctText = (p: number) => `${Math.abs(p - Math.round(p)) < 0.05 ? Math.round(p) : p.toFixed(1)}%`
