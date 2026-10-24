import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VocabEntry } from '../data/types'
import { SpeechProvider } from '../tts/SpeechProvider'
import { RecallCard } from './RecallCard'

const entry: VocabEntry = { id: 'ket-test', word: 'secret word', ipa: '/secret ipa/', pos: 'v.', zh: '秘密释义', example: 'Secret example.', example_zh: '秘密例句。', source_ipa: '', source_example: '', source_example_zh: '' }
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined }))
function render(direction: 'en-zh' | 'zh-en', revealed: boolean) {
  return renderToStaticMarkup(<SpeechProvider><RecallCard entry={entry} direction={direction} revealed={revealed} favorite={false} onFavorite={() => undefined} onReveal={() => undefined} /></SpeechProvider>)
}
describe('Recall answer DOM safety and regions', () => {
  it('shows the English example and eye placeholder without rendering Chinese answers', () => {
    const html = render('en-zh', false)
    expect(html).toContain(entry.word)
    expect(html).toContain(entry.example)
    expect(html).toContain('data-recall-prompt')
    expect(html).toContain('data-recall-answer')
    expect(html).toContain('lucide-eye')
    expect(html).not.toContain(entry.zh)
    expect(html).not.toContain(entry.example_zh)
  })

  it('does not render English answers, IPA, examples, or speech controls before zh-en reveal', () => {
    const html = render('zh-en', false)
    expect(html).not.toContain(entry.word)
    expect(html).not.toContain(entry.ipa)
    expect(html).not.toContain(entry.example)
    expect(html).not.toContain('朗读英文')
  })

  it('renders complete answers after reveal', () => {
    const enZh = render('en-zh', true)
    const zhEn = render('zh-en', true)
    expect(enZh).toContain(entry.zh)
    expect(enZh).toContain(entry.example_zh)
    expect(zhEn).toContain(entry.word)
    expect(zhEn).toContain(entry.ipa)
    expect(zhEn).toContain(entry.example)
  })

  it('renders part of speech separately from the Chinese meaning', () => {
    const html = render('zh-en', false)
    expect(html).toMatch(/data-recall-pos[^>]*class="[^"]*text-xs[^"]*text-slate-500/)
    expect(html).toMatch(/data-recall-meaning[^>]*class="[^"]*text-3xl[^"]*text-stone-900/)
  })
})
