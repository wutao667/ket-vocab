import { Square, Volume2 } from 'lucide-react'
import { useSpeech } from '../tts/SpeechProvider'
import type { TTSEngine } from '../tts/tts'

export function SpeechSettings({ compact = false }: { compact?: boolean }) {
  const speech = useSpeech()
  if (compact) {
    // 背诵页空间紧张：压成一行，只保留必要控件；
    // 「实际引擎」只在真的发生回退时才显示，避免常驻噪音。
    const fellBack = speech.actualEngine && speech.actualEngine !== speech.engine
    return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-none text-stone-500">
      <select aria-label="语音引擎" value={speech.engine} onChange={(event) => speech.setEngine(event.target.value as TTSEngine)} className="rounded-md border border-stone-300 bg-white px-1 py-1 text-[11px] text-stone-600"><option value="edge">Edge</option><option value="tencent">腾讯</option><option value="minimax">MiniMax</option><option value="glm">GLM</option><option value="local">本地</option></select>
      <select aria-label="语速" value={speech.speed} onChange={(event) => speech.setSpeed(Number(event.target.value))} className="rounded-md border border-stone-300 bg-white px-1 py-1 text-[11px] text-stone-600">{[0.5, 0.65, 0.75, 0.85, 1, 1.1, 1.2].map((value) => <option key={value} value={value}>{value}×</option>)}</select>
      {fellBack && <span role="status" className="text-amber-700">已回退到 {speech.actualEngine}</span>}
      {speech.message && <span role="status" className="text-amber-700">{speech.message}</span>}
    </div>
  }
  return <div className="rounded-xl bg-stone-100 p-3"><div className="flex flex-wrap items-center gap-3 text-sm"><label>引擎 <select value={speech.engine} onChange={(event) => speech.setEngine(event.target.value as TTSEngine)} className="ml-1 rounded-lg border bg-white p-2"><option value="edge">Edge</option><option value="tencent">腾讯</option><option value="minimax">MiniMax</option><option value="glm">GLM</option><option value="local">本地语音</option></select></label><label>语速 <select value={speech.speed} onChange={(event) => speech.setSpeed(Number(event.target.value))} className="ml-1 rounded-lg border bg-white p-2">{[0.5, 0.65, 0.75, 0.85, 1, 1.1, 1.2].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label><span className="text-stone-500">实际：{speech.actualEngine || '等待播放'}</span></div>{speech.message && <p role="status" className="mt-2 text-sm text-amber-800">{speech.message}</p>}</div>
}
export function SpeakButton({ id, text, label, disabled, reason }: { id: string; text: string; label: string; disabled?: boolean; reason?: string }) {
  const speech = useSpeech(); const active = speech.activeKey === id
  return <button type="button" disabled={disabled} aria-label={disabled ? reason : `${active ? '停止' : '朗读'}${label}`} onClick={() => speech.play(id, text)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-stone-300 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45">{active ? <Square size={16} /> : <Volume2 size={17} />}{active ? '停止' : label}</button>
}
