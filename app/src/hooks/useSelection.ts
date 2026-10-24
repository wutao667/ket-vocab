import { useCallback, useEffect, useRef, useState } from 'react'
import { repository } from '../db/repository'

export function useSelection(onError: (message: string) => void) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)
  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    repository.loadSelection().then((ids) => setSelected(new Set(ids))).catch((error: Error) => onError(error.message)).finally(() => setReady(true))
  }, [onError])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => repository.saveSelection([...selected]).catch((error: Error) => onError(error.message)), 180)
    return () => window.clearTimeout(timer)
  }, [onError, ready, selected])

  const apply = useCallback((ids: Iterable<string>, value: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      for (const id of ids) {
        if (value) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])

  const restore = useCallback((snapshot: Set<string>) => setSelected(new Set(snapshot)), [])
  const clear = useCallback(() => setSelected(new Set()), [])
  return { selected, selectedRef, ready, apply, restore, clear }
}
