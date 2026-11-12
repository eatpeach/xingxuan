// 运费分摊单元测试：cd frontend && npm test
// 和 backend/tests/freight_alloc_test.php 用例一致
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freightAllocate } from '../src/utils/freight.ts'

const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.0001, `${msg}：期望 ${b}，实际 ${a}`)
const sumSub = (r: ReturnType<typeof freightAllocate>) => r.lines.reduce((s, l) => s + l.subtotal, 0)

test('需求里的例子：A、B 各分 500,000', () => {
  const r = freightAllocate([{ qty: 100, price: 50000 }, { qty: 10, price: 500000 }], 1000000)
  near(r.lines[0].alloc, 500000, 'A 分到运费')
  near(r.lines[1].alloc, 500000, 'B 分到运费')
  near(r.lines[0].price_with_freight, 55000, 'A 含运费单价')
  near(r.lines[1].price_with_freight, 550000, 'B 含运费单价')
  near(r.total, 11000000, '总价')
  near(sumSub(r), 11000000, '小计合计')
  assert.equal(r.tail_index, null)
})

test('只有一行', () => {
  const r = freightAllocate([{ qty: 3, price: 33333 }], 10000)
  near(r.lines[0].price_with_freight, 36666, '含运费单价')
  near(r.lines[0].subtotal, 109999, '小计（含尾差）')
  near(r.lines[0].tail, 1, '尾差')
  near(r.total, 109999, '总价')
})

test('数量是小数', () => {
  const r = freightAllocate([{ qty: 2.5, price: 12000 }, { qty: 7.25, price: 8000 }], 50000)
  near(r.lines[0].alloc, 17045.45, 'A 分到运费')
  near(r.lines[0].price_with_freight, 18818, 'A 含运费单价')
  near(r.lines[1].price_with_freight, 12545, 'B 含运费单价')
  near(r.total, 138000, '总价')
  near(sumSub(r), 138000, '小计合计')
  assert.equal(r.tail_index, 1)
})

test('存在尾差：金额并列给第一行', () => {
  const r = freightAllocate([{ qty: 1, price: 100 }, { qty: 1, price: 100 }, { qty: 1, price: 100 }], 100)
  near(r.lines[1].price_with_freight, 133, '含运费单价')
  assert.equal(r.tail_index, 0)
  near(r.lines[0].subtotal, 134, '第一行小计')
  near(sumSub(r), 400, '小计合计')
})

test('运费为 0', () => {
  const r = freightAllocate([{ qty: 3, price: 1234.5 }, { qty: 2, price: 10 }], 0)
  near(r.lines[0].price_with_freight, 1234.5, '含运费单价 = 原单价')
  near(r.lines[0].subtotal, 3703.5, '小计不取整')
  near(r.total, 3723.5, '总价')
  assert.equal(r.tail_index, null)
})

test('人民币取整到分', () => {
  const r = freightAllocate([{ qty: 3, price: 10 }], 1, 'CNY')
  near(r.lines[0].price_with_freight, 10.33, '含运费单价')
  near(r.lines[0].subtotal, 31, '小计')
})
