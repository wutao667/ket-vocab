import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时把 /api 代理到本地同步服务。
// 目标可用环境变量覆盖，便于在不动生产端口（3117）的情况下跑测试。
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3117'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
})
