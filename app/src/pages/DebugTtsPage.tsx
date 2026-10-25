import { useCallback, useState } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CLOUD_ENGINES, DEFAULT_VOICE, TTS_BASE, isLocalTTSSupported, type CloudEngine } from '../tts/tts'

/**
 * TTS 调试页。
 *
 * 逐引擎发真实请求，把 HTTP 状态、响应类型、字节数、错误详情全部摊开，
 * 方便判断「是没配 key、参数不对、还是上游挂了」。
 */

type EngineResult = {
  engine: CloudEngine
  state: 'idle' | 'running' | 'ok' | 'fail'
  status?: number
  contentType?: string
  bytes?: number
  elapsedMs?: number
  errorCode?: string
  errorMessage?: string
  rawDetail?: string
  playableUrl?: string
  voiceSent?: string
}

/** 各引擎的音色名称不同，调试时按引擎给一个合理的默认值 */
const VOICE_BY_ENGINE: Record<CloudEngine, string> = {
  edge: DEFAULT_VOICE,
  tencent: '1051',
  minimax: '',
  glm: 'female',
}

export default function DebugTtsPage() {
  const [text, setText] = useState('hello')
  const [speed, setSpeed] = useState(0.85)
  const [results, setResults] = useState<Record<string, EngineResult>>({})
  const [availability, setAvailability] = useState<Record<string, boolean> | null>(null)
  const [probeError, setProbeError] = useState('')

  const update = useCallback((engine: CloudEngine, patch: Partial<EngineResult>) => {
    setResults((current) => ({
      ...current,
      [engine]: { ...(current[engine] ?? { engine, state: 'idle' }), ...patch },
    }))
  }, [])

  const probe = useCallback(async () => {
    setProbeError('')
    setAvailability(null)
    try {
      const response = await fetch(`${TTS_BASE}/api/tts-available`)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setProbeError(`HTTP ${response.status}：${JSON.stringify(body).slice(0, 200)}`)
        return
      }
      setAvailability(body as Record<string, boolean>)
    } catch (error) {
      setProbeError(`探测失败：${(error as Error).message}`)
    }
  }, [])

  const testEngine = useCallback(async (engine: CloudEngine) => {
    const voice = VOICE_BY_ENGINE[engine]
    update(engine, { state: 'running', status: undefined, contentType: undefined, bytes: undefined, errorCode: undefined, errorMessage: undefined, rawDetail: undefined, playableUrl: undefined, voiceSent: voice })

    const started = performance.now()
    try {
      const response = await fetch(`${TTS_BASE}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, engine, voice, speed }),
      })
      const elapsedMs = Math.round(performance.now() - started)
      const contentType = response.headers.get('content-type') ?? ''

      // 失败：上游把错误包成 JSON 返回
      if (!response.ok || contentType.includes('application/json')) {
        const body = await response.json().catch(() => null) as
          | { error?: string; status?: number; detail?: string }
          | null
        update(engine, {
          state: 'fail',
          status: response.status,
          contentType,
          elapsedMs,
          errorCode: body?.error ?? `HTTP_${response.status}`,
          errorMessage: body?.detail ?? '',
          bytes: 0,
        })
        return
      }

      const blob = await response.blob()
      if (!blob.size) {
        update(engine, { state: 'fail', status: response.status, contentType, elapsedMs, bytes: 0, errorCode: 'EMPTY_AUDIO', errorMessage: '上游返回了空音频' })
        return
      }
      update(engine, {
        state: 'ok',
        status: response.status,
        contentType,
        bytes: blob.size,
        elapsedMs,
        playableUrl: URL.createObjectURL(blob),
      })
    } catch (error) {
      update(engine, {
        state: 'fail',
        elapsedMs: Math.round(performance.now() - started),
        errorCode: 'NETWORK_ERROR',
        errorMessage: (error as Error).message,
      })
    }
  }, [speed, text, update])

  const testAll = useCallback(async () => {
    // 顺序执行，避免并发打满上游
    for (const engine of CLOUD_ENGINES) await testEngine(engine)
  }, [testEngine])

  return <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-5">
    <header className="flex items-center gap-3">
      <Link to="/" aria-label="返回首页" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-stone-200"><ArrowLeft /></Link>
      <div><p className="text-sm font-bold text-brand">调试</p><h1 className="text-2xl font-black">TTS 引擎检测</h1></div>
    </header>

    {/* 测试参数 */}
    <section className="mt-5 rounded-2xl border border-stone-200 bg-white p-4">
      <label className="block text-sm font-semibold">测试文本
        <input value={text} onChange={(event) => setText(event.target.value)} maxLength={80} className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 px-3 font-normal" />
      </label>
      <label className="mt-3 block text-sm font-semibold">语速 <span className="font-normal text-stone-500">{speed}×</span>
        <input type="range" min={0.5} max={1.2} step={0.05} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="mt-1 w-full" />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => void testAll()} className="min-h-11 rounded-lg bg-brand px-4 text-sm font-bold text-white">测试全部引擎</button>
        <button onClick={() => void probe()} className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm font-semibold">探测可用性</button>
        <button onClick={() => { setResults({}); setAvailability(null); setProbeError('') }} className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm font-semibold text-stone-600">清空结果</button>
      </div>
    </section>

    {/* 可用性探测结果 */}
    {(availability || probeError) && <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-bold">上游 /tts/api/tts-available</h2>
      {probeError && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">{probeError}</p>}
      {availability && <div className="mt-2 flex flex-wrap gap-2">
        {CLOUD_ENGINES.map((engine) => {
          const ok = Boolean(availability[engine])
          return <span key={engine} className={`rounded-full px-3 py-1 text-sm font-semibold ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
            {engine} {ok ? '报告可用' : '报告不可用'}
          </span>
        })}
      </div>}
      <p className="mt-2 text-xs text-stone-500">注意：「报告可用」只代表上游配了 key，不代表真的能出声。</p>
    </section>}

    {/* 逐引擎结果 */}
    <section className="mt-4 space-y-3">
      {CLOUD_ENGINES.map((engine) => {
        const result = results[engine] ?? { engine, state: 'idle' as const }
        const running = result.state === 'running'
        return <article key={engine} className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-lg font-bold">{engine}</h2>
            {result.state === 'ok' && <CheckCircle2 size={20} className="text-emerald-600" />}
            {result.state === 'fail' && <XCircle size={20} className="text-red-600" />}
            {running && <Loader2 size={20} className="animate-spin text-stone-400" />}
            <button
              onClick={() => void testEngine(engine)}
              disabled={running}
              className="min-h-9 rounded-lg border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"
            >{running ? '测试中…' : '测试'}</button>
          </div>

          <p className="mt-1 text-xs text-stone-500">
            发送参数：text="{text}" · voice="{result.voiceSent ?? VOICE_BY_ENGINE[engine]}" · speed={speed}
          </p>

          {result.state === 'ok' && <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
            <p className="font-bold text-emerald-800">出声成功</p>
            <p className="mt-1 text-emerald-900">HTTP {result.status} · {result.contentType} · {result.bytes} 字节 · {result.elapsedMs}ms</p>
            {result.playableUrl && <audio controls src={result.playableUrl} className="mt-2 w-full" />}
          </div>}

          {result.state === 'fail' && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm">
            <p className="font-bold text-red-800">失败：{result.errorCode}</p>
            <ul className="mt-1 space-y-0.5 text-red-900">
              {result.status !== undefined && <li>HTTP 状态：{result.status}</li>}
              {result.contentType && <li>响应类型：{result.contentType}</li>}
              {result.elapsedMs !== undefined && <li>耗时：{result.elapsedMs}ms</li>}
              {result.errorMessage && <li className="break-all">详情：{result.errorMessage}</li>}
            </ul>
          </div>}
        </article>
      })}
    </section>

    {/* 浏览器内置语音 */}
    <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
      <h2 className="text-lg font-bold">local（浏览器内置）</h2>
      <p className="mt-1 text-xs text-stone-500">
        {isLocalTTSSupported() ? '当前浏览器支持 speechSynthesis' : '当前浏览器不支持或无可用音色'}
      </p>
    </section>
  </main>
}
