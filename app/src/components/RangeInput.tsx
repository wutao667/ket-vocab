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
  onApply: (start: number, end: number, value: boolean) => void
}) {
  const [error, setError] = useState('')
  const submit = (target: boolean) => {
    try { const [start, end] = parseRange(value, total); onApply(start, end, target); setError('') }
    catch (problem) { setError((problem as Error).message) }
  }
  return <section className="border-b border-stone-200 bg-paper px-4 py-3">
    <div className="mx-auto flex max-w-3xl flex-wrap items-start gap-2">
      <label className="min-w-36 flex-1"><span className="sr-only">序号范围</span><input value={value} onChange={(event) => { onChange(event.target.value); setError('') }} placeholder={`序号范围，如 1-${Math.min(20, total)}`} inputMode="numeric" className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3" aria-invalid={Boolean(error)} /></label>
      <button onClick={() => submit(true)} className="min-h-11 rounded-lg bg-brand px-4 font-semibold text-white">加入选择</button>
      <button onClick={() => submit(false)} className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 font-semibold">从选择中移除</button>
      {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
    </div>
  </section>
}
