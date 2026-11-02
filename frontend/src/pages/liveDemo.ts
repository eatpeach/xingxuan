import dayjs from 'dayjs'

/**
 * 订单直播大屏的演示数据（/admin/live?demo=1，拍短视频用）
 *
 * 全部在浏览器里现算，不碰接口、不碰数据库——系统里不会多出任何一条假订单。
 * 客户名 / 品名都是编的通用名字，金额按对数正态随机；每隔几秒"进一单"。
 * 同一天多次打开，近 14 天柱状图保持一致（按日期做种子），免得重拍时穿帮。
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
const pick = <T,>(arr: T[]): T => arr[rint(0, arr.length - 1)]

/** 单笔金额：对数正态，中位数约 Rp 2,200 万，封顶 Rp 6 亿，取整到 10 万 */
function orderAmount(): number {
  const u = Math.random() || 1e-9
  const v = Math.random()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  const amt = Math.exp(Math.log(22e6) + 0.9 * z)
  return Math.round(Math.min(6e8, Math.max(2e6, amt)) / 1e5) * 1e5
}

/** 某一天的"历史"单量：30~52 单，周日打六折，同一天永远算出同一个数 */
function dayCount(date: dayjs.Dayjs): number {
  const r = seeded(Number(date.format('YYYYMMDD')))()
  const base = 30 + r * 22
  return Math.round(date.day() === 0 ? base * 0.6 : base)
}

let nextId = 9_000_000

function makeOrder(at: dayjs.Dayjs): LiveOrder {
  const items = Math.random() < 0.55 ? 1 : rint(2, 9)
  return {
    id: nextId++,
    no: `SO${at.format('YYYYMMDD')}${String(nextId % 1000).padStart(3, '0')}`,
    created_at: at.format('YYYY-MM-DD HH:mm:ss'),
    amount: orderAmount(),
    currency: 'IDR',
    customer: pick(CUSTOMERS),
    item_count: items,
    product: pick(PRODUCTS),
  }
}

export function makeDemoData(): LiveData {
  const now = dayjs()
  // 今日：随时间推进，上午 30 出头、傍晚 60 出头，再叠一点随机
  const todayCnt = Math.round(8 + now.hour() * 2.6 + now.minute() / 60 * 2.6 + rnd(0, 6))

  // 最新 40 单：往前铺，间隔 3~25 分钟
  const latest: LiveOrder[] = []
  let t = now.subtract(rint(1, 6), 'minute')
  for (let i = 0; i < 40; i++) {
    latest.push(makeOrder(t))
    t = t.subtract(rint(3, 25), 'minute')
  }

  const days: LiveData['days'] = []
  for (let i = 13; i >= 1; i--) {
    const d = now.subtract(i, 'day')
    const cnt = dayCount(d)
    days.push({ date: d.format('YYYY-MM-DD'), cnt, amount: cnt * 28e6 })
  }
  const todayAmount = Math.round(todayCnt * rnd(24e6, 32e6))
  days.push({ date: now.format('YYYY-MM-DD'), cnt: todayCnt, amount: todayAmount })

  // 本月 = 1 号到昨天的"历史"单量 + 今日
  let monthCnt = todayCnt
  for (let d = now.startOf('month'); d.isBefore(now, 'day'); d = d.add(1, 'day')) monthCnt += dayCount(d)

  const since = now.diff(dayjs('2026-01-01'), 'day')
  const totalCnt = 5400 + Math.floor(since * 9.3) + todayCnt
  return {
    server_time: now.format('YYYY-MM-DD HH:mm:ss'),
    today: { cnt: todayCnt, amount: todayAmount },
    month: { cnt: monthCnt, amount: monthCnt * 28e6 },
    total: { cnt: totalCnt, amount: Math.round(totalCnt * 34.5e6), customers: 620 + Math.floor(since * 0.9) },
    days,
    latest,
  }
}

/** 进一单：今日 / 本月 / 累计同步 +1，金额累加，四分之一概率是新客户 */
export function pushDemoOrder(prev: LiveData): LiveData {
  const o = makeOrder(dayjs())
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

/** 下一单间隔：5~12 秒 */
export const nextDemoDelay = () => rnd(5000, 12000)
