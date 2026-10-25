import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 项目没有安装 @types/node，这里只声明用到的部分，避免 tsc 报错
declare const process: { env: Record<string, string | undefined> }

// 本地验证时把 /api 与 /tts 代理到本机服务。
// 目标可用环境变量覆盖，便于在不动生产端口的情况下跑测试。
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3117'
const ttsTarget = process.env.VITE_TTS_TARGET || 'http://127.0.0.1:3116'

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
  server: { proxy },
  preview: { proxy },
})
