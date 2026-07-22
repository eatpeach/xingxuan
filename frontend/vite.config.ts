import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // 本地没有 PHP 运行时，/api 和 /storage 直接走线上
      '/api': { target: 'https://www.xingxuan.cc', changeOrigin: true },
      '/storage': { target: 'https://www.xingxuan.cc', changeOrigin: true },
    },
  },
})
