import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { api } from '../api'
import logoWhite from '../assets/logo-white.png'
import { focusFallbackNames, makeDemoData, nextDemoDelay, pushDemoOrder, type LiveData } from './liveDemo'

/**
 * 订单直播大屏（/admin/live）—— 手机竖屏拍短视频用
 *
 * 全屏深色、大数字滚动、最新订单自动滚屏、近 14 天柱状图；每 15 秒拉一次 liveBoard，新进订单闪一下。
 * 登录态页面（走后台 token），不套 AdminLayout。客户名默认打码，右上角 ⚙ 可切换；
 * ?names=1 直接显示全名、?amount=0 隐藏金额，方便拍摄前用链接定好状态。
 *
 * ?demo=1 演示模式（见 liveDemo.ts）：数据全在浏览器里编，每隔几秒进一单，不碰接口和库。
 * 只认 URL 参数，不存 localStorage——从工作台正常进来永远是真实数据。
 * ?cat=铝型材 重点品类：七成订单出这个品类。品名先拿货架真实商品（按品类名 → 按关键词搜），搜不到就用输入的词本身。
 */

const POLL_MS = 15000

/** 数字滚动：从上一个值平滑滚到新值 */
function useCountUp(target: number, ms = 1400): number {
  const [val, setVal] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) return
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      setVal(from + (target - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return val
}

/** 金额紧凑显示：≥1 亿用亿，≥1 万用万，小数按量级取 */
function fmtAmt(n: number, cur = 'IDR'): { num: string; unit: string } {
  const sym = cur === 'CNY' ? '¥' : cur === 'USD' ? '$' : 'Rp'
  const abs = Math.abs(n)
  if (abs >= 1e12) return { num: `${sym} ${(n / 1e12).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`, unit: '万亿' }
  if (abs >= 1e8) {
    const v = n / 1e8
    return { num: `${sym} ${v.toLocaleString('zh-CN', { maximumFractionDigits: abs >= 1e10 ? 0 : abs >= 1e9 ? 1 : 2 })}`, unit: '亿' }
  }
  if (abs >= 1e4) return { num: `${sym} ${Math.round(n / 1e4).toLocaleString('zh-CN')}`, unit: '万' }
  return { num: `${sym} ${Math.round(n).toLocaleString('zh-CN')}`, unit: '' }
}

/** 打码：中文名留首字（张**）；PT / CV 这类公司名留前缀 + 首字母（PT M***） */
function maskName(name: string): string {
  const s = (name || '').trim()
  if (!s) return '匿名客户'
  const parts = s.split(/\s+/)
  if (parts.length > 1 && /^[A-Za-z.]{1,4}$/.test(parts[0])) return `${parts[0]} ${Array.from(parts[1])[0]}***`
  return Array.from(s)[0] + '**'
}

function fmtTime(iso: string): string {
  const d = dayjs(iso)
  if (!d.isValid()) return ''
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm')
}

function Clock() {
  const [now, setNow] = useState(dayjs())
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="lb-clock">
      <span className="lb-date">{now.format('YYYY.MM.DD ddd')}</span>
      <span className="lb-time">{now.format('HH:mm:ss')}</span>
    </div>
  )
}

function BigNumber({ value, digits = 0 }: { value: number; digits?: number }) {
  const v = useCountUp(value)
  return <span className="lb-num">{digits ? v.toFixed(digits) : Math.round(v).toLocaleString('zh-CN')}</span>
}

function AmountNumber({ value, currency, hidden }: { value: number; currency: string; hidden: boolean }) {
  const v = useCountUp(value)
  if (hidden) return <span className="lb-num">••••</span>
  const { num, unit } = fmtAmt(v, currency)
  return (
    <span className="lb-num">
      {num}
      {unit && <small className="lb-unit">{unit}</small>}
    </span>
  )
}

