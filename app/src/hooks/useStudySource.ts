import { useCallback, useEffect, useState } from 'react'
import { entriesFor, topicOrder } from '../data/vocabulary'
import type { VocabEntry } from '../data/types'
import { repository } from '../db/repository'
import { useDataRefresh } from './useDataRefresh'

export interface StudySource { title: string; entries: VocabEntry[]; backTo: string; listId?: string }

export function useStudySource(listId?: string, favorites = false, favoriteOnly = false) {
  const [source, setSource] = useState<StudySource | null | undefined>(undefined); const [error, setError] = useState('')
  const dataVersion = useDataRefresh()
  const load = useCallback(async () => {
    try {
      if (favorites) {
        const records = await repository.getFavoriteRecords()
        const ids = [...records].sort((a, b) => b.createdAt - a.createdAt).map((item) => item.vocabId)
        setSource({ title: '生词本', entries: entriesFor(ids), backTo: '/favorites' }); return
      }
      const list = await repository.getList(listId ?? '')
      if (!list) { setSource(null); return }
      let ids = list.vocabIds
      if (favoriteOnly) { const favoriteIds = new Set(await repository.getFavoriteIds()); ids = ids.filter((id) => favoriteIds.has(id)) }
      setSource({ title: favoriteOnly ? `${list.name} · 生词` : list.name, entries: entriesFor(ids), backTo: `/lists/${list.id}`, listId: list.id })
    } catch (problem) { setError((problem as Error).message) }
  }, [favoriteOnly, favorites, listId])
  // Repository reads are the external subscription for this route.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load, dataVersion])
  return { source, error, reload: load, sortByTopic: () => setSource((current) => current ? { ...current, entries: [...current.entries].sort((a, b) => (topicOrder.get(a.id) ?? Infinity) - (topicOrder.get(b.id) ?? Infinity)) } : current) }
}
