import type { PointerEvent as ReactPointerEvent } from 'react'
import type { VocabEntry } from '../data/types'

interface Props {
  entries: VocabEntry[]
  startIndex: number
  selected: Set<string>
  inList: Set<string>
  onPointerDown: (event: ReactPointerEvent, index: number) => void
  onToggle: (index: number) => void
}

export default function VocabRow({ entries, startIndex, selected, inList, onPointerDown, onToggle }: Props) {
  return <div data-vocab-row={startIndex / 10} className="grid h-[34px] select-none gap-0.5 px-0.5" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>
    {entries.map((entry, offset) => {
      const index = startIndex + offset
      const active = selected.has(entry.id)
      const taken = inList.has(entry.id)
      // 三种状态：本次已选（绿）、已在其他列表（淡黄）、普通（白）
      const skin = active
        ? 'bg-emerald-200 font-bold text-emerald-950'
        : taken
          ? 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200'
          : 'bg-white text-slate-700 hover:bg-stone-100'
      return <button
        key={entry.id}
        type="button"
        title={entry.word.length > 8 ? entry.word : undefined}
        aria-label={`${active ? '取消选择' : '选择'} ${entry.word}${taken && !active ? '（已在其他列表）' : ''}`}
        aria-pressed={active}
        data-in-list={taken ? 'true' : undefined}
        data-word-index={index}
        data-word-id={entry.id}
        onPointerDown={(event) => onPointerDown(event, index)}
        onClick={() => onToggle(index)}
        className={`min-h-8 min-w-0 overflow-hidden whitespace-nowrap rounded-sm px-0.5 text-center leading-8 text-ellipsis ${entry.word.length > 8 ? 'text-[8px]' : 'text-[10px]'} ${skin}`}
      >{entry.word}</button>
    })}
  </div>
}
