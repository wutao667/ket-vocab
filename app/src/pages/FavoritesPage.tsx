import { ArrowLeft, BookOpen, Brain, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { hasTopics, topicOrder, vocabById } from '../data/vocabulary'
import type { FavoriteRecord, StudyList } from '../db/schema'
import { repository } from '../db/repository'
import { ZhMeaning } from '../components/ZhMeaning'
import { useDataRefresh } from '../hooks/useDataRefresh'

export default function FavoritesPage() {
  const [records, setRecords] = useState<FavoriteRecord[]>([]); const [lists, setLists] = useState<StudyList[]>([]); const [order, setOrder] = useState<'recent' | 'topic'>('recent'); const [error, setError] = useState('')
  const dataVersion = useDataRefresh()
  const load = useCallback(() => Promise.all([repository.getFavoriteRecords(), repository.getLists()]).then(([favorites, value]) => { setRecords(favorites); setLists(value) }).catch((problem: Error) => setError(problem.message)), [])
  useEffect(() => { void load() }, [load, dataVersion])
  const listNames = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists])
  const sorted = useMemo(() => [...records].sort(order === 'recent' ? (a, b) => b.createdAt - a.createdAt : (a, b) => (topicOrder.get(a.vocabId) ?? Infinity) - (topicOrder.get(b.vocabId) ?? Infinity)), [order, records])
  const remove = async (id: string) => { try { await repository.setFavorite(id, false); setRecords((current) => current.filter((item) => item.vocabId !== id)) } catch (problem) { setError((problem as Error).message) } }
  return <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-5"><header className="flex items-center gap-3"><Link to="/" aria-label="返回首页" className="flex h-11 w-11 items-center justify-center rounded-full"><ArrowLeft /></Link><div><p className="text-sm font-bold text-amber-600">全局收藏</p><h1 className="text-3xl font-black">生词本 <span className="text-xl text-stone-400">{records.length}</span></h1></div></header>{error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    <div className="mt-6 grid grid-cols-2 gap-3"><Link to="/favorites/learn" className="flex min-h-14 items-center justify-center gap-2 rounded-xl border bg-white font-bold"><BookOpen />学习模式</Link><Link to="/favorites/recall" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand font-bold text-white"><Brain />背诵模式</Link></div>
    <div className="mt-6 flex items-center justify-between"><h2 className="font-bold">收藏词条</h2><label className="text-sm">排序 <select value={order} onChange={(event) => setOrder(event.target.value as 'recent' | 'topic')} className="ml-1 rounded-lg border bg-white p-2"><option value="recent">最近标记优先</option>{hasTopics && <option value="topic">主题顺序</option>}</select></label></div>
    {sorted.length === 0 ? <div className="mt-4 rounded-2xl border-2 border-dashed p-10 text-center text-stone-500">还没有生词。背诵时点亮星标，它会出现在这里。</div> : <ul className="mt-3 space-y-2">{sorted.map((record) => { const entry = vocabById.get(record.vocabId); if (!entry) return null; return <li key={record.vocabId} className="flex items-center gap-3 rounded-xl border bg-white p-4"><div className="min-w-0 flex-1"><strong>{entry.word}</strong><p className="truncate text-sm text-stone-500"><ZhMeaning zh={entry.zh} /></p><p className="mt-1 text-xs text-stone-400">首次来源：{record.sourceListId ? (listNames.get(record.sourceListId) ?? '来源列表已删除') : '来源列表已删除'}</p></div><button onClick={() => void remove(entry.id)} aria-label="取消生词标记" className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-600"><Star fill="currentColor" /></button></li> })}</ul>}
  </main>
}
