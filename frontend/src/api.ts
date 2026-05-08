import axios from 'axios'
import { message } from 'antd'

export const api = axios.create({ baseURL: '/api/v1', timeout: 20000 })

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token')
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e?.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.hash = '#/login'
    } else {
      message.error(e?.response?.data?.detail || e.message || '请求失败')
    }
    return Promise.reject(e)
  },
)

export interface Page<T> { items: T[]; total: number; page: number; page_size: number }
