import { test } from 'node:test'
import assert from 'node:assert/strict'
import { depositByPct, depositByDue, depositByNet, pctText } from '../src/utils/deposit.ts'

test('30% 定金：按含税总额的 30%，比例就是 30% 不是 33.3%', () => {
  const c = depositByPct(187100000, 30, 0.11, false, 'IDR')
  assert.equal(c.grossTotal, 207681000)
  assert.equal(c.net, 56130000)
  assert.equal(c.tax, 6174300)
  assert.equal(c.due, 62304300)           // = 207,681,000 × 30%
  assert.equal(c.remaining, 145376700)
  assert.equal(pctText(c.pct), '30%')
})

test('全款：和整单含税总额一分不差', () => {
  const c = depositByPct(9490000, 100, 0.11, false, 'IDR')
  assert.equal(c.due, 10533900)
  assert.equal(c.remaining, 0)
})

test('不加 PPN 的单：应付就是货款', () => {
  const c = depositByPct(8000000, 50, 0, false, 'IDR')
  assert.equal(c.due, 4000000)
  assert.equal(c.tax, 0)
})

test('按含税金额反推：填 62,304,300 得到 30%', () => {
  const c = depositByDue(187100000, 62304300, 0.11, false, 'IDR')
  assert.equal(c.net, 56130000)
  assert.equal(pctText(c.pct), '30%')
})

test('填的金额超过总额：按全款', () => {
  const c = depositByDue(1000000, 9999999, 0.11, false, 'IDR')
  assert.equal(c.net, 1000000)
  assert.equal(c.due, 1110000)
})

test('已存的开票金额还原出来和开票时一致', () => {
  const a = depositByPct(21381250, 35, 0.11, false, 'IDR')
  const b = depositByNet(21381250, a.net, 0.11, false, 'IDR')
  assert.equal(b.due, a.due)
  assert.equal(pctText(b.pct), '35%')
})

test('任意比例都行，没有 50% 下限', () => {
  for (const p of [1, 10, 15, 20, 30, 37.5, 49, 70]) {
    const c = depositByPct(100000000, p, 0.11, false, 'IDR')
    assert.equal(c.due, Math.round(111000000 * p / 100))
  }
})

test('人民币保留两位小数', () => {
  const c = depositByPct(33600, 30, 0, false, 'CNY')
  assert.equal(c.due, 10080)
})
