import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { SpeakButton, SpeechSettings } from '../components/SpeechControls'
import { ZhMeaning } from '../components/ZhMeaning'
import { useStudySource } from '../hooks/useStudySource'

export default function LearnPage({ favorites = false }: { favorites?: boolean }) {
  const { listId } = useParams(); const { source, error } = useStudySource(listId, favorites)
  if (source === undefined) return <main className="p-8 text-center text-stone-500">正在准备学习内容…</main>
  if (!source) return <main className="p-8 text-center"><p>{error || '列表不存在'}</p><Link to="/" className="text-brand underline">返回首页</Link></main>
  return <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-5"><header className="flex items-center gap-3"><Link to={source.backTo} aria-label="退出学习" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-stone-200"><ArrowLeft /></Link><div><p className="text-sm font-bold text-brand">学习模式</p><h1 className="text-2xl font-black">{source.title}</h1></div></header>
    <div className="mt-5"><SpeechSettings /></div>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    {source.entries.length === 0 ? <div className="mt-8 rounded-2xl border-2 border-dashed p-10 text-center text-stone-500">这里还没有词条。</div> : <ol className="mt-5 space-y-4">{source.entries.map((entry, index) => <li key={entry.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold text-stone-400">{index + 1} / {source.entries.length}</p><div className="mt-1 flex flex-wrap items-baseline gap-x-3"><h2 className="text-2xl font-black">{entry.word}</h2><span className="text-stone-500">{entry.ipa}</span><span className="rounded bg-emerald-50 px-2 py-0.5 text-sm text-emerald-800">{entry.pos}</span></div><p className="mt-2 text-lg"><ZhMeaning zh={entry.zh} /></p><div className="mt-4 border-l-4 border-amber-300 pl-3"><p>{entry.example}</p><p className="mt-1 text-sm text-stone-500">{entry.example_zh}</p></div><div className="mt-4 flex gap-2"><SpeakButton id={`${entry.id}:word`} text={entry.word} label="单词" /><SpeakButton id={`${entry.id}:example`} text={entry.example} label="例句" /></div></li>)}</ol>}
  </main>
}
