// 供应商门户共享类型与工具

export interface VendorProduct {
  id: number
  category: string
  name: string
  spec: string
  brand: string
  model: string
  unit: string
  moq: number | null
  base_price: number
  currency: string
  stock_status: 'in_stock' | 'pre_order'
  lead_time: string
  freight_note: string
  images: string[]
  description: string
  status: 'pending' | 'on' | 'off' | 'rejected'
  reject_reason: string
  price_updated_at: string
  updated_at: string
}

/** AI 识别价格表返回的单条商品 */
export interface ParsedItem {
  name: string
  spec: string
  brand: string
  model: string
  unit: string
  base_price: number
  category: string
  lead_time: string
  remark: string
}

export const STATUS_META: Record<VendorProduct['status'], { color: string; label: string }> = {
  pending: { color: 'orange', label: '待审核' },
  on: { color: 'green', label: '已上架' },
  off: { color: 'default', label: '已下架' },
  rejected: { color: 'red', label: '已驳回' },
}

/** IDR 取整千分位，CNY/USD 保留两位 */
export function formatPrice(price: number, currency: string): string {
  const n = Number(price) || 0
  if (currency === 'CNY') return `¥ ${n.toFixed(2)}`
  if (currency === 'USD') return `$ ${n.toFixed(2)}`
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`
}
