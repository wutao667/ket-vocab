import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { RecallCard, type RecallDirection } from '../components/RecallCard'
import { SpeechSettings } from '../components/SpeechControls'
import { repository } from '../db/repository'
import { useStudySource } from '../hooks/useStudySource'
import { shuffleForRecall } from '../recall/shuffle'
import { storageKey } from '../config/app-config'

export default function RecallPage({ favorites = false }: { favorites?: boolean }) {
  const { listId } = useParams(); const location = useLocation(); const navigate = useNavigate(); const favoriteOnly = new URLSearchParams(location.search).get('favorites') === '1'
  const { source, error, reload } = useStudySource(listId, favorites, favoriteOnly)
  const [started, setStarted] = useState(false); const [completed, setCompleted] = useState(false); const [index, setIndex] = useState(0); const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [direction, setDirectionState] = useState<RecallDirection>(() => (localStorage.getItem(storageKey('recall-direction')) as RecallDirection) || 'en-zh')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set()); const [snapshot, setSnapshot] = useState(source?.entries ?? [])
  const previousOrder = useRef<string[]>([])
  useEffect(() => { void repository.getFavoriteIds().then((ids) => setFavoriteIds(new Set(ids))) }, [])
  const begin = useCallback(() => {
    if (!source) return
    const shuffled = shuffleForRecall(source.entries, previousOrder.current)
    previousOrder.current = shuffled.map((entry) => entry.id)
    setSnapshot(shuffled)
    setIndex(0)
    setRevealed(new Set())
    setCompleted(false)
    setStarted(true)
  }, [source])
  const setDirection = (value: RecallDirection) => { setDirectionState(value); localStorage.setItem(storageKey('recall-direction'), value) }
  const next = useCallback(() => { if (index >= snapshot.length - 1) setCompleted(true); else setIndex((value) => value + 1) }, [index, snapshot.length])
  // 只负责揭晓答案，不再兼做「下一个」——答案本来就能点遮挡区查看
  const reveal = useCallback(() => { setRevealed((current) => current.has(index) ? current : new Set(current).add(index)) }, [index])
  useEffect(() => {
    if (!started || completed) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate(source?.backTo ?? '/')
      else if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); reveal() }
      else if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1))
      else if (event.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [completed, navigate, next, reveal, source?.backTo, started])
  const toggleFavorite = async () => {
    const entry = snapshot[index]; if (!entry) return
    const value = !favoriteIds.has(entry.id); setFavoriteIds((current) => { const updated = new Set(current); if (value) updated.add(entry.id); else updated.delete(entry.id); return updated })
    try { await repository.setFavorite(entry.id, value, undefined, source?.listId) } catch { setFavoriteIds((current) => { const updated = new Set(current); if (!value) updated.add(entry.id); else updated.delete(entry.id); return updated }) }
  }
  const markedCount = useMemo(() => snapshot.filter((entry) => favoriteIds.has(entry.id)).length, [favoriteIds, snapshot])
  if (source === undefined) return <main className="p-8 text-center text-stone-500">正在准备背诵…</main>
  if (!source) return <main className="p-8 text-center"><p>{error || '列表不存在'}</p><Link to="/" className="text-brand underline">返回首页</Link></main>
  if (!started) return <main className="mx-auto min-h-[100dvh] max-w-xl px-5 py-8"><Link to={source.backTo} className="inline-flex items-center gap-1 text-stone-600"><ArrowLeft size={18} />返回</Link><h1 className="mt-8 text-3xl font-black">开始背诵</h1><p className="mt-2 text-stone-500">{source.title} · {source.entries.length} 个词</p>{source.entries.length === 0 ? <div className="mt-8 rounded-2xl border-2 border-dashed p-8 text-center"><p>{favoriteOnly || favorites ? '当前范围没有生词。先在背诵中点亮星标吧。' : '当前列表没有词条。'}</p><Link to={source.backTo} className="mt-4 inline-block text-brand underline">返回</Link></div> : <><fieldset className="mt-8 space-y-3"><legend className="mb-3 font-bold">选择方向</legend><label className="flex min-h-14 items-center gap-3 rounded-xl border bg-white px-4"><input type="radio" checked={direction === 'en-zh'} onChange={() => setDirection('en-zh')} />看英文猜中文</label><label className="flex min-h-14 items-center gap-3 rounded-xl border bg-white px-4"><input type="radio" checked={direction === 'zh-en'} onChange={() => setDirection('zh-en')} />看中文猜英文</label></fieldset><button onClick={begin} className="mt-6 min-h-14 w-full rounded-xl bg-brand text-lg font-bold text-white">开始本轮</button></>}</main>
  if (completed) return <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center px-5 text-center"><p className="text-5xl">🎉</p><h1 className="mt-4 text-3xl font-black">本轮完成</h1><p className="mt-4 text-lg">共背诵 <strong>{snapshot.length}</strong> 个词，本轮生词 <strong>{markedCount}</strong> 个</p><button onClick={() => { void reload().then(() => { setStarted(false); setCompleted(false) }) }} className="mt-8 min-h-12 rounded-xl bg-brand font-bold text-white">再来一轮</button>{!favorites && <Link to={`/lists/${listId}/recall?favorites=1`} onClick={() => { setStarted(false); setCompleted(false) }} className="mt-3 flex min-h-12 items-center justify-center rounded-xl border font-bold">只背本列表生词</Link>}<Link to={source.backTo} className="mt-3 flex min-h-12 items-center justify-center text-brand underline">返回列表</Link></main>
  const entry = snapshot[index]; const isRevealed = revealed.has(index); const progress = snapshot.length <= 1 ? 100 : ((index + 1) / snapshot.length) * 100
  return <main className="mx-auto min-h-[100dvh] max-w-xl px-3 pb-24 pt-1.5"><header><div className="flex items-center gap-2"><Link to={source.backTo} aria-label="退出背诵" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"><ArrowLeft size={18} /></Link><strong className="shrink-0 text-xs tabular-nums text-stone-500">{index + 1}/{snapshot.length}</strong><div className="min-w-0 flex-1"><SpeechSettings compact /></div></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-stone-200"><div role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} /></div></header><div className="mt-2"><RecallCard entry={entry} direction={direction} revealed={isRevealed} favorite={favoriteIds.has(entry.id)} onFavorite={() => void toggleFavorite()} onReveal={reveal} /></div><footer className="safe-bottom fixed inset-x-0 bottom-0 border-t bg-[#f7f4ed]/95 p-3 backdrop-blur"><div className="mx-auto grid max-w-xl grid-cols-2 gap-3"><button onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0} className="flex min-h-14 items-center justify-center gap-1 rounded-xl border bg-white font-bold disabled:opacity-40"><ChevronLeft />上一个</button><button onClick={next} className="flex min-h-14 items-center justify-center gap-1 rounded-xl bg-brand font-bold text-white">下一个<ChevronRight /></button></div></footer></main>
}
