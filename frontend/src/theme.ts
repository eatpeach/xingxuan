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
