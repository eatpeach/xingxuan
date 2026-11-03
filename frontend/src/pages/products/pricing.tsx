import { useEffect, useState } from 'react'
import { InputNumber, Radio, Space } from 'antd'

/** 常用点位（加价 %，按成本价算） */
export const PT_PRESETS = [5, 8, 10, 12, 15, 20, 25, 30]

/** 四舍五入单位：0 = 保留两位小数 */
export const ROUND_OPTS = [
  { label: '不取整', value: 0 },
  { label: '个位', value: 1 },
  { label: '百位', value: 100 },
  { label: '千位', value: 1000 },
]

export function roundTo(v: number, unit: number) {
  if (!unit) return Math.round(v * 100) / 100
  return Math.round(v / unit) * unit
}

export function rangeFromCost(cost: number, ptMin: number, ptMax: number, unit: number) {
  const lo = Math.min(ptMin, ptMax)
  const hi = Math.max(ptMin, ptMax)
  return {
    min: roundTo(cost * (1 + lo / 100), unit),
    max: roundTo(cost * (1 + hi / 100), unit),
    ptMin: lo,
    ptMax: hi,
  }
}

export function fmtRp(n: number | null | undefined) {
  if (n == null || n === ('' as any)) return '-'
  const v = Number(n)
  if (!isFinite(v)) return '-'
  return 'Rp ' + (Number.isInteger(v) ? v.toLocaleString('id-ID') : v.toLocaleString('id-ID', { maximumFractionDigits: 2 }))
}

/**
 * 解析表格里的价格：支持 12500 / 12,500 / 12.500（印尼千分位）/ Rp 12.500,50
 * 解析不出来返回 null
 */
export function parseNum(raw: any): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return isFinite(raw) ? raw : null
  let s = String(raw).replace(/rp|idr|\s/gi, '').trim()
  if (!s) return null
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.') // 印尼写法：. 是千分位，, 是小数点
  } else {
    s = s.replace(/,/g, '')
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  const v = Number(s)
  return isFinite(v) ? v : null
}

/** 输入框里显示千分位 */
export const moneyInputProps = {
  formatter: (v: any) => (v === undefined || v === null || v === '' ? '' : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')),
  parser: (v: any) => (v ? v.replace(/,/g, '') : '') as any,
}

const ROUND_KEY = 'xx_price_round_unit'
export function loadRoundUnit(): number {
  try {
    const v = localStorage.getItem(ROUND_KEY)
    if (v != null && ROUND_OPTS.some((o) => String(o.value) === v)) return Number(v)
  } catch {
    /* 隐私模式读不到就用默认 */
  }
  return 100
}
export function saveRoundUnit(v: number) {
  try {
    localStorage.setItem(ROUND_KEY, String(v))
  } catch {
    /* ignore */
  }
}

export interface PointsValue {
  ptMin: number
  ptMax: number
  unit: number
}

/** 一行点位按钮 + 自定义输入 */
function PointRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const isPreset = PT_PRESETS.includes(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <span style={{ width: 64, color: '#666', flexShrink: 0, whiteSpace: 'nowrap' }}>{label}</span>
      <Radio.Group
        size="small"
        optionType="button"
        buttonStyle="solid"
        value={isPreset ? value : undefined}
        onChange={(e) => onChange(e.target.value)}
        options={PT_PRESETS.map((p) => ({ label: `${p}%`, value: p }))}
      />
      <InputNumber
        size="small"
        min={0}
        max={500}
        value={isPreset ? undefined : value}
        placeholder="自定义"
        addonAfter="%"
        style={{ width: 110 }}
        onChange={(v) => v != null && onChange(Number(v))}
      />
    </div>
  )
}

/** 点位选择器：下限点位 / 上限点位 / 四舍五入单位 */
export function PointsPicker({ value, onChange }: { value: PointsValue; onChange: (v: PointsValue) => void }) {
  return (
    <div>
      <PointRow label="下限点位" value={value.ptMin} onChange={(ptMin) => onChange({ ...value, ptMin })} />
      <PointRow label="上限点位" value={value.ptMax} onChange={(ptMax) => onChange({ ...value, ptMax })} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ width: 64, color: '#666', flexShrink: 0, whiteSpace: 'nowrap' }}>四舍五入</span>
        <Radio.Group
          size="small"
          optionType="button"
          value={value.unit}
          onChange={(e) => {
            saveRoundUnit(e.target.value)
            onChange({ ...value, unit: e.target.value })
          }}
          options={ROUND_OPTS}
        />
      </div>
    </div>
  )
}

export function usePoints(): [PointsValue, (v: PointsValue) => void] {
  const [v, setV] = useState<PointsValue>({ ptMin: 10, ptMax: 15, unit: 100 })
  useEffect(() => {
    setV((x) => ({ ...x, unit: loadRoundUnit() }))
  }, [])
  return [v, setV]
}

/** 出售价取区间的哪个值 */
export const SELL_FROM_OPTS = [
  { label: '不改出售价', value: '' },
  { label: '取下限', value: 'min' },
  { label: '取中间', value: 'mid' },
  { label: '取上限', value: 'max' },
]

export function sellFromRange(min: number, max: number, from: string, unit: number) {
  if (from === 'min') return min
  if (from === 'max') return max
  if (from === 'mid') return roundTo((min + max) / 2, unit)
  return null
}

export function MarginTag({ cost, sell }: { cost?: number | null; sell?: number | null }) {
  const c = Number(cost || 0)
  const s = Number(sell || 0)
  if (c <= 0 || s <= 0) return <span style={{ color: '#bbb' }}>-</span>
  const pct = ((s - c) / c) * 100
  return (
    <Space direction="vertical" size={0}>
      <span style={{ color: pct < 0 ? '#e64545' : '#389e0d', fontWeight: 600 }}>
        {pct > 0 ? '+' : ''}
        {pct.toFixed(1)}%
      </span>
      <span style={{ fontSize: 12, color: '#999' }}>{fmtRp(s - c)}</span>
    </Space>
  )
}
