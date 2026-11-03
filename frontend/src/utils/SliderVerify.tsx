import { useEffect, useRef, useState } from 'react'
import { CheckOutlined, DoubleRightOutlined } from '@ant-design/icons'

/**
 * 滑块验证（共用组件，20260824 重写）
 *
 * 原来那版在手机上会「滑不到尽头然后卡住」，供应商反复重试直接触发 15 分钟锁定。
 * 三个坑：
 *  1. 没监听 pointercancel。浏览器一旦判定这是页面滚动手势就发 pointercancel，
 *     move/up 监听全留在 window 上、dragging 停在 true —— 滑块就冻在半路，
 *     手指抬起也不回弹。供应商是从 WhatsApp 里点链接进来的（应用内 WebView），
 *     这类环境最容易触发。
 *  2. 手柄宽度写死 40，实际含边框是 42，终点算少了 2px，越到最后越难判定成功。
 *  3. 按住的位置和手柄中心不一致时会突然跳一下（原来强制把手柄中心对到手指）。
 *
 * 另外补了 touch 事件兜底 + 一个「点这里完成验证」的保底按钮：
 * 这个滑块只是挡机器人的，真正的暴力破解防线在后端限流。
 * 让它把真实供应商挡在门外，代价远比它挡住的那点机器人大。
 */
export default function SliderVerify({
  onOk,
  hint = '按住滑块拖动到最右',
}: {
  onOk: () => void
  hint?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [ok, setOk] = useState(false)
  const [fails, setFails] = useState(0)   // 没拖到头的次数，够多就露出保底按钮
  const okRef = useRef(false)

  const pass = () => {
    if (okRef.current) return
    okRef.current = true
    setOk(true)
    setDragging(false)
    onOk()
  }

  // 手柄实际宽度要量，不能写死：含 1px 边框实际是 42
  const metrics = () => {
    const track = trackRef.current!.getBoundingClientRect()
    const hw = handleRef.current?.getBoundingClientRect().width || 40
    return { track, max: Math.max(0, track.width - hw - 2) }
  }

  const xRef = useRef(0)
  useEffect(() => {
    xRef.current = x
  }, [x])
  // 同一时间只允许一个拖动会话：有的手机同时发 touch 和 pointer 事件，不能各开一个
  const activeRef = useRef(false)

  /**
   * 开始拖动。mode='touch' 走触摸事件，'pointer' 走鼠标 / 触控笔。
   * 手机上一律用 touch：微信 / WhatsApp 等应用内浏览器里，有的声称支持 pointer
   * 却不发 pointermove，原来的写法这种情况下会把 touch 兜底关掉，滑块就拖不动
   */
  const begin = (clientX: number, mode: 'touch' | 'pointer') => {
    if (okRef.current || activeRef.current) return
    activeRef.current = true
    const { track, max } = metrics()
    const hw = handleRef.current?.getBoundingClientRect().width || 40
    const cur = xRef.current
    const px = clientX - track.left
    // 按在手柄上：保持按住点和手柄的相对位置，不跳；按在轨道其它地方：手柄中心移到手指下
    const grabOffset = px >= cur && px <= cur + hw ? px - cur : hw / 2
    setDragging(true)

    let last = cur
    const moveTo = (cx: number) => {
      const nx = Math.max(0, Math.min(max, cx - track.left - grabOffset))
      last = nx
      setX(nx)
      // 留 6px 容差：手机上很难精确停在最后一像素
      if (nx >= max - 6) {
        setX(max)
        finish(true)
      }
    }
    const finish = (success: boolean) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onUp)
      activeRef.current = false
      setDragging(false)
      if (success) {
        pass()
      } else {
        // 抬手时已经很接近终点也算过，别为了几像素折磨人
        if (last >= max - 12) {
          setX(max)
          pass()
        } else {
          setX(0)
          setFails((n) => n + 1)
        }
      }
    }
    const onMove = (ev: PointerEvent) => moveTo(ev.clientX)
    const onTouchMove = (ev: TouchEvent) => {
      // 拖滑块时不让页面跟着滚 / 微信下拉回弹，否则手势会被页面抢走
      if (ev.cancelable) ev.preventDefault()
      const t = ev.touches[0] || ev.changedTouches[0]
      if (t) moveTo(t.clientX)
    }
    const onUp = () => finish(false)

    if (mode === 'touch') {
      window.addEventListener('touchmove', onTouchMove, { passive: false })
      window.addEventListener('touchend', onUp)
      window.addEventListener('touchcancel', onUp)
    } else {
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }
  }

  // 原生监听（React 的 touchstart 是 passive，没法 preventDefault 挡住页面滚动）
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      if (okRef.current) return
      if (e.cancelable) e.preventDefault() // 同时挡掉后续模拟出来的鼠标事件
      const t = e.touches[0]
      if (t) begin(t.clientX, 'touch')
    }
    const onPointerDown = (e: PointerEvent) => {
      if (okRef.current || e.pointerType === 'touch') return // 手指走上面的 touch 通道
      if (e.button !== 0) return
      e.preventDefault()
      begin(e.clientX, 'pointer')
    }
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    // 极老的浏览器两样都没有时，鼠标还能用
    const onMouseDown = (e: MouseEvent) => {
      if (window.PointerEvent || okRef.current) return
      begin(e.clientX, 'pointer')
    }
    el.addEventListener('mousedown', onMouseDown)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('mousedown', onMouseDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    okRef.current = ok
  }, [ok])

  const { max } = ok && trackRef.current ? metrics() : { max: 0 }

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        className={'lg2-slider' + (ok ? ' ok' : '')}
        ref={trackRef}
        style={{ marginBottom: 0, touchAction: 'none', cursor: ok ? 'default' : 'pointer', WebkitTouchCallout: 'none' } as any}
      >
        <div className="fill" style={{ width: x + 20 }} />
        <span className="tip">{ok ? '验证通过' : hint}</span>
        <div
          className="handle"
          ref={handleRef}
          style={{ left: ok ? max : x, transition: dragging ? 'none' : 'left 0.25s' }}
        >
          {ok ? <CheckOutlined /> : <DoubleRightOutlined />}
        </div>
      </div>
      {/* 拖了两次还没成功：多半是这台手机/浏览器不认这套手势，给条活路 */}
      {!ok && fails >= 2 && (
        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <a onClick={pass} style={{ fontSize: 13 }}>
            滑不动？点这里完成验证
          </a>
        </div>
      )}
    </div>
  )
}
