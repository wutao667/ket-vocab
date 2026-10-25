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

/**
 * 首页空闲时后台预取词库。
 *
 * 为什么需要：词库约 128KB(gzip)，拆包后首屏快了，
 * 但首次点「选词/列表/学习/背诵」时要临时下载，体感是明显卡顿。
 * 首页本身不需要词库，所以在它渲染完成后用空闲时间提前拉走，
 * 用户真正点击时模块已在缓存里，点击即响应。
 *
 * 用 requestIdleCallback 保证不抢首屏资源；不支持时退回 setTimeout。
 * 失败忽略——只是预热，真正的加载仍由路由懒加载负责。
 */
function prefetchVocabulary() {
  const run = () => {
    void import('./data/vocabulary').catch(() => undefined)
  }
  const ric = (globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }).requestIdleCallback
  if (typeof ric === 'function') ric(run, { timeout: 2500 })
  else window.setTimeout(run, 1200)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>,
)

// 首帧渲染完成后再撤掉启动画面，避免闪一下空白
requestAnimationFrame(() => requestAnimationFrame(dismissBootScreen))

// 首页可见之后，趁空闲把词库拉下来，消除首次点击的等待
requestAnimationFrame(() => requestAnimationFrame(prefetchVocabulary))

// 生产构建下注册 Service Worker，使断网也能从桌面图标打开
registerServiceWorker()
