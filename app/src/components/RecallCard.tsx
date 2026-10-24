import { Eye, Star } from 'lucide-react'
import type { VocabEntry } from '../data/types'
import { SpeakButton } from './SpeechControls'

export type RecallDirection = 'en-zh' | 'zh-en'

interface RecallCardProps {
  entry: VocabEntry
  direction: RecallDirection
  revealed: boolean
  favorite: boolean
  onFavorite: () => void
  onReveal: () => void
}

function RevealPlaceholder({ onReveal }: { onReveal: () => void }) {
  return <button type="button" data-recall-answer onClick={onReveal} aria-label="点击查看答案" className="flex min-h-40 w-full items-center justify-center rounded-2xl text-stone-400 transition-colors hover:bg-stone-50 hover:text-stone-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
    <Eye aria-hidden="true" size={34} />
  </button>
}

export function RecallCard({ entry, direction, revealed, favorite, onFavorite, onReveal }: RecallCardProps) {
  return <article className="relative min-h-[28rem] rounded-3xl border border-stone-200 bg-white p-7 text-center shadow-lg">
    <button type="button" aria-label={favorite ? '取消生词标记' : '标记为生词'} aria-pressed={favorite} onClick={onFavorite} className={`absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full ${favorite ? 'bg-amber-100 text-amber-600' : 'bg-stone-100 text-stone-400'}`}><Star fill={favorite ? 'currentColor' : 'none'} /></button>

    {direction === 'en-zh' ? <>
      <section data-recall-prompt className="px-5 pt-8">
        <h2 data-recall-word className="text-4xl font-black">{entry.word}</h2>
        <p className="mt-3 text-lg text-stone-500">{entry.ipa}</p>
        <div className="mt-4 flex justify-center"><SpeakButton id={`recall:${entry.id}`} text={entry.word} label="英文" /></div>
        <p className="mt-5 text-lg leading-relaxed text-stone-700">{entry.example}</p>
      </section>
      <section className="mt-6 min-h-40 border-t border-stone-200 pt-4">
        {revealed
          ? <div data-recall-answer className="flex min-h-40 flex-col items-center justify-center px-2"><p className="text-2xl font-bold">{entry.zh}</p><p className="mt-3 text-base leading-relaxed text-stone-500">{entry.example_zh}</p></div>
          : <RevealPlaceholder onReveal={onReveal} />}
      </section>
    </> : <>
      <section data-recall-prompt className="px-5 pt-10">
        <p data-recall-pos className="mx-auto inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold tracking-wide text-slate-500">{entry.pos}</p>
        <h2 data-recall-meaning className="mt-4 text-3xl font-black text-stone-900">{entry.zh}</h2>
      </section>
      <section className="mt-7 min-h-56 border-t border-stone-200 pt-4">
        {revealed
          ? <div data-recall-answer className="flex min-h-56 flex-col items-center justify-center px-2"><p data-recall-word className="text-4xl font-black">{entry.word}</p><p className="mt-2 text-lg text-stone-500">{entry.ipa}</p><div className="mt-4 flex justify-center"><SpeakButton id={`recall:${entry.id}`} text={entry.word} label="英文" /></div><p className="mt-5 text-lg leading-relaxed">{entry.example}</p><p className="mt-2 text-sm leading-relaxed text-stone-500">{entry.example_zh}</p></div>
          : <RevealPlaceholder onReveal={onReveal} />}
      </section>
    </>}
  </article>
}
