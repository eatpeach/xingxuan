import dayjs from 'dayjs'

/**
 * 订单直播大屏的演示数据（/admin/live?demo=1，拍短视频用）
 *
 * 全部在浏览器里现算，不碰库——系统里不会多出任何一条假订单。
 * 量级锚在真实数据上：先拉一次真实 liveBoard，累计单数 / 客户数 / 成交额按倍数放大（默认 5 倍，可选 3 / 5 / 8，最少 3 倍），
 * 日均单量按最新 40 单的时间跨度估出来再放大，今日 / 本月 / 近 14 天都从这个日均推，
 * 单笔金额按真实平均客单价附近随机。客户名 / 品名是编的通用名字；每隔十几秒"进一单"。
 * 近 14 天柱状图按日期做种子，同一天多次打开保持一致，免得重拍时穿帮。
 */

export interface LiveOrder { id: number; no: string; created_at: string; amount: number; currency: string; customer: string; item_count: number; product: string }
export interface LiveData {
  server_time: string
  today: { cnt: number; amount: number }
  month: { cnt: number; amount: number }
  total: { cnt: number; amount: number; customers: number }
  days: { date: string; cnt: number; amount: number }[]
  latest: LiveOrder[]
}

/** 演示的"底子"：从真实 liveBoard 抽出来的几个量，放大前的基数 */
export interface DemoBase { totalCnt: number; customers: number; totalAmount: number; daily: number; avgOrder: number; currency: string }

/** 拉不到真实数据时的兜底基数（泛泛的整数，不是任何一天的真实值） */
export const DEFAULT_BASE: DemoBase = { totalCnt: 120, customers: 25, totalAmount: 4e9, daily: 1, avgOrder: 33e6, currency: 'IDR' }

/** 从真实数据抽基数。日均用最新 40 单的时间跨度估（比按自然月稳：月初按月算是 0） */
export function baseFromReal(r: LiveData): DemoBase {
  const cnt = Math.max(1, r.total.cnt)
  const amt = r.total.amount > 0 ? r.total.amount : cnt * DEFAULT_BASE.avgOrder
  const times = (r.latest || []).map((o) => dayjs(o.created_at)).filter((d) => d.isValid())
  let daily = 0
  if (times.length >= 2) {
    const oldest = times.reduce((a, b) => (b.isBefore(a) ? b : a))
    daily = times.length / Math.max(1, dayjs().diff(oldest, 'day', true))
  }
  const d14 = (r.days || []).reduce((s, d) => s + d.cnt, 0) / 14
  return {
    totalCnt: cnt,
    customers: Math.max(1, r.total.customers),
    totalAmount: amt,
    daily: Math.max(daily, d14, 0.3),
    avgOrder: amt / cnt,
    currency: r.latest?.[0]?.currency || 'IDR',
  }
}

/** 放大倍数：⚙ 面板可选，URL ?scale=3|5|8（也接受任意数，老板定的下限 3 倍，再低按 3 算） */
export const SCALE_LEVELS = [
  { key: '3', label: '3 倍', v: 3 },
  { key: '5', label: '5 倍', v: 5 },
  { key: '8', label: '8 倍', v: 8 },
] as const
export const MIN_SCALE = 3
export const DEFAULT_SCALE_KEY = '5'
export function scaleOf(key: string | null | undefined): number {
  const n = parseFloat(key || '')
  if (!Number.isFinite(n) || n <= 0) return 5
  return Math.max(MIN_SCALE, n)
}

const CUSTOMERS = [
  '张总', '王总', '李经理', '陈工', '刘总', '赵经理', '黄总', '周工', '吴总', '郑经理', '孙总', '林总', '何经理', '徐工', '马总',
  'PT Maju Bersama Konstruksi', 'CV Sinar Abadi Jaya', 'PT Bangun Nusantara Persada', 'Toko Bangunan Sumber Rejeki',
  'PT Karya Mandiri Sejahtera', 'CV Mitra Baja Utama', 'PT Cahaya Beton Indonesia', 'Pak Hendra · 承包商',
  'Bu Dewi · 商铺项目', 'PT Graha Lestari Abadi', 'CV Tiga Putra Steel', 'PT Surya Logam Jaya', 'PT Mega Alumunium Indo',
  'Pak Budi · 工地采购', 'PT Anugerah Mitra Bangun', 'CV Berkah Jaya Teknik', 'PT Duta Konstruksi Mandiri',
  'Toko Listrik Cahaya Terang', 'PT Prima Energi Nusantara', 'CV Sumber Makmur Elektrik', 'PT Inti Bangun Sentosa',
  'Bu Rina · 住宅装修', 'PT Wahana Teknik Persada', 'CV Jaya Abadi Kontraktor', 'PT Lintas Baja Nusantara',
  'Pak Agus · 厂房项目', 'PT Mitra Sarana Konstruksi', 'CV Harapan Jaya Bangunan', 'PT Bumi Persada Engineering', 'Toko Besi Sinar Jaya',
]

