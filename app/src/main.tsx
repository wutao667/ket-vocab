import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { registerServiceWorker } from './pwa/register'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>,
)

// 生产构建下注册 Service Worker，使断网也能从桌面图标打开
registerServiceWorker()
