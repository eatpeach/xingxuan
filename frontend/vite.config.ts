import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * `/api` 与 `/storage` 的代理目标（20260810-21）
 *
 * 🔴 默认必须是本地。以前这里写死指生产站，于是「本地开发」实际上一直在操作生产数据；
 * 再叠加「本地免滑块」就等于把生产登录的人机验证拆了。
 * 默认本地之后，忘了设变量最多是本地后端没起、请求连不上——不会误伤生产。
 *
 * 本地后端：/opt/homebrew/bin/php -S 127.0.0.1:8000 -t backend
 * 要临时对着生产看数据（只读排查用）：
 *   VITE_API_TARGET=https://www.xingxuan.cc npm run dev
 *   —— 这种情况下滑块【不会】跳过，因为判据要求 API 指向本地。
 */
const DEFAULT_LOCAL_API = 'http://127.0.0.1:8000'
const API_TARGET = process.env.VITE_API_TARGET || DEFAULT_LOCAL_API

export default defineConfig({
  plugins: [react()],
  define: {
    // 注入给前端做「后端是不是本地」的判据。
    // 值来自开发者自己机器上的环境变量 / 默认值，**不来自浏览器里任何用户可控的输入**。
    __API_TARGET__: JSON.stringify(API_TARGET),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/storage': { target: API_TARGET, changeOrigin: true },
    },
  },
})
