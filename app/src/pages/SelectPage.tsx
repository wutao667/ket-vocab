import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft, Database, MousePointer2, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import RangeInput from '../components/RangeInput'
import Toast, { type ToastMessage } from '../components/Toast'
import VocabRow from '../components/VocabRow'
import type { VocabEntry } from '../data/types'
import vocabJson from '../data/vocab.json'
import { repository } from '../db/repository'
import { indexForAnchor, useScrollMemory } from '../hooks/useScrollMemory'
import { useSelection } from '../hooks/useSelection'
import { beginGesture, visitGesture, type SelectionGesture } from '../selection/gesture'
import { buildGridItems, type GridItem } from '../selection/grid'

const vocabulary = vocabJson as VocabEntry[]
const gridItems = buildGridItems(vocabulary)
const wordIndexById = new Map(vocabulary.map((entry, index) => [entry.id, index]))
const itemIndexByWordIndex = gridItems.reduce<number[]>((lookup, item, itemIndex) => {
  if (item.type === 'row') item.words.forEach((_, offset) => { lookup[item.startIndex + offset] = itemIndex })
  return lookup
}, [])
const ROW_HEIGHT = 34
const DIVIDER_HEIGHT = 18
const MAJOR_DIVIDER_HEIGHT = 22

function itemHeight(item: GridItem) {
  return item.type === 'row' ? ROW_HEIGHT : item.major ? MAJOR_DIVIDER_HEIGHT : DIVIDER_HEIGHT
}

