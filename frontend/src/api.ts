import axios from 'axios'
import { message } from 'antd'

// 后端是 action-based 单入口：所有请求都发到 /api/handler.php?action=xxx
// dev 时通过 vite 代理转发到 PHP，生产直接同域部署
const http = axios.create({ baseURL: '/api/handler.php', timeout: 20000 })

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

export const api = {
  get: <T = any>(action: string, params?: Record<string, any>) => call<T>('GET', action, params),
  post: <T = any>(action: string, params?: Record<string, any>) => call<T>('POST', action, params),
}

export interface PageResp<T> { items: T[]; total: number; page: number; page_size: number; success: boolean }