export default function LiveBoardPage() {
  const qs = new URLSearchParams(window.location.search)
  const [demo, setDemo] = useState<boolean>(() => qs.get('demo') === '1')
  const [cat, setCat] = useState<string>(() => (qs.get('cat') || '').trim())
  const [catInput, setCatInput] = useState<string>(cat)
  // 解析好的重点品类品名；cat 不匹配说明还在解析（或已换词）
  const [focus, setFocus] = useState<{ cat: string; names: string[] } | null>(null)
  const [data, setData] = useState<LiveData | null>(null)
  const [fetchedAt, setFetchedAt] = useState<dayjs.Dayjs | null>(null)
  const [err, setErr] = useState('')
  // 演示模式的客户名都是编的，没什么可打码的，默认直接显示（?names=0 可关）
  const [showNames, setShowNames] = useState<boolean>(() =>
    qs.get('names') === '1' || (qs.get('demo') === '1' && qs.get('names') !== '0') || localStorage.getItem('live_names') === '1')
  const [showAmount, setShowAmount] = useState<boolean>(() => qs.get('amount') !== '0')
  const [panel, setPanel] = useState(false)
  const [company, setCompany] = useState('星选建材')
  const seenRef = useRef<Set<number> | null>(null)
  const [fresh, setFresh] = useState<Set<number>>(new Set())
  const listRef = useRef<HTMLUListElement>(null)
  const prevFirstRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    document.title = '订单直播 · 星选建材'
    api.get('listSettings').then((r) => {
      const sm: Record<string, string> = Object.fromEntries((r.items || []).map((s: any) => [s.key, s.value]))
      if (sm.company_name) setCompany(sm.company_name)
    }).catch(() => {})
  }, [])

  // 真实数据：每 15 秒轮询 liveBoard
  useEffect(() => {
    if (demo) return
    let stop = false
    const load = async () => {
      try {
        const r = await api.get<LiveData>('liveBoard')
        if (stop) return
        setData(r)
        setFetchedAt(dayjs())
        setErr('')
        const ids = new Set(r.latest.map((o) => o.id))
        if (seenRef.current) {
          const added = new Set<number>()
          ids.forEach((id) => { if (!seenRef.current!.has(id)) added.add(id) })
          if (added.size) {
            setFresh(added)
            setTimeout(() => setFresh(new Set()), 20000)
          }
        }
        seenRef.current = ids
      } catch (e: any) {
        if (!stop) setErr(e?.message || '加载失败')
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(t) }
  }, [demo])

  // 重点品类 → 品名列表：货架按品类名查，不够再按关键词搜，还不够就拿输入的词兜底
  useEffect(() => {
    if (!demo || !cat) return
    let stop = false
    const fetchNames = async (params: Record<string, string>) => {
      try {
        const r = await api.get<{ items: { name: string; spec?: string }[] }>('shelfListProducts', { ...params, page_size: '60' })
        return (r.items || [])
          .map((p) => (p.spec && p.spec.length <= 14 ? `${p.name} ${p.spec}` : p.name))
          .filter((s) => !!s)
      } catch {
        return []
      }
    }
    ;(async () => {
      let names = await fetchNames({ category: cat })
      if (names.length < 3) names = await fetchNames({ keyword: cat })
      if (names.length < 3) names = focusFallbackNames(cat)
      if (!stop) setFocus({ cat, names })
    })()
    return () => { stop = true }
  }, [demo, cat])

  // null = 不聚焦；undefined = 品类还在解析，先别生成
  const activeNames = cat ? (focus && focus.cat === cat ? focus.names : undefined) : null

  // 演示数据：本地生成，每 2.5~6.5 秒进一单。拍摄中途换品类只重铺订单流，各计数不重新摇（不然数字会跳）
  const demoRef = useRef<LiveData | null>(null)
  useEffect(() => {
    if (!demo || activeNames === undefined) return
    let d = makeDemoData(activeNames)
    if (demoRef.current) d = { ...demoRef.current, latest: d.latest }
    demoRef.current = d
    setData(d)
    setFetchedAt(dayjs())
    setErr('')
    let timer = 0
    const tick = () => {
      timer = window.setTimeout(() => {
        d = pushDemoOrder(d, activeNames)
        demoRef.current = d
        const id = d.latest[0].id
        setData(d)
        setFetchedAt(dayjs())
        setFresh((prev) => new Set(prev).add(id))
        setTimeout(() => setFresh((prev) => { const n = new Set(prev); n.delete(id); return n }), 20000)
        tick()
      }, nextDemoDelay())
    }
    tick()
    return () => clearTimeout(timer)
  }, [demo, activeNames])

  const applyCat = (v: string) => {
    const c = v.trim()
    setCatInput(c)
    if (c === cat) return
    const u = new URL(window.location.href)
    if (c) u.searchParams.set('cat', c)
    else u.searchParams.delete('cat')
    window.history.replaceState(null, '', u.toString())
    setCat(c)
  }

  // 全名开关只在真实模式下记住；演示模式里的选择不能带回真实数据
  useEffect(() => { if (!demo) localStorage.setItem('live_names', showNames ? '1' : '0') }, [showNames, demo])

  const setDemoMode = (on: boolean) => {
    const u = new URL(window.location.href)
    if (on) u.searchParams.set('demo', '1')
    else u.searchParams.delete('demo')
    window.history.replaceState(null, '', u.toString())
    setData(null)
    setFresh(new Set())
    seenRef.current = null
    demoRef.current = null
    setShowNames(on ? true : localStorage.getItem('live_names') === '1')
    setDemo(on)
  }

  const latest = data?.latest || []
  // 滚屏：真实数据条数够多时复制一份做无缝循环，时长按条数走；演示模式改成新单从顶上滑进来
  const marquee = !demo && latest.length >= 8
  const feedList = marquee ? [...latest, ...latest] : latest
  const feedDuration = Math.max(20, latest.length * 2.6)
  const maxDay = useMemo(() => Math.max(1, ...(data?.days || []).map((d) => d.cnt)), [data])
  const cur = latest[0]?.currency || 'IDR'

  // 新单滑入：第一条换了就先把列表上提一行高度，下一帧放回去
  const firstId = latest[0]?.id
  useLayoutEffect(() => {
    const el = listRef.current
    const prev = prevFirstRef.current
    prevFirstRef.current = firstId
    if (!el || marquee || prev === undefined || firstId === undefined || prev === firstId) return
    const row = el.firstElementChild as HTMLElement | null
    const h = row ? row.getBoundingClientRect().height : 52
    el.style.transition = 'none'
    el.style.transform = `translateY(-${h}px)`
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)'
      el.style.transform = 'translateY(0)'
    }))
  }, [firstId, marquee])

  const toggleFullscreen = () => {
    const el = document.documentElement as any
    if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)
    else (document.exitFullscreen as any)?.call(document)
  }

  return (
    <div className="lb-root" onDoubleClick={toggleFullscreen}>
      <style>{CSS}</style>
      <div className="lb-glow lb-glow-a" />
      <div className="lb-glow lb-glow-b" />

      <header className="lb-head">
        <div className="lb-brand">
          <img className="lb-logo" src={logoWhite} alt="" />
          <span className="lb-brand-name">{company}</span>
          <span className="lb-live"><i />LIVE</span>
        </div>
        <Clock />
        <button className="lb-gear" onClick={() => setPanel((v) => !v)} aria-label="设置">⚙</button>
      </header>

      {panel && (
        <div className="lb-panel">
          <label><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> 显示客户全名</label>
          <label><input type="checkbox" checked={showAmount} onChange={(e) => setShowAmount(e.target.checked)} /> 显示金额</label>
          <label><input type="checkbox" checked={demo} onChange={(e) => setDemoMode(e.target.checked)} /> 演示数据（拍摄用，不是真实订单）</label>
          {demo && (
            <label className="lb-panel-cat">
              <span>重点品类 <small>七成订单出这个品类，回车生效</small></span>
              <input
                type="text"
                value={catInput}
                placeholder="如：铝型材 / 电线电缆 / 安全帽"
                onChange={(e) => setCatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCat(catInput) }}
                onBlur={() => applyCat(catInput)}
              />
            </label>
          )}
          <button onClick={toggleFullscreen}>全屏 / 退出全屏</button>
          <a href="/admin/dashboard">返回工作台</a>
        </div>
      )}

      {err && <div className="lb-err">{err}</div>}

      <main className="lb-main">
        <section className="lb-hero">
          <div className="lb-hero-item lb-hero-today">
            <div className="lb-label">今日订单</div>
            <div className="lb-value"><BigNumber value={data?.today.cnt || 0} /><small className="lb-unit">单</small></div>
            <div className="lb-sub">
              今日成交 <AmountNumber value={data?.today.amount || 0} currency={cur} hidden={!showAmount} />
            </div>
          </div>
          <div className="lb-kpis">
            <div className="lb-kpi">
              <div className="lb-label">本月订单</div>
              <div className="lb-value sm"><BigNumber value={data?.month.cnt || 0} /><small className="lb-unit">单</small></div>
            </div>
            <div className="lb-kpi">
              <div className="lb-label">累计订单</div>
              <div className="lb-value sm"><BigNumber value={data?.total.cnt || 0} /><small className="lb-unit">单</small></div>
            </div>
            <div className="lb-kpi">
              <div className="lb-label">成交客户</div>
              <div className="lb-value sm"><BigNumber value={data?.total.customers || 0} /><small className="lb-unit">家</small></div>
            </div>
            <div className="lb-kpi">
              <div className="lb-label">累计成交额</div>
              <div className="lb-value sm"><AmountNumber value={data?.total.amount || 0} currency={cur} hidden={!showAmount} /></div>
            </div>
          </div>
        </section>

        <section className="lb-chart">
          <div className="lb-section-title">近 14 天订单</div>
          <div className="lb-bars">
            {(data?.days || []).map((d) => {
              const h = Math.max(4, Math.round((d.cnt / maxDay) * 100))
              const isToday = dayjs(d.date).isSame(dayjs(), 'day')
              return (
                <div className={'lb-bar' + (isToday ? ' today' : '')} key={d.date} title={`${d.date} ${d.cnt} 单`}>
                  <span className="lb-bar-cnt">{d.cnt || ''}</span>
                  <i style={{ height: `${h}%` }} />
                  <span className="lb-bar-day">{dayjs(d.date).format('D')}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="lb-feed">
          <div className="lb-section-title">最新订单 <span className="lb-pulse" /></div>
          <div className="lb-feed-clip">
            <ul ref={listRef} className={'lb-feed-list' + (marquee ? ' marquee' : '')} style={marquee ? { animationDuration: `${feedDuration}s` } : undefined}>
              {feedList.map((o, idx) => {
                const a = fmtAmt(o.amount, o.currency)
                return (
                  <li key={`${o.id}-${idx}`} className={'lb-row' + (fresh.has(o.id) ? ' fresh' : '')}>
                    <span className="lb-row-time">{fmtTime(o.created_at)}</span>
                    <span className="lb-row-main">
                      <b>{showNames ? (o.customer || '匿名客户') : maskName(o.customer)}</b>
                      <em>{o.product || '定制采购'}{o.item_count > 1 ? ` 等 ${o.item_count} 项` : ''}</em>
                    </span>
                    <span className="lb-row-amt">{showAmount ? `${a.num}${a.unit}` : '成交'}</span>
                  </li>
                )
              })}
              {!latest.length && <li className="lb-row empty">{data ? '暂无订单' : '加载中…'}</li>}
            </ul>
          </div>
        </section>
      </main>

      {/* 用本机拉取时刻而不是 server_time：服务器在印尼时区，和手机时钟可能差一小时，拍进视频会穿帮 */}
      <footer className="lb-foot">
        {demo ? `${company} · 订单实时看板` : `数据实时同步自 ${company} 业务系统`} · {fetchedAt ? fetchedAt.format('HH:mm:ss') + ' 更新' : '连接中'}
      </footer>
    </div>
  )
}

const CSS = `
.lb-root{position:fixed;inset:0;overflow:hidden;background:radial-gradient(120% 80% at 20% 0%,#0f2a5a 0%,#07132b 45%,#040a18 100%);color:#eaf2ff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);-webkit-user-select:none;user-select:none}
.lb-glow{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;pointer-events:none;animation:lbFloat 14s ease-in-out infinite alternate}
.lb-glow-a{width:60vw;height:60vw;left:-20vw;top:-10vh;background:#1d57e0}
.lb-glow-b{width:50vw;height:50vw;right:-15vw;bottom:10vh;background:#d98f2b;animation-delay:-7s}
@keyframes lbFloat{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(6vw,4vh,0) scale(1.15)}}
.lb-head{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:14px 16px 6px}
.lb-brand{display:flex;align-items:center;gap:8px;min-width:0}
.lb-logo{width:36px;height:36px;object-fit:contain;flex:none;filter:drop-shadow(0 0 8px rgba(255,255,255,.35))}
.lb-brand-name{font-size:18px;font-weight:800;letter-spacing:1.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(180deg,#fff,#bcd2ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.lb-brand .lb-live{margin-left:2px}
.lb-live{display:inline-flex;align-items:center;gap:6px;background:#e5484d;color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;letter-spacing:1px}
.lb-live i{width:7px;height:7px;border-radius:50%;background:#fff;animation:lbBlink 1.2s infinite}
@keyframes lbBlink{0%,100%{opacity:1}50%{opacity:.15}}
.lb-clock{display:flex;flex-direction:column;align-items:flex-end;line-height:1.1}
.lb-date{font-size:11px;opacity:.65}
.lb-time{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:1px}
.lb-gear{background:transparent;border:0;color:#9fb6e0;font-size:18px;padding:4px 0 4px 10px;opacity:.5}
.lb-panel{position:absolute;z-index:5;right:12px;top:52px;background:rgba(7,19,43,.96);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.lb-panel button{background:#1d57e0;color:#fff;border:0;border-radius:8px;padding:8px 12px;font-size:14px}
.lb-panel-cat{display:flex;flex-direction:column;gap:6px}
.lb-panel-cat small{opacity:.6;font-size:11px;margin-left:4px}
.lb-panel-cat input{width:220px;max-width:70vw;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;padding:7px 10px;font-size:14px;outline:none}
.lb-panel-cat input:focus{border-color:#6ea0ff}
.lb-panel a{color:#9fb6e0;text-align:center}
.lb-err{margin:6px 16px;padding:8px 12px;border-radius:8px;background:rgba(229,72,77,.2);border:1px solid rgba(229,72,77,.5);font-size:13px}
.lb-main{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;gap:12px;padding:6px 14px 0;min-height:0}
.lb-hero{display:flex;flex-direction:column;gap:10px}
.lb-hero-item{background:linear-gradient(135deg,rgba(29,87,224,.35),rgba(29,87,224,.08));border:1px solid rgba(120,160,255,.35);border-radius:18px;padding:14px 18px;box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 10px 40px rgba(0,0,0,.35)}
.lb-label{font-size:13px;opacity:.7;letter-spacing:1px}
.lb-value{display:flex;align-items:baseline;gap:4px;margin-top:2px}
.lb-num{font-size:56px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;letter-spacing:-1px;background:linear-gradient(180deg,#fff,#bcd2ff);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 24px rgba(120,160,255,.25)}
.lb-value.sm .lb-num{font-size:26px;letter-spacing:0}
.lb-unit{font-size:14px;font-weight:600;opacity:.75;margin-left:4px;color:#dbe6ff;-webkit-text-fill-color:#dbe6ff}
.lb-value.sm .lb-unit{font-size:12px}
.lb-sub{margin-top:6px;font-size:14px;opacity:.85;display:flex;align-items:baseline;gap:6px}
.lb-sub .lb-num{font-size:20px;letter-spacing:0}
.lb-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.lb-kpi{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:10px 12px 8px;min-width:0}
.lb-kpi .lb-label{font-size:11px;white-space:nowrap}
.lb-kpi .lb-num{white-space:nowrap}
.lb-kpi .lb-value.sm .lb-num{font-size:24px}
.lb-section-title{font-size:13px;font-weight:600;opacity:.8;letter-spacing:1px;display:flex;align-items:center;gap:8px;margin-bottom:6px}
.lb-pulse{width:8px;height:8px;border-radius:50%;background:#3ddc84;box-shadow:0 0 0 0 rgba(61,220,132,.7);animation:lbPulse 1.6s infinite}
@keyframes lbPulse{0%{box-shadow:0 0 0 0 rgba(61,220,132,.7)}70%{box-shadow:0 0 0 10px rgba(61,220,132,0)}100%{box-shadow:0 0 0 0 rgba(61,220,132,0)}}
.lb-chart{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:10px 12px 6px}
.lb-bars{display:flex;align-items:flex-end;gap:4px;height:74px}
.lb-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.lb-bar i{display:block;width:100%;max-width:18px;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,#6ea0ff,#1d57e0);box-shadow:0 0 12px rgba(110,160,255,.35);transition:height .8s cubic-bezier(.2,.8,.2,1)}
.lb-bar.today i{background:linear-gradient(180deg,#ffd27a,#d98f2b);box-shadow:0 0 14px rgba(255,210,122,.5)}
.lb-bar-cnt{font-size:10px;opacity:.75;height:12px;line-height:12px;font-variant-numeric:tabular-nums}
.lb-bar-day{font-size:10px;opacity:.5;margin-top:3px}
.lb-bar.today .lb-bar-day{opacity:1;color:#ffd27a;font-weight:700}
.lb-feed{flex:1;display:flex;flex-direction:column;min-height:160px}
.lb-feed-clip{flex:1;overflow:hidden;position:relative;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 24px),transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 14px,#000 calc(100% - 24px),transparent 100%)}
.lb-feed-list{list-style:none;margin:0;padding:8px 10px}
.lb-feed-list.marquee{animation:lbScroll linear infinite}
@keyframes lbScroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}
.lb-row{display:flex;align-items:center;gap:10px;padding:9px 6px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
.lb-row.empty{justify-content:center;opacity:.6}
.lb-row-time{font-variant-numeric:tabular-nums;opacity:.6;font-size:12px;width:44px;flex:none}
.lb-row-main{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}
.lb-row-main b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-row-main em{font-style:normal;font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lb-row-amt{flex:none;font-weight:700;font-variant-numeric:tabular-nums;color:#ffd27a;font-size:14px}
.lb-row.fresh{background:linear-gradient(90deg,rgba(61,220,132,.25),transparent);border-radius:8px;animation:lbFresh 1s ease-in-out 3}
@keyframes lbFresh{0%,100%{background-color:transparent}50%{background-color:rgba(61,220,132,.35)}}
.lb-foot{position:relative;z-index:1;text-align:center;font-size:11px;opacity:.45;padding:8px 0 10px}
@media (min-width:768px){
  .lb-main{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);grid-template-rows:auto 1fr;gap:14px;padding:8px 20px 0}
  .lb-kpis{grid-template-columns:repeat(4,1fr)}
  .lb-hero{grid-column:1;grid-row:1}
  .lb-chart{grid-column:1;grid-row:2;align-self:start}
  .lb-feed{grid-column:2;grid-row:1/3}
  .lb-num{font-size:72px}
  .lb-value.sm .lb-num{font-size:30px}
  .lb-logo{width:46px;height:46px}
  .lb-brand-name{font-size:22px}
  .lb-bars{height:120px}
  .lb-row{font-size:16px;padding:12px 8px}
}
@media (max-height:640px){.lb-num{font-size:44px}.lb-bars{height:56px}.lb-chart{padding:8px 10px 4px}}
`
