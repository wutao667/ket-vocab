import { beforeEach, describe, expect, it, vi } from 'vitest'
import { audioCacheSize, resetTTSFailuresForTests, speakWithFallback } from './tts'

let audioPlayCount = 0
class MockAudio {
  onended: (() => void) | null = null; onerror: (() => void) | null = null; currentTime = 0
  play() { audioPlayCount += 1; queueMicrotask(() => this.onended?.()); return Promise.resolve() }
  pause() { /* mock stop */ }
}

let createdUrls = 0
let revokedUrls = 0
beforeEach(() => {
  resetTTSFailuresForTests(); vi.restoreAllMocks()
  audioPlayCount = 0; createdUrls = 0; revokedUrls = 0
  vi.stubGlobal('Audio', MockAudio)
  vi.stubGlobal('URL', {
    createObjectURL: () => { createdUrls += 1; return `blob:test-${createdUrls}` },
    revokeObjectURL: () => { revokedUrls += 1 },
  })
  vi.stubGlobal('window', {})
})

describe('TTS fallback chain', () => {
  it('reports the actual engine after a selected engine fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(new Blob(['mp3']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(speakWithFallback('look after', { engine: 'edge', speed: 0.85 })).resolves.toEqual({ requested: 'edge', engineUsed: 'tencent' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toBe('look after')
  })

  it('skips dead engines later in the same session, except a newly selected engine', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Blob(['ok']), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Blob(['ok']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await speakWithFallback('one', { engine: 'edge', speed: 0.85 })
    const result = await speakWithFallback('two', { engine: 'minimax', speed: 0.85 })
    expect(result.engineUsed).toBe('tencent')
    expect(fetchMock.mock.calls.slice(2).map((call) => JSON.parse(call[1].body).engine)).toEqual(['minimax', 'tencent'])
  })

  it('still gives a previously failed engine one chance when the user selects it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(new Blob(['ok']), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['retry-ok']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await speakWithFallback('first', { engine: 'edge', speed: 0.85 })
    const result = await speakWithFallback('retry', { engine: 'edge', speed: 0.85 })
    expect(result).toEqual({ requested: 'edge', engineUsed: 'edge' })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).engine).toBe('edge')
  })

  it('does not fall back after user AbortError', async () => {
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError')))))
    vi.stubGlobal('fetch', fetchMock); const controller = new AbortController()
    const pending = speakWithFallback('stop me', { engine: 'edge', speed: 0.85, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('TTS audio cache', () => {
  it('plays the second identical request from cache without hitting fetch', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Blob(['mp3']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await speakWithFallback('picnic', { engine: 'edge', speed: 0.85 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(createdUrls).toBe(1)

    await speakWithFallback('picnic', { engine: 'edge', speed: 0.85 })
    // 关键断言：第二次没有再发请求，但确实播放了
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(audioPlayCount).toBe(2)
    expect(audioCacheSize()).toBe(1)
  })

  it('treats different speed or text as different cache entries', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Blob(['mp3']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await speakWithFallback('picnic', { engine: 'edge', speed: 0.85 })
    await speakWithFallback('picnic', { engine: 'edge', speed: 1 })
    await speakWithFallback('zoo', { engine: 'edge', speed: 0.85 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(audioCacheSize()).toBe(3)
  })

  it('caches per engine, so switching engine refetches', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Blob(['mp3']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    await speakWithFallback('picnic', { engine: 'edge', speed: 0.85 })
    await speakWithFallback('picnic', { engine: 'tencent', speed: 0.85 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(audioCacheSize()).toBe(2)
  })

  it('evicts oldest entries beyond the limit and revokes their blob urls', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Blob(['mp3']), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)

    // 上限是 40，写入 42 条
    for (let i = 0; i < 42; i += 1) {
      await speakWithFallback(`word-${i}`, { engine: 'edge', speed: 0.85 })
    }
    expect(audioCacheSize()).toBe(40)
    expect(revokedUrls).toBe(2)
  })
})