function localDate() {
  const date = new Date(); const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export default function SelectPage() {
  const navigate = useNavigate()
  const [storageError, setStorageError] = useState('')
  const reportError = useCallback((message: string) => setStorageError(message), [])
  const { selected, selectedRef, ready, apply, restore, clear } = useSelection(reportError)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: gridItems.length, getScrollElement: () => scrollRef.current, estimateSize: (index) => itemHeight(gridItems[index]), overscan: 10 })
  const { loadAnchor, saveAnchor } = useScrollMemory('all-words')
  const gestureRef = useRef<SelectionGesture | null>(null)
  const pendingRef = useRef<{ index: number; x: number; y: number; pointerId: number } | null>(null)
  // 拖动结束后浏览器会补发一次 click；用一个短时效窗口吞掉它。
  // 不能用永久布尔量：浏览器有时不补发 click，标记会残留并吞掉后续正常单击。
  const suppressClickUntilRef = useRef(0)
  const pointerXRef = useRef(0)
  const previousPointRef = useRef<{ x: number; y: number } | null>(null)
  const animationRef = useRef(0)
  const lastFrameRef = useRef(0)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [listName, setListName] = useState('')
  const [creating, setCreating] = useState(false)
  // 范围框默认显示「全部已选词」的最小/最大序号；
  // 用户手动输入后先显示手输内容，但一旦选择变化（派生值改变），
  // 手输内容自动失效、回到自动区间。用「记录手输时对应的派生值」实现，
  // 不需要 effect，也不会触发 set-state-in-effect。
  const [manualRange, setManualRange] = useState<{ text: string; forDerived: string } | null>(null)
  const derivedRange = useMemo(() => {
    if (!selected.size) return ''
    let min = Infinity
    let max = -Infinity
    for (const id of selected) {
      const index = wordIndexById.get(id)
      if (index === undefined) continue
      if (index < min) min = index
      if (index > max) max = index
    }
    if (min === Infinity) return ''
    const from = min + 1
    const to = max + 1
    return from === to ? String(from) : `${from}-${to}`
  }, [selected])
  const rangeText = manualRange && manualRange.forDerived === derivedRange ? manualRange.text : derivedRange
  const updateRangeText = (next: string) => setManualRange({ text: next, forDerived: derivedRange })
  // 已经在别的背诵列表里的词：给个淡底色，避免重复挑选。
  const [inListIds, setInListIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    repository.getLists()
      .then((lists) => setInListIds(new Set(lists.flatMap((list) => list.vocabIds))))
      .catch(() => { /* 读不到就不做标记，不打扰用户 */ })
  }, [])

  const showUndo = useCallback((text: string, snapshot: Set<string>, duration = 3000) => {
    setToast({ id: Date.now(), text: `${text}｜`, duration, actionLabel: '撤销', onAction: () => restore(snapshot) })
  }, [restore])

  useEffect(() => {
    const anchorIndex = indexForAnchor(vocabulary.map((entry) => entry.id), loadAnchor())
    const itemIndex = itemIndexByWordIndex[anchorIndex] ?? 0
    requestAnimationFrame(() => virtualizer.scrollToIndex(itemIndex, { align: 'start' }))
  }, [loadAnchor, virtualizer])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    let timer = 0
    const remember = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const firstRow = virtualizer.getVirtualItems().find((virtualItem) => virtualItem.end >= element.scrollTop && gridItems[virtualItem.index].type === 'row')
        if (!firstRow) return
        const item = gridItems[firstRow.index]
        if (item.type === 'row') saveAnchor(item.words[0].id)
      }, 500)
    }
    element.addEventListener('scroll', remember, { passive: true })
    return () => { element.removeEventListener('scroll', remember); window.clearTimeout(timer) }
  }, [saveAnchor, virtualizer])

  const applyIndex = useCallback((index: number) => {
    const gesture = gestureRef.current
    const entry = vocabulary[index]
    if (!gesture || !entry) return
    const target = visitGesture(gesture, index, entry.id)
    if (target !== null) apply([entry.id], target)
  }, [apply])

  const applyAtPoint = useCallback((clientX: number, clientY: number) => {
    const rect = scrollRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.min(rect.right - 1, Math.max(rect.left + 1, clientX))
    const y = Math.min(rect.bottom - 1, Math.max(rect.top + 1, clientY))
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-word-index]')
    if (cell) applyIndex(Number(cell.dataset.wordIndex))
  }, [applyIndex])

  const applyAlongPath = useCallback((clientX: number, clientY: number) => {
    const previous = previousPointRef.current
    if (!previous) { applyAtPoint(clientX, clientY); previousPointRef.current = { x: clientX, y: clientY }; return }
    const distance = Math.hypot(clientX - previous.x, clientY - previous.y)
    const steps = Math.max(1, Math.ceil(distance / 12))
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      applyAtPoint(previous.x + (clientX - previous.x) * ratio, previous.y + (clientY - previous.y) * ratio)
    }
    previousPointRef.current = { x: clientX, y: clientY }
  }, [applyAtPoint])

  const autoScroll = useCallback((time: number) => {
    const gesture = gestureRef.current
    const element = scrollRef.current
    if (!gesture || !element) return
    const rect = element.getBoundingClientRect(); const edge = 48
    const topDepth = Math.max(0, Math.min(1, (rect.top + edge - gesture.clientY) / edge))
    const bottomDepth = Math.max(0, Math.min(1, (gesture.clientY - rect.bottom + edge) / edge))
    const velocity = (bottomDepth - topDepth) * 600
    const elapsed = Math.min(40, time - (lastFrameRef.current || time)) / 1000
    lastFrameRef.current = time
    if (velocity) {
      element.scrollTop += velocity * elapsed
      applyAtPoint(pointerXRef.current, gesture.clientY)
    }
    animationRef.current = requestAnimationFrame(autoScroll)
  }, [applyAtPoint])

  const finishGesture = useCallback(() => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    previousPointRef.current = null
    cancelAnimationFrame(animationRef.current)
    if (gesture.changed) {
      showUndo(`${gesture.target ? '已选择' : '已取消'} ${gesture.changed} 个`, gesture.snapshot)
      // 范围框由全部已选词派生（见 derivedRange），这里无需手动回填
    }
  }, [showUndo])

  // 方向判定：横向拖动 = 批量选择，纵向拖动 = 页面滚动。
  // 这样批量选择可以常开，同时不会抢走滚动。
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const pending = pendingRef.current
      const gesture = gestureRef.current

      if (!gesture && pending && event.pointerId === pending.pointerId) {
        const dx = Math.abs(event.clientX - pending.x)
        const dy = Math.abs(event.clientY - pending.y)
        if (dx < 8 && dy < 8) return
        if (dy >= dx) { pendingRef.current = null; return }   // 纵向：交给浏览器滚动
        const entry = vocabulary[pending.index]
        if (!entry) { pendingRef.current = null; return }
        pendingRef.current = null
        suppressClickUntilRef.current = Date.now() + 300
        gestureRef.current = beginGesture(new Set(selectedRef.current), entry.id, event.pointerId, event.clientY)
        pointerXRef.current = event.clientX
        previousPointRef.current = { x: event.clientX, y: event.clientY }
        applyIndex(pending.index)
        lastFrameRef.current = performance.now()
        animationRef.current = requestAnimationFrame(autoScroll)
        return
      }

      if (!gesture || event.pointerId !== gesture.pointerId) return
      event.preventDefault()
      pointerXRef.current = event.clientX
      gesture.clientY = event.clientY
      applyAlongPath(event.clientX, event.clientY)
    }
    const end = (event: PointerEvent) => {
      if (pendingRef.current?.pointerId === event.pointerId) pendingRef.current = null
      if (gestureRef.current?.pointerId === event.pointerId) finishGesture()
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      cancelAnimationFrame(animationRef.current)
    }
  }, [applyAlongPath, applyIndex, autoScroll, finishGesture, selectedRef])

  const startGesture = (event: ReactPointerEvent, index: number) => {
    pendingRef.current = { index, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  const toggleOne = (index: number) => {
    // 拖动结束后浏览器仍会补发一次 click，这里把它吞掉，避免抵消刚才的批量选择
    if (Date.now() < suppressClickUntilRef.current) { suppressClickUntilRef.current = 0; return }
    const entry = vocabulary[index]
    apply([entry.id], !selectedRef.current.has(entry.id))
  }

  const applyRange = (start: number, end: number, value: boolean) => {
    const snapshot = new Set(selectedRef.current)
    const ids = vocabulary.slice(start, end + 1).map((entry) => entry.id)
    apply(ids, value)
    showUndo(`${value ? '已选择' : '已取消'} ${ids.length} 个`, snapshot)
  }

  const clearAll = () => {
    const snapshot = new Set(selectedRef.current)
    if (!snapshot.size) return
    clear()
    setManualRange(null)
    showUndo(`已清除 ${snapshot.size} 个`, snapshot)
  }

  const openCreate = () => { setListName(`${localDate()} KET 词表`); setShowCreate(true) }
  const createList = async () => {
    if (!listName.trim() || creating) return
    setCreating(true)
    const previousSelection = [...selectedRef.current]
    try {
      const list = await repository.createList(listName, previousSelection)
      clear()
      await repository.clearSelection()
      navigate(`/lists/${list.id}`, { state: { justCreated: true, previousSelection } })
    } catch (error) { reportError((error as Error).message); setCreating(false) }
  }

  return <div className="flex h-[100dvh] flex-col bg-paper">
    <header className="flex items-center gap-2 bg-paper px-3 py-2"><Link to="/" aria-label="返回列表" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-stone-200"><ArrowLeft /></Link><div className="min-w-0 flex-1"><h1 className="truncate text-lg font-bold">KET 词表</h1><p className="text-xs text-stone-500">A–Z · 共 {vocabulary.length} 词</p></div>{selected.size > 0 && <button type="button" onClick={clearAll} aria-label={`清除已选的 ${selected.size} 个词`} className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"><Trash2 size={14} />清除</button>}<span className="rounded-full bg-emerald-100 px-2.5 py-1.5 text-sm font-bold text-brand">已选 {selected.size}</span></header>
    {storageError && <div role="alert" className="flex items-start gap-2 bg-red-50 px-4 py-3 text-sm text-red-800"><Database className="mt-0.5 shrink-0" size={18} /><span>{storageError} 当前页面仍可临时使用，但刷新后可能丢失。</span><button aria-label="关闭提示" onClick={() => setStorageError('')}><X size={18} /></button></div>}
    <RangeInput total={vocabulary.length} value={rangeText} onChange={updateRangeText} onApply={applyRange} />
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stone-200 bg-stone-100 px-3 py-1 text-[11px] text-stone-500"><span className="flex items-center gap-1"><MousePointer2 size={13} />左右拖动批量选 · 上下滑动滚动 · 点击切换</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />本次已选</span><span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-amber-50 ring-1 ring-inset ring-amber-200" />已在列表</span></div>
    <div ref={scrollRef} data-vocab-scroll className="min-h-0 flex-1 overflow-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
      <div className="relative mx-auto w-full max-w-5xl" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = gridItems[virtualItem.index]
          return <div key={item.key} data-grid-item={item.type} className="absolute left-0 top-0 w-full" style={{ height: virtualItem.size, transform: `translateY(${virtualItem.start}px)` }}>
            {item.type === 'row'
              ? <VocabRow entries={item.words} startIndex={item.startIndex} selected={selected} inList={inListIds} onPointerDown={startGesture} onToggle={toggleOne} />
              : <div data-divider-after={item.after} data-divider-major={item.major ? 'true' : 'false'} className="flex h-full items-center gap-2 px-2" aria-label={`${item.from} 至 ${item.to}`}><span className={`h-px flex-1 ${item.major ? 'bg-stone-400' : 'bg-stone-300'}`} /><span className={`${item.major ? 'text-[11px] font-bold text-stone-500' : 'text-[9px] text-stone-400'}`}>{item.from}–{item.to}</span><span className={`h-px flex-1 ${item.major ? 'bg-stone-400' : 'bg-stone-300'}`} /></div>}
          </div>
        })}
      </div>
    </div>
    <footer className="safe-bottom z-20 flex items-center gap-4 border-t border-stone-200 bg-white px-4 pt-3 shadow-[0_-6px_20px_rgba(0,0,0,.06)]"><strong className="flex-1 text-lg">已选 {selected.size} 词</strong><button disabled={!selected.size || !ready} onClick={openCreate} className="min-h-12 rounded-xl bg-brand px-5 font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300">创建背诵列表</button></footer>
    {showCreate && <div className="fixed inset-0 z-40 grid place-items-end bg-black/40 sm:place-items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false) }}><section role="dialog" aria-modal="true" aria-labelledby="create-title" className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"><h2 id="create-title" className="text-xl font-bold">创建背诵列表</h2><p className="mt-1 text-sm text-stone-500">将保存当前选择的 {selected.size} 个词。</p><label className="mt-5 block"><span className="mb-1 block text-sm font-semibold">列表名称</span><input autoFocus value={listName} maxLength={80} onChange={(event) => setListName(event.target.value)} className="min-h-12 w-full rounded-lg border border-stone-300 px-3" /></label><div className="mt-5 flex gap-3"><button onClick={() => setShowCreate(false)} className="min-h-12 flex-1 rounded-lg border border-stone-300 font-semibold">取消</button><button disabled={!listName.trim() || creating} onClick={createList} className="min-h-12 flex-1 rounded-lg bg-brand font-bold text-white disabled:bg-stone-300">{creating ? '创建中…' : '确认创建'}</button></div></section></div>}
    <Toast toast={toast} onClose={() => setToast(null)} />
  </div>
}
