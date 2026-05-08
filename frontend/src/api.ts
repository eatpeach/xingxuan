import axios from 'axios'
import { message } from 'antd'

// 后端是 action-based 单入口：所有请求都发到 /api/handler.php?action=xxx
// dev 时通过 vite 代理转发到 PHP，生产直接同域部署
// AI 解析等接口可能 30s+，统一放宽到 90s
const http = axios.create({ baseURL: '/api/handler.php', timeout: 90000 })

http.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

http.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e?.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.hash = '#/login'
    } else {
      message.error(e?.response?.data?.message || e.message || '请求失败')
    }
    return Promise.reject(e)
  },
)

/**
 * 调用某个 action：
 *   GET  → query string
 *   POST → JSON body（同时把 action 放在 query 里）
 */
async function call<T = any>(method: 'GET' | 'POST', action: string, params: Record<string, any> = {}): Promise<T> {
  if (method === 'GET') {
    const r = await http.get('', { params: { action, ...params } })
    if (r.data && r.data.success === false) throw new Error(r.data.message || '请求失败')
    return r.data
  }
  const r = await http.post('', params, { params: { action } })
  if (r.data && r.data.success === false) throw new Error(r.data.message || '请求失败')
  return r.data
}

async function upload<T = any>(action: string, formData: FormData): Promise<T> {
  const r = await http.post('', formData, {
    params: { action },
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  if (r.data && r.data.success === false) throw new Error(r.data.message || '请求失败')
  return r.data
}

async function download(action: string, params: Record<string, any> = {}, fallbackName = 'download'): Promise<void> {
  const r = await http.get('', {
    params: { action, ...params },
    responseType: 'blob',
  })
  // 解析后端 Content-Disposition 中的 filename*=UTF-8''xxx
  const cd = r.headers?.['content-disposition'] || r.headers?.['Content-Disposition']
  let filename = fallbackName
  if (typeof cd === 'string') {
    const m1 = cd.match(/filename\*=UTF-8''([^;]+)/i)
    const m2 = cd.match(/filename="([^"]+)"/i)
    if (m1) filename = decodeURIComponent(m1[1])
    else if (m2) filename = decodeURIComponent(m2[1])
  }
  const blob = new Blob([r.data])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const api = {
  get: <T = any>(action: string, params?: Record<string, any>) => call<T>('GET', action, params),
  post: <T = any>(action: string, params?: Record<string, any>) => call<T>('POST', action, params),
  upload: <T = any>(action: string, formData: FormData) => upload<T>(action, formData),
  download: (action: string, params?: Record<string, any>, fallbackName?: string) =>
    download(action, params, fallbackName),
}

export interface PageResp<T> { items: T[]; total: number; page: number; page_size: number; success: boolean }
