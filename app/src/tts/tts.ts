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

/**
 * 已合成音频的本地缓存（Blob URL）。
 *
 * 为什么需要：同一段文本反复朗读（背诵时点同一个词好几次）每次都打一次
 * 上游，既慢又费额度。缓存后第二次点击可以立刻出声。
 *
 * 用 Map 的插入顺序做 LRU：命中的条目重新插入以刷新位置，
 * 超过上限时淘汰最久未用的并释放它的 Blob URL，避免内存泄漏。
 */
const audioCache = new Map<string, string>()
const AUDIO_CACHE_LIMIT = 40

function cacheKey(engine: CloudEngine, speed: number, text: string) {
  return `${engine}\u0000${speed}\u0000${text}`
}

function rememberAudio(key: string, url: string) {
  audioCache.set(key, url)
  while (audioCache.size > AUDIO_CACHE_LIMIT) {
    const oldest = audioCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    const staleUrl = audioCache.get(oldest)
    audioCache.delete(oldest)
    if (staleUrl) URL.revokeObjectURL(staleUrl)
  }
}

/** 取缓存并把该条刷新为最近使用 */
function takeAudio(key: string): string | null {
  const url = audioCache.get(key)
  if (!url) return null
  audioCache.delete(key)
  audioCache.set(key, url)
  return url
}

export function audioCacheSize() { return audioCache.size }

export function clearAudioCache() {
  for (const url of audioCache.values()) URL.revokeObjectURL(url)
  audioCache.clear()
}

export interface SpeakOptions { engine: TTSEngine; speed: number; signal?: AbortSignal; timeoutMs?: number }
export interface SpeakResult { requested: TTSEngine; engineUsed: TTSEngine }

function abortError() { return new DOMException('播放已停止', 'AbortError') }
export function isLocalTTSSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' && window.speechSynthesis.getVoices().length > 0
}

/** 播放一个已就绪的音频 URL。不在此处 revoke —— URL 由缓存持有。 */
async function playUrl(url: string, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(url)
    const stop = () => { audio.pause(); audio.currentTime = 0; reject(abortError()) }
    signal?.addEventListener('abort', stop, { once: true })
    audio.onended = () => { signal?.removeEventListener('abort', stop); resolve() }
    audio.onerror = () => { signal?.removeEventListener('abort', stop); reject(new Error('音频播放失败')) }
    audio.play().catch(reject)
  })
}

async function cloudSpeak(text: string, engine: CloudEngine, speed: number, signal?: AbortSignal, timeoutMs = 8000) {
  const key = cacheKey(engine, speed, text)

  // 命中缓存：不发请求，直接播
  const cachedUrl = takeAudio(key)
  if (cachedUrl) {
    if (signal?.aborted) throw abortError()
    await playUrl(cachedUrl, signal)
    return
  }

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
    // 存入缓存后播放；URL 交给缓存管理，播放结束不释放
    rememberAudio(key, url)
    await playUrl(url, signal)
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

export function resetTTSFailuresForTests() { failedEngines.clear(); clearAudioCache() }
