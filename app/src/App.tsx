import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ListPage from './pages/ListPage'
import SelectPage from './pages/SelectPage'
import FavoritesPage from './pages/FavoritesPage'
import LearnPage from './pages/LearnPage'
import RecallPage from './pages/RecallPage'
import { SpeechProvider } from './tts/SpeechProvider'

export default function App() {
  return <SpeechProvider><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/select" element={<SelectPage />} />
    <Route path="/lists/:listId" element={<ListPage />} />
    <Route path="/lists/:listId/learn" element={<LearnPage />} />
    <Route path="/lists/:listId/recall" element={<RecallPage />} />
    <Route path="/favorites" element={<FavoritesPage />} />
    <Route path="/favorites/learn" element={<LearnPage favorites />} />
    <Route path="/favorites/recall" element={<RecallPage favorites />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></SpeechProvider>
}
