// 主题色：localStorage 缓存 + CSS 变量 + 事件广播（antd token 由 App 监听更新）
export const DEFAULT_THEME_COLOR = '#1d57e0'
const KEY = 'theme_color'
const EVENT = 'xingxuan-theme'

export function getThemeColor(): string {
  return localStorage.getItem(KEY) || DEFAULT_THEME_COLOR
}

export function applyThemeColor(color: string): void {
  localStorage.setItem(KEY, color)
  document.documentElement.style.setProperty('--brand', color)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: color }))
}

/** 渲染前调用，避免首帧闪默认色 */
export function initThemeColor(): void {
  document.documentElement.style.setProperty('--brand', getThemeColor())
}

export function onThemeChange(cb: (color: string) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent).detail)
  window.addEventListener(EVENT, h)
  return () => window.removeEventListener(EVENT, h)
}

/** 由主题色派生深色 chrome（header/侧栏背景）：26% 主色混入深底 */
export function darkChrome(color: string): string {
  const hex = color.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
  const base = { r: 0x12, g: 0x14, b: 0x1f }
  const k = 0.26
  const mix = (c: number, d: number) => Math.round(c * k + d * (1 - k))
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r, base.r))}${toHex(mix(g, base.g))}${toHex(mix(b, base.b))}`
}
