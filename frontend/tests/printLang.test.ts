// 印尼语 / 英文单据「必须全部是目标语言」的判断：cd frontend && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemSpec, untranslatedCount } from '../src/pages/printI18n.ts'

const ok = { product_name: '炮钉', spec: '100个/盒', name_id: 'Paku Tembak', spec_id: 'isi 100 pcs/box', trans_id_status: 'confirmed' }

test('全部翻好 → 0 行未完成', () => {
  assert.equal(untranslatedCount([ok], 'id'), 0)
})
test('规格还是中文 → 拦', () => {
  assert.equal(untranslatedCount([{ ...ok, spec_id: '100个/盒' }], 'id'), 1)
})
test('原来有规格、译文规格空 → 拦', () => {
  assert.equal(untranslatedCount([{ ...ok, spec_id: '' }], 'id'), 1)
})
test('AI 草稿没确认 → 拦', () => {
  assert.equal(untranslatedCount([{ ...ok, trans_id_status: 'ai' }], 'id'), 1)
})
test('显示品牌但品牌还是中文 → 拦', () => {
  assert.equal(untranslatedCount([{ ...ok, show_brand: 1, brand_display: '海螺', brand_id: '海螺' }], 'id'), 1)
})
test('显示品牌、品牌译成 Conch → 通过', () => {
  assert.equal(untranslatedCount([{ ...ok, show_brand: 1, brand_display: '海螺', brand_id: 'Conch' }], 'id'), 0)
})
test('型号里有中文 → 拦', () => {
  assert.equal(untranslatedCount([{ ...ok, show_brand: 1, model_display: 'YJJH连接条', model_id: 'YJJH连接条' }], 'id'), 1)
})
test('中文单据不检查', () => {
  assert.equal(untranslatedCount([{ product_name: '炮钉', spec: '100个/盒' }], 'cn'), 0)
})
test('印尼语单据规格用译文', () => {
  assert.equal(itemSpec(ok, 'id'), 'isi 100 pcs/box')
})
