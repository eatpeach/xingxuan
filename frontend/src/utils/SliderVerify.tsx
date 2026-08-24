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

  const begin = (clientX: number, setCapture?: () => void) => {
    if (okRef.current) return
    const { track, max } = metrics()
    // 按住点相对手柄左边的偏移：不把手柄中心硬拽到手指下面，避免起手跳一下
    const grabOffset = Math.max(0, Math.min(track.width, clientX - track.left)) - x
    setDragging(true)
    setCapture?.()

    let last = x
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
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('touchcancel', onCancel)
      setDragging(false)
      if (success) {
        pass()
      } else {
        setX(0)
        // 抬手时已经很接近终点也算过，别为了几像素折磨人
        if (last >= max - 12) pass()
        else setFails((n) => n + 1)
      }
    }
    const onMove = (ev: PointerEvent) => moveTo(ev.clientX)
    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches[0]) moveTo(ev.touches[0].clientX)
    }
    const onUp = () => finish(false)
    // 浏览器把手势收走了（判定成滚动）：干净收尾，不能让滑块冻在半路
    const onCancel = () => finish(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchcancel', onCancel)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (okRef.current) return
    e.preventDefault()
    const el = handleRef.current
    begin(e.clientX, () => {
      // 捕获指针：手指滑出手柄范围后事件仍然回到这里
      try { el?.setPointerCapture(e.pointerId) } catch { /* 老 WebView 没有就算了 */ }
    })
  }

  // 不支持 Pointer Events 的老 WebView 走这条
  const onTouchStart = (e: React.TouchEvent) => {
    if (okRef.current || window.PointerEvent) return
    begin(e.touches[0].clientX)
  }

  useEffect(() => {
    okRef.current = ok
  }, [ok])

  const { max } = ok && trackRef.current ? metrics() : { max: 0 }

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        className={'lg2-slider' + (ok ? ' ok' : '')}
        ref={trackRef}
        style={{ marginBottom: 0, touchAction: 'none' }}
      >
        <div className="fill" style={{ width: x + 20 }} />
        <span className="tip">{ok ? '验证通过' : hint}</span>
        <div
          className="handle"
          ref={handleRef}
          style={{ left: ok ? max : x, transition: dragging ? 'none' : 'left 0.25s' }}
          onPointerDown={onPointerDown}
          onTouchStart={onTouchStart}
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
