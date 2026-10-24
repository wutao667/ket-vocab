import { ArrowLeft, BookOpen, Brain, Check, Pencil, Star, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Toast, { type ToastMessage } from '../components/Toast'
import vocabJson from '../data/vocab.json'
import type { VocabEntry } from '../data/types'
import { repository } from '../db/repository'
import type { StudyList } from '../db/schema'

const vocabulary = vocabJson as VocabEntry[]
const vocabById = new Map(vocabulary.map((entry) => [entry.id, entry]))
interface CreatedState { justCreated?: boolean; previousSelection?: string[] }

export default function ListPage() {
  const { listId = '' } = useParams(); const navigate = useNavigate(); const location = useLocation(); const state = location.state as CreatedState | null
  const createdSelection = state?.justCreated ? state.previousSelection : undefined
  const [list, setList] = useState<StudyList | null | undefined>(undefined); const [error, setError] = useState(''); const [editing, setEditing] = useState(false); const [name, setName] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(() => createdSelection ? { id: 1, text: `已创建列表并清空 ${createdSelection.length} 个临时选择`, duration: 5000, actionLabel: '撤销', onAction: () => { Promise.all([repository.deleteList(listId), repository.saveSelection(createdSelection)]).then(() => navigate('/select', { replace: true })).catch((problem: Error) => setError(problem.message)) } } : null)
  const load = useCallback(() => repository.getList(listId).then((value) => { setList(value ?? null); if (value) setName(value.name) }).catch((problem: Error) => setError(problem.message)), [listId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!createdSelection) return
    navigate(location.pathname, { replace: true, state: null })
  }, [createdSelection, location.pathname, navigate])
  const entries = useMemo(() => list?.vocabIds.map((id) => vocabById.get(id)).filter((entry): entry is VocabEntry => Boolean(entry)) ?? [], [list])
  const rename = async () => { if (!list || !name.trim()) return; try { await repository.renameList(list.id, name); await load(); setEditing(false) } catch (problem) { setError((problem as Error).message) } }
  const remove = async (vocabId: string) => { if (!list) return; try { await repository.removeVocab(list.id, vocabId); await load() } catch (problem) { setError((problem as Error).message) } }
  const deleteList = async () => { if (!list || !window.confirm(`确定删除“${list.name}”吗？此操作无法撤销。`)) return; try { await repository.deleteList(list.id); navigate('/', { replace: true }) } catch (problem) { setError((problem as Error).message) } }
  if (list === undefined) return <main className="p-8 text-center text-stone-500">正在读取列表…</main>
  if (list === null) return <main className="p-8 text-center"><h1 className="text-2xl font-bold">列表不存在</h1><Link to="/" className="mt-5 inline-block text-brand underline">返回首页</Link></main>
  return <main className="mx-auto min-h-[100dvh] max-w-3xl px-4 py-5">
    <header className="flex items-start gap-2"><Link to="/" aria-label="返回首页" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-stone-200"><ArrowLeft /></Link><div className="min-w-0 flex-1">{editing ? <div className="flex gap-2"><input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-stone-300 px-3" /><button aria-label="保存名称" onClick={rename} className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-white"><Check /></button><button aria-label="取消编辑" onClick={() => { setName(list.name); setEditing(false) }} className="flex h-11 w-11 items-center justify-center rounded-lg border"><X /></button></div> : <div className="flex items-center gap-2"><h1 className="truncate text-2xl font-bold">{list.name}</h1><button aria-label="重命名" onClick={() => setEditing(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-stone-200"><Pencil size={18} /></button></div>}<p className="mt-1 text-sm text-stone-500">{entries.length} 个词 · 顺序已保存</p></div><button aria-label="删除列表" onClick={deleteList} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-red-700 hover:bg-red-50"><Trash2 size={20} /></button></header>
    {error && <p role="alert" className="my-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3"><Link to={`/lists/${list.id}/learn`} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border bg-white font-bold"><BookOpen />学习模式</Link><Link to={`/lists/${list.id}/recall`} className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-brand font-bold text-white"><Brain />背诵模式</Link><Link to={`/lists/${list.id}/recall?favorites=1`} className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white font-bold text-amber-700"><Star />只背本列表生词</Link></div>
    <ol className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white">{entries.map((entry, index) => <li key={entry.id} className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-stone-200 px-3 last:border-0"><span className="text-sm tabular-nums text-stone-400">{index + 1}</span><div className="min-w-0"><strong>{entry.word}</strong><p className="truncate text-sm text-stone-500">{entry.pos} · {entry.zh}</p></div><button onClick={() => remove(entry.id)} aria-label={`移除 ${entry.word}`} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50">移除</button></li>)}</ol>
    <Toast toast={toast} onClose={() => setToast(null)} />
  </main>
}
