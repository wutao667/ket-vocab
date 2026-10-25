import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { registerServiceWorker } from './pwa/register'
import './styles.css'

/** 移除 index.html 里的启动画面（淡出后从 DOM 摘掉） */
function dismissBootScreen() {
  const boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('boot-done')
  window.setTimeout(() => boot.remove(), 320)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>,
)

// 首帧渲染完成后再撤掉启动画面，避免闪一下空白
requestAnimationFrame(() => requestAnimationFrame(dismissBootScreen))

// 生产构建下注册 Service Worker，使断网也能从桌面图标打开
registerServiceWorker()