// 按货架 13 大类凑的通用品名，不带品牌
const PRODUCTS = [
  '电线 NYM 3×2.5mm²', '电缆 NYY 4×16mm²', '断路器 MCB 2P 32A', '配电箱 12 回路', 'LED 面板灯 36W', 'LED 投光灯 200W', '开关插座套装', '电缆桥架 200×100',
  '螺纹钢 10mm SNI', '螺纹钢 16mm SNI', '镀锌方管 40×40', 'H 型钢 200×100', '角钢 50×50×5', '镀锌钢板 1.2mm', '铝合金型材 6063', '不锈钢管 304 Ø50',
  '水泥 PCC 50kg', '瓷砖胶 25kg', '防水涂料 20kg', '石膏板 9mm', '轻钢龙骨 C75', '外墙乳胶漆 20L', '膨胀螺栓 M10', '自攻螺丝 4.2×25',
  '安全帽 ABS', '反光背心', '防砸安全鞋', '工作手套 (12 双)', '安全带 双钩', '护目镜 防雾',
  'PVC 排水管 4 寸', 'PPR 水管 25mm', '水泵 1HP', '不锈钢水槽', '球阀 DN50', '焊条 2.6mm (5kg)', '角磨机 100mm', '电锤 26mm', '切割片 355mm', '扎丝 1.2mm',
]

/** 可复现的伪随机（mulberry32），按日期做种子 */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const rint = (a: number, b: number) => Math.floor(rnd(a, b + 1))
const pick = <T,>(arr: readonly T[]): T => arr[rint(0, arr.length - 1)]

/** 单笔金额：对数正态，中位数取真实客单价的七成（均值就落在客单价附近），取整到 10 万 */
function orderAmount(avgOrder: number): number {
  const u = Math.random() || 1e-9
  const v = Math.random()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  const amt = Math.exp(Math.log(avgOrder * 0.7) + 0.8 * z)
  return Math.round(Math.min(avgOrder * 12, Math.max(avgOrder * 0.08, amt)) / 1e5) * 1e5
}

/** 某一天的"历史"单量：日均上下浮动 ±35%，周日打六折，同一天永远算出同一个数 */
function dayCount(date: dayjs.Dayjs, daily: number): number {
  const r = seeded(Number(date.format('YYYYMMDD')))()
  const base = daily * (0.65 + r * 0.7)
  return Math.max(1, Math.round(date.day() === 0 ? base * 0.6 : base))
}

/** 一天过去了几成（按 7 点到 19 点的营业时段算） */
function dayFraction(now: dayjs.Dayjs): number {
  return Math.min(1, Math.max(0, (now.hour() + now.minute() / 60 - 6.5) / 12))
}

let nextId = 9_000_000

/** 重点品类（?cat=）：给了品名列表时，七成订单从里面出 */
export type Focus = string[] | null | undefined

/** 货架里搜不到这个品类时的兜底品名：拿输入的词本身变几个花样 */
export function focusFallbackNames(cat: string): string[] {
  const c = cat.trim()
  return [c, `${c} 国标`, `${c} 加厚款`, `${c} 定制规格`, `${c} 工程批次`, `${c} 标准件`, `${c} 整批采购`, `${c} 现货`]
}

function pickProduct(focus: Focus): string {
  if (focus && focus.length && Math.random() < 0.7) return pick(focus)
  return pick(PRODUCTS)
}

