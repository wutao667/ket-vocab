import { useState } from 'react'
import { parseRange } from '../selection/range'

/**
 * 序号范围输入。
 * 完全受控：文本由父组件持有，这样滑动选择结束后可以直接回填，
 * 不需要在 effect 里 setState。
 */
export default function RangeInput({ total, value, onChange, onApply }: {
  total: number
  value: string
  onChange: (next: string) => void
  onApply: (start: number, end: number) => void
}) {
  const [error, setError] = useState('')
  const submit = () => {
    try {
      const [start, end] = parseRange(value, total)
      onApply(start, end)
      setError('')
    } catch (problem) {
      setError((problem as Error).message)
    }
  }
  return <section className="border-b border-stone-200 bg-paper px-4 py-2">
    <div className="mx-auto flex max-w-3xl flex-wrap items-start gap-2">
      <label className="min-w-36 flex-1">
        <span className="sr-only">序号范围</span>
        <input
          value={value}
          onChange={(event) => { onChange(event.target.value); setError('') }}
          onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
          placeholder={`序号范围，如 1-${Math.min(20, total)}`}
          inputMode="numeric"
          className="min-h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm"
          aria-invalid={Boolean(error)}
        />
      </label>
      <button onClick={submit} className="min-h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">连续选中</button>
      {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
    </div>
  </section>
}
