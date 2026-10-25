export const CLOUD_ENGINES = ['edge', 'tencent', 'minimax', 'glm'] as const
export type CloudEngine = typeof CLOUD_ENGINES[number]
export type TTSEngine = CloudEngine | 'local'
export const DEFAULT_VOICE = 'en-GB-SoniaNeural'
export const TTS_BASE = import.meta.env.VITE_TTS_BASE ?? '/tts'

/**
 * 各引擎的音色标识格式完全不同，不能共用一个值：
 *   edge    → 音色名字符串（en-GB-SoniaNeural）
 *   tencent → 整数音色 ID（1051 为英式女声）
 *   glm     → 音色名（female / male）
 *   minimax → 上游写死了音色，不传该参数
 * 传错格式会直接 400，这就是之前「除 edge 都不出声」的真正原因。
 */
export const VOICE_BY_ENGINE: Record<CloudEngine, string> = {
  edge: DEFAULT_VOICE,
  tencent: '1051',
  glm: 'female',
  minimax: '',
}

const failedEngines = new Set<CloudEngine>()

export interface SpeakOptions { engine: TTSEngine; speed: number; signal?: AbortSignal; timeoutMs?: number }
export interface SpeakResult { requested: TTSEngine; engineUsed: TTSEngine }

function abortError() { return new DOMException('播放已停止', 'AbortError') }
export function isLocalTTSSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' && window.speechSynthesis.getVoices().length > 0
}

async function cloudSpeak(text: string, engine: CloudEngine, speed: number, signal?: AbortSignal, timeoutMs = 8000) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`${engine} 请求超时`)), timeoutMs)
  try {
    const response = await fetch(`${TTS_BASE}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, engine, voice: VOICE_BY_ENGINE[engine], speed }), signal: controller.signal })
    if (!response.ok) throw new Error(`${engine} 朗读服务不可用 (${response.status})`)
    const blob = await response.blob()
    if (signal?.aborted) throw abortError()
    const url = URL.createObjectURL(blob)
    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(url)
        const stop = () => { audio.pause(); audio.currentTime = 0; reject(abortError()) }
        signal?.addEventListener('abort', stop, { once: true })
        audio.onended = () => { signal?.removeEventListener('abort', stop); resolve() }
        audio.onerror = () => { signal?.removeEventListener('abort', stop); reject(new Error(`${engine} 音频播放失败`)) }
        audio.play().catch(reject)
      })
    } finally { URL.revokeObjectURL(url) }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    if (error instanceof DOMException && error.name === 'AbortError' && controller.signal.reason instanceof Error) throw controller.signal.reason
    throw error
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}

async function localSpeak(text: string, speed: number, signal?: AbortSignal) {
  if (!isLocalTTSSupported()) throw new Error('此浏览器没有可用的本地语音')
  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-GB'; utterance.rate = speed
    const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith('en-gb'))
    if (voice) utterance.voice = voice
    const stop = () => { window.speechSynthesis.cancel(); reject(abortError()) }
    signal?.addEventListener('abort', stop, { once: true })
    utterance.onend = () => { signal?.removeEventListener('abort', stop); resolve() }
    utterance.onerror = (event) => { signal?.removeEventListener('abort', stop); reject(new Error(event.error || '本地语音播放失败')) }
    window.speechSynthesis.speak(utterance)
  })
}

export async function speakWithFallback(text: string, options: SpeakOptions): Promise<SpeakResult> {
  const requested = options.engine
  let lastError: unknown = new Error('没有可用的语音引擎')
  if (requested === 'local') {
    try { await localSpeak(text, options.speed, options.signal); return { requested, engineUsed: 'local' } }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; lastError = error }
  }
  const cloudOrder: CloudEngine[] = requested === 'local'
    ? CLOUD_ENGINES.filter((engine) => !failedEngines.has(engine))
    : [requested, ...CLOUD_ENGINES.filter((engine) => engine !== requested && !failedEngines.has(engine))]
  for (const engine of cloudOrder) {
    try { await cloudSpeak(text, engine, options.speed, options.signal, options.timeoutMs); return { requested, engineUsed: engine } }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      failedEngines.add(engine); lastError = error
    }
  }
  if (requested !== 'local' && isLocalTTSSupported()) {
    try { await localSpeak(text, options.speed, options.signal); return { requested, engineUsed: 'local' } }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; lastError = error }
  }
  throw lastError
}

export function resetTTSFailuresForTests() { failedEngines.clear() }
