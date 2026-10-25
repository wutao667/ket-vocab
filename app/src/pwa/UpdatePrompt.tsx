import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { applySwUpdate, subscribeSwStatus, type SwStatus } from './register'

/**
 * 新版本就绪提示。
 *
 * 刻意做成非阻塞：不自动刷新（避免打断正在背诵的一轮），
 * 由用户决定何时更新。关闭后本会话不再提示。
 */
export default function UpdatePrompt() {
  const [status, setStatus] = useState<SwStatus>({ registered: false, updateReady: false, offlineReady: false })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => { const unsubscribe = subscribeSwStatus(setStatus); return () => { unsubscribe() } }, [])

  if (!status.updateReady || dismissed) return null

  return <div
    role="status"
    className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-2xl"
  >
    <RefreshCw size={16} className="shrink-0" />
    <span className="flex-1">有新版本可用，更新后体验更好。</span>
    <button
      type="button"
      onClick={() => void applySwUpdate()}
      className="shrink-0 rounded-lg bg-white px-3 py-1.5 font-bold text-ink"
    >更新</button>
    <button
      type="button"
      aria-label="稍后再说"
      onClick={() => setDismissed(true)}
      className="shrink-0 text-stone-400"
    ><X size={16} /></button>
  </div>
}
