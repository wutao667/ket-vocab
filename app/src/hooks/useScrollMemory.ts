import { useCallback } from 'react'
import { storageKey } from '../config/app-config'

const prefix = storageKey('scroll-anchor:')

export function indexForAnchor(ids: string[], anchor: string | null) {
  if (!anchor) return 0
  return Math.max(0, ids.indexOf(anchor))
}

export function indexForScrollTop(scrollTop: number, count: number, rowHeight: number) {
  return Math.min(count - 1, Math.max(0, Math.round(scrollTop / rowHeight)))
}

export function useScrollMemory(topicId: string) {
  const loadAnchor = useCallback(() => {
    try { return localStorage.getItem(`${prefix}${topicId}`) } catch { return null }
  }, [topicId])
  const saveAnchor = useCallback((vocabId: string) => {
    try { localStorage.setItem(`${prefix}${topicId}`, vocabId) } catch { /* UI preference is best-effort. */ }
  }, [topicId])
  return { loadAnchor, saveAnchor }
}
