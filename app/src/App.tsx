import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AccountMenu from './components/AccountMenu'
import SyncStatus from './components/SyncStatus'
import { getActiveProfile } from './auth/session'
import { startSyncTriggers } from './sync/engine'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import UpdatePrompt from './pwa/UpdatePrompt'
import { SpeechProvider } from './tts/SpeechProvider'

/**
 * 路由级代码分割。
 *
 * 首页和登录页保持直接引入——它们不需要 1723 条词库，必须最快可用。
 * 其余页面全部懒加载：它们依赖词库，让 Rollup 把词库打进单独的 chunk，
 * 首页首屏就不用背着 400KB+ 的词库一起下载。
 */
const SelectPage = lazy(() => import('./pages/SelectPage'))
const ListPage = lazy(() => import('./pages/ListPage'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'))
const LearnPage = lazy(() => import('./pages/LearnPage'))
const RecallPage = lazy(() => import('./pages/RecallPage'))
const DebugTtsPage = lazy(() => import('./pages/DebugTtsPage'))

/** 懒加载时的过渡界面：给出明确反馈而不是白屏 */
function RouteFallback() {
  return <div className="grid min-h-[60vh] place-items-center px-6">
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-3 border-stone-300 border-t-brand" />
      <p className="mt-3 text-sm text-stone-500">正在加载…</p>
    </div>
  </div>
}

function AppShell() {
  useEffect(() => startSyncTriggers(), [])
  return <>
    <div className="sticky top-0 z-30 flex min-h-10 items-center justify-end gap-2 border-b border-stone-200 bg-[#f7f4ed]/95 px-3 backdrop-blur"><SyncStatus /><AccountMenu /></div>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/select" element={<SelectPage />} />
        <Route path="/lists/:listId" element={<ListPage />} />
        <Route path="/lists/:listId/learn" element={<LearnPage />} />
        <Route path="/lists/:listId/recall" element={<RecallPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/favorites/learn" element={<LearnPage favorites />} />
        <Route path="/favorites/recall" element={<RecallPage favorites />} />
        <Route path="/debug/tts" element={<DebugTtsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  </>
}

function LoginGate() {
  const location = useLocation()
  return <><LoginPage />{location.pathname !== '/login' && <Navigate to="/login" replace />}</>
}

export default function App() {
  const [profile, setProfile] = useState(() => getActiveProfile())
  useEffect(() => {
    const update = () => setProfile(getActiveProfile())
    window.addEventListener('ket-session-change', update)
    return () => window.removeEventListener('ket-session-change', update)
  }, [])
  return <SpeechProvider>{profile ? <AppShell /> : <Routes><Route path="*" element={<LoginGate />} /></Routes>}<UpdatePrompt /></SpeechProvider>
}
