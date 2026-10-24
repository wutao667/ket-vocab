import { useEffect } from 'react'

export interface ToastMessage { id: number; text: string; duration?: number; actionLabel?: string; onAction?: () => void }

export default function Toast({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(onClose, toast.duration ?? 3000)
    return () => window.clearTimeout(timer)
  }, [onClose, toast])
  if (!toast) return null
  return <div role="status" className="fixed bottom-24 left-1/2 z-50 flex min-h-12 -translate-x-1/2 items-center gap-4 whitespace-nowrap rounded-xl bg-ink px-4 py-2 text-sm text-white shadow-xl">
    <span>{toast.text}</span>
    {toast.onAction && <button className="min-h-11 font-bold text-amber-300" onClick={() => { toast.onAction?.(); onClose() }}>{toast.actionLabel ?? '撤销'}</button>}
  </div>
}
