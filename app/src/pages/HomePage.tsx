import { BookOpen, ChevronRight, Plus, Star } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { repository } from '../db/repository'
import type { StudyList } from '../db/schema'
import { useDataRefresh } from '../hooks/useDataRefresh'

export default function HomePage() {
  const [lists, setLists] = useState<StudyList[]>([]); const [favoriteCount, setFavoriteCount] = useState(0); const [error, setError] = useState('')
  const dataVersion = useDataRefresh()
  const load = useCallback(() => Promise.all([repository.getLists(), repository.getFavoriteIds()]).then(([value, favorites]) => { setLists(value); setFavoriteCount(new Set(favorites).size) }).catch((problem: Error) => setError(problem.message)), [])
  useEffect(() => { void load() }, [load, dataVersion])
  return <main className="mx-auto min-h-[100dvh] max-w-3xl px-5 py-8">
    <header className="flex items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[.2em] text-brand">KET Vocabulary</p><h1 className="mt-1 text-4xl font-black tracking-tight">我的词匣</h1><p className="mt-2 text-slate-600">把今天要学的词，装进一个清晰的列表。</p></div><BookOpen className="hidden text-brand sm:block" size={52} strokeWidth={1.5} /></header>
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-800">{error} 当前无法读取或保存列表。</p>}
    <div className="mt-8 grid grid-cols-2 gap-3"><Link to="/select" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-lg font-bold text-white shadow-lg shadow-emerald-950/10"><Plus />开始选词</Link><Link to="/favorites" className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 font-bold text-amber-700"><Star fill="currentColor" />生词本 {favoriteCount}</Link></div>
    <section className="mt-10"><h2 className="text-lg font-bold">背诵列表</h2>{lists.length === 0 ? <div className="mt-3 rounded-2xl border-2 border-dashed border-stone-300 p-10 text-center text-stone-500">还没有列表。从 25 个主题里挑一组词吧。</div> : <ul className="mt-3 space-y-3">{lists.map((list) => <li key={list.id}><Link to={`/lists/${list.id}`} className="flex min-h-20 items-center rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:border-emerald-300"><div className="min-w-0 flex-1"><h3 className="truncate font-bold">{list.name}</h3><p className="mt-1 text-sm text-stone-500">{list.vocabIds.length} 个词 · {new Date(list.createdAt).toLocaleDateString('zh-CN')}</p></div><ChevronRight className="text-stone-400" /></Link></li>)}</ul>}</section>
  </main>
}
