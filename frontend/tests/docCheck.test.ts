// 单据出门前金额自检的测试：cd frontend && npm test
// 用 INV20261110001 事故的真实数据：明细合计 9,490,000，开票金额却沿用了旧的 4,300,000
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkInvoiceDoc, checkQuoteDoc } from '../src/utils/docCheck.ts'

const items = [
  { qty: 1, sell_price: 4700000, price_with_freight: 4700000, line_total: 4700000 },
  { qty: 2, sell_price: 330000, price_with_freight: 330000, line_total: 660000 },
  { qty: 6, sell_price: 180000, price_with_freight: 180000, line_total: 1080000 },
  { qty: 50, sell_price: 61000, price_with_freight: 61000, line_total: 3050000 },
]
const base = { currency: 'IDR', total: 9490000, freight_mode: 'collect', freight_amount: 0, status: 'draft', items, invoice_no: 'INV1' }

test('事故发票：开票金额沿用旧的 4,300,000 且没确认部分开票 → 拦截', () => {
  const p = checkInvoiceDoc({ ...base, invoice_amount: 4300000, invoice_partial: 0 })
  assert.ok(p.some((x) => x.includes('没有确认过是部分开票')), p.join(' | '))
})

test('正确的全额发票 → 通过', () => {
  assert.deepEqual(checkInvoiceDoc({ ...base, invoice_amount: 9490000, invoice_partial: 0 }), [])
})

test('确认过的定金发票（50%）→ 通过', () => {
  assert.deepEqual(checkInvoiceDoc({ ...base, invoice_amount: 4745000, invoice_partial: 1 }), [])
})

test('开票金额超过总额 → 拦截', () => {
  assert.ok(checkInvoiceDoc({ ...base, invoice_amount: 9990000 }).length > 0)
})

test('已作废的发票 → 拦截', () => {
  assert.ok(checkInvoiceDoc({ ...base, invoice_no: '', invoice_void_at: '2026-11-10' }).length > 0)
})

test('报价总额和明细对不上 → 拦截', () => {
  assert.ok(checkQuoteDoc({ ...base, total: 4300000 }).length > 0)
})

test('加进单价：含运费小计合计 = 总额 → 通过', () => {
  const q = {
    currency: 'IDR', total: 11000000, freight_mode: 'in_price', freight_amount: 1000000, status: 'sent',
    items: [
      { qty: 100, sell_price: 50000, price_with_freight: 55000, line_total: 5500000 },
      { qty: 10, sell_price: 500000, price_with_freight: 550000, line_total: 5500000 },
    ],
  }
  assert.deepEqual(checkQuoteDoc(q), [])
})

test('加进单价：某行小计被改坏 → 拦截', () => {
  const q = {
    currency: 'IDR', total: 11000000, freight_mode: 'in_price', freight_amount: 1000000, status: 'sent',
    items: [
      { qty: 100, sell_price: 50000, price_with_freight: 55000, line_total: 5000000 },
      { qty: 10, sell_price: 500000, price_with_freight: 550000, line_total: 5500000 },
    ],
  }
  assert.ok(checkQuoteDoc(q).length > 0)
})
