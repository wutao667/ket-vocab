import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTTSFailuresForTests, speakWithFallback } from './tts'

class MockAudio {
  onended: (() => void) | null = null; onerror: (() => void) | null = null; currentTime = 0
  play() { queueMicrotask(() => this.onended?.()); return Promise.resolve() }
  pause() { /* mock stop */ }
}

beforeEach(() => {
  resetTTSFailuresForTests(); vi.restoreAllMocks()
  vi.stubGlobal('Audio', MockAudio); vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined })
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
