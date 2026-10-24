import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { repository } from './repository'

describe('IndexedDB repository', () => {
  it('persists selection and ordered, deduplicated lists across reads', async () => {
    await repository.saveSelection(['ket-0002', 'ket-0001'])
    expect(await repository.loadSelection()).toEqual(['ket-0002', 'ket-0001'])
    const list = await repository.createList('Test list', ['ket-0002', 'ket-0001', 'ket-0002'])
    expect((await repository.getList(list.id))?.vocabIds).toEqual(['ket-0002', 'ket-0001'])
    await repository.renameList(list.id, 'Renamed')
    expect((await repository.getList(list.id))?.name).toBe('Renamed')
    await repository.removeVocab(list.id, 'ket-0002')
    expect((await repository.getList(list.id))?.vocabIds).toEqual(['ket-0001'])
    await repository.setFavorite('ket-0001', true, undefined, list.id)
    expect(await repository.getFavoriteIds()).toEqual(['ket-0001'])
    expect((await repository.getFavoriteRecords())[0].sourceListId).toBe(list.id)
    await repository.setFavorite('ket-0001', true, undefined, 'must-not-overwrite-first-source')
    expect((await repository.getFavoriteRecords())[0].sourceListId).toBe(list.id)
    await repository.setFavorite('ket-0001', false)
    expect(await repository.getFavoriteIds()).toEqual([])
    await repository.deleteList(list.id); await repository.clearSelection()
    expect(await repository.getList(list.id)).toBeUndefined(); expect(await repository.loadSelection()).toEqual([])
  })
})
