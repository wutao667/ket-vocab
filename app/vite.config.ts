import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 应用配置由 VITE_APP_ID 选择。这里直接 import 同一份 apps.json，
// 避免 vite 配置里再写一遍端口，导致 dev 代理连错服务。
// （不用 node:fs 是因为项目没有装 @types/node，import 由 esbuild 直接内联。）
import apps from './src/config/apps.json'

const APP_ID = (process.env.VITE_APP_ID || 'ket').toLowerCase()
const appConfig = (apps as Record<string, { syncPort: number; ttsPort: number }>)[APP_ID] ?? apps.ket

// 项目没有安装 @types/node，这里只声明用到的部分，避免 tsc 报错
declare const process: { env: Record<string, string | undefined> }

// 本地验证时把 /api 与 /tts 代理到本机服务。
// 目标可用环境变量覆盖，便于在不动生产端口的情况下跑测试。
const apiTarget = process.env.VITE_API_TARGET || `http://127.0.0.1:${appConfig.syncPort}`
const ttsTarget = process.env.VITE_TTS_TARGET || `http://127.0.0.1:${appConfig.ttsPort}`

// dev 与 preview 都要配：preview 不会复用 server.proxy，
// 否则调试页在生产构建的本地预览里请求 /tts 会 404。
//
// 注意 /tts 必须 rewrite 去掉前缀，否则会转发成 /tts/health 打到上游的
// 不存在的路由。生产 Caddy 用 `handle_path /tts/*` 本身就是剥前缀的，
// 这里保持一致，dev/preview 才能和生产行为对齐。
const proxy = {
  '/api': { target: apiTarget, changeOrigin: false },
  '/tts': {
    target: ttsTarget,
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/tts/, ''),
  },
}

export default defineConfig({
  plugins: [react()],
  base: './',
  // 构建目标应用：前端代码通过 import.meta.env.VITE_APP_ID 分支
  define: {
    'import.meta.env.VITE_APP_ID': JSON.stringify(APP_ID),
  },
  // 词库是 400KB 的大 JSON。默认 Vite 会把它编成 JS 对象字面量，
  // V8 需要逐个字段求值，开销远大于 JSON.parse。
  // 开启 stringify 后输出 JSON.parse("…")，解析快数倍，明显改善首次进入的卡顿。
  json: { stringify: true },
  server: { proxy },
  preview: { proxy },
})
