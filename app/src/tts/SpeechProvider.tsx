import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { speakWithFallback, type TTSEngine } from './tts'
import { storageKey } from '../config/app-config'

interface SpeechContextValue {
  activeKey: string; engine: TTSEngine; actualEngine: TTSEngine | ''; speed: number; message: string
  setEngine: (engine: TTSEngine) => void; setSpeed: (speed: number) => void
  play: (key: string, text: string) => void; stop: () => void
}
const SpeechContext = createContext<SpeechContextValue | null>(null)

export function SpeechProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ key: string; text: string; engine: TTSEngine; speed: number; nonce: number } | null>(null)
  const [engine, setEngineState] = useState<TTSEngine>(() => (localStorage.getItem(storageKey('tts-engine')) as TTSEngine) || 'edge')
  const [speed, setSpeedState] = useState(() => Number(localStorage.getItem(storageKey('tts-speed'))) || 0.85)
  const [actualEngine, setActualEngine] = useState<TTSEngine | ''>(''); const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const stop = useCallback(() => setRequest(null), [])
  const play = useCallback((key: string, text: string) => {
    setMessage('')
    setRequest((current) => current?.key === key ? null : { key, text, engine, speed, nonce: Date.now() })
  }, [engine, speed])
  useEffect(() => {
    if (!request) return
    const current = new AbortController(); controller.current = current
    void speakWithFallback(request.text, { engine: request.engine, speed: request.speed, signal: current.signal }).then((result) => {
      if (current.signal.aborted || controller.current !== current) return
      setActualEngine(result.engineUsed)
      if (result.requested !== result.engineUsed) setMessage(`已回退到 ${result.engineUsed}`)
    }).catch((error: Error) => {
      if (current.signal.aborted || error.name === 'AbortError') return
      setMessage(`暂时无法朗读：${error.message}。文字学习仍可继续。`)
    }).finally(() => { if (!current.signal.aborted && controller.current === current) { controller.current = null; setRequest(null) } })
    return () => { current.abort(); if (controller.current === current) controller.current = null }
  }, [request])
  const setEngine = (value: TTSEngine) => { setEngineState(value); localStorage.setItem(storageKey('tts-engine'), value) }
  const setSpeed = (value: number) => { setSpeedState(value); localStorage.setItem(storageKey('tts-speed'), String(value)) }
  const activeKey = request?.key ?? ''
  const value = useMemo(() => ({ activeKey, engine, actualEngine, speed, message, setEngine, setSpeed, play, stop }), [activeKey, engine, actualEngine, speed, message, play, stop])
  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
}
// This hook intentionally shares the provider's live playback state.
// eslint-disable-next-line react-refresh/only-export-components
export function useSpeech() { const value = useContext(SpeechContext); if (!value) throw new Error('SpeechProvider missing'); return value }