function makeOrder(at: dayjs.Dayjs, focus: Focus, base: DemoBase): LiveOrder {
  const items = Math.random() < 0.55 ? 1 : rint(2, 9)
  return {
    id: nextId++,
    no: `SO${at.format('YYYYMMDD')}${String(nextId % 1000).padStart(3, '0')}`,
    created_at: at.format('YYYY-MM-DD HH:mm:ss'),
    amount: orderAmount(base.avgOrder),
    currency: base.currency,
    customer: pick(CUSTOMERS),
    item_count: items,
    product: pickProduct(focus),
  }
}

export function makeDemoData(focus: Focus, scale: number, base: DemoBase): LiveData {
  const now = dayjs()
  const daily = base.daily * scale

  // 今日：按一天过去的比例推，再叠一点随机；早上 7 点前就是 0，这是真实的
  const todayCnt = Math.round(daily * dayFraction(now) + rnd(0, Math.max(1, daily * 0.25)))
  const todayAmount = Math.round(todayCnt * base.avgOrder * rnd(0.8, 1.2))

  // 最新 40 单：按日均倒推间隔往前铺，只落在 7~21 点的营业时段里（半夜三点下单的 B2B 客户不多见），
  // 量不大时自然会铺到前几天去（时间列会显示日期）
  const latest: LiveOrder[] = []
  const gapMin = (14 * 60) / Math.max(daily, 0.5)
  let t = now.subtract(rnd(0, gapMin * 0.5), 'minute')
  for (let i = 0; i < 40; i++) {
    if (t.hour() < 7) t = t.subtract(1, 'day').hour(20).minute(rint(0, 59)).second(rint(0, 59))
    latest.push(makeOrder(t, focus, base))
    t = t.subtract(gapMin * rnd(0.4, 1.6), 'minute')
  }

  const days: LiveData['days'] = []
  for (let i = 13; i >= 1; i--) {
    const d = now.subtract(i, 'day')
    const cnt = dayCount(d, daily)
    days.push({ date: d.format('YYYY-MM-DD'), cnt, amount: cnt * base.avgOrder })
  }
  days.push({ date: now.format('YYYY-MM-DD'), cnt: todayCnt, amount: todayAmount })

  // 「本月」按最近 30 天算，不按自然月：月初一两号按自然月只有一两天的量，跟今日一比就露馅
  let monthCnt = todayCnt
  for (let i = 1; i <= 29; i++) monthCnt += dayCount(now.subtract(i, 'day'), daily)

  return {
    server_time: now.format('YYYY-MM-DD HH:mm:ss'),
    today: { cnt: todayCnt, amount: todayAmount },
    month: { cnt: monthCnt, amount: Math.round(monthCnt * base.avgOrder) },
    total: {
      cnt: Math.round(base.totalCnt * scale),
      amount: Math.round(base.totalAmount * scale),
      customers: Math.round(base.customers * scale),
    },
    days,
    latest,
  }
}

/** 进一单：今日 / 本月 / 累计同步 +1，金额累加，四分之一概率是新客户 */
export function pushDemoOrder(prev: LiveData, focus: Focus, base: DemoBase): LiveData {
  const o = makeOrder(dayjs(), focus, base)
  const days = prev.days.map((d, i) => (i === prev.days.length - 1 ? { ...d, cnt: d.cnt + 1, amount: d.amount + o.amount } : d))
  return {
    ...prev,
    server_time: o.created_at,
    today: { cnt: prev.today.cnt + 1, amount: prev.today.amount + o.amount },
    month: { cnt: prev.month.cnt + 1, amount: prev.month.amount + o.amount },
    total: { cnt: prev.total.cnt + 1, amount: prev.total.amount + o.amount, customers: prev.total.customers + (Math.random() < 0.25 ? 1 : 0) },
    days,
    latest: [o, ...prev.latest].slice(0, 40),
  }
}

/**
 * 下一单间隔：平时 10~25 秒；今日已经冲到日均 1.4 倍以上就放慢到 40~90 秒，
 * 免得镜头开久了今日数字蹿过近 14 天所有柱子，又成了"失真"
 */
export function nextDemoDelay(d: LiveData, scale: number, base: DemoBase): number {
  const daily = base.daily * scale
  return d.today.cnt >= daily * 1.4 ? rnd(40000, 90000) : rnd(10000, 25000)
}
