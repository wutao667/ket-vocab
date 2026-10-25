import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AccountMenu from './components/AccountMenu'
import SyncStatus from './components/SyncStatus'
import { getActiveProfile } from './auth/session'
import { startSyncTriggers } from './sync/engine'
import HomePage from './pages/HomePage'
import ListPage from './pages/ListPage'
import SelectPage from './pages/SelectPage'
import FavoritesPage from './pages/FavoritesPage'
import LearnPage from './pages/LearnPage'
import RecallPage from './pages/RecallPage'
import LoginPage from './pages/LoginPage'
import { SpeechProvider } from './tts/SpeechProvider'

function AppShell() {
  useEffect(() => startSyncTriggers(), [])
  return <><div className="sticky top-0 z-30 flex min-h-10 items-center justify-end gap-2 border-b border-stone-200 bg-[#f7f4ed]/95 px-3 backdrop-blur"><SyncStatus /><AccountMenu /></div><Routes>
    <Route path="/login" element={<Navigate to="/" replace />} /><Route path="/" element={<HomePage />} /><Route path="/select" element={<SelectPage />} /><Route path="/lists/:listId" element={<ListPage />} /><Route path="/lists/:listId/learn" element={<LearnPage />} /><Route path="/lists/:listId/recall" element={<RecallPage />} /><Route path="/favorites" element={<FavoritesPage />} /><Route path="/favorites/learn" element={<LearnPage favorites />} /><Route path="/favorites/recall" element={<RecallPage favorites />} /><Route path="*" element={<Navigate to="/" replace />} />
  </Routes></>
}
function LoginGate() { const location = useLocation(); return <><LoginPage />{location.pathname !== '/login' && <Navigate to="/login" replace />}</> }
export default function App() {
  const [profile, setProfile] = useState(() => getActiveProfile())
  useEffect(() => { const update = () => setProfile(getActiveProfile()); window.addEventListener('ket-session-change', update); return () => window.removeEventListener('ket-session-change', update) }, [])
  return <SpeechProvider>{profile ? <AppShell /> : <Routes><Route path="*" element={<LoginGate />} /></Routes>}</SpeechProvider>
}
