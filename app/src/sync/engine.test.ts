import 'fake-indexeddb/auto'
import { deleteDB, openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DB_NAME } from '../db/schema'
import { database, repository, resetDatabaseForTests } from '../db/repository'
import { applySyncResponse, requeueOrphaned, retryDelay, stableMigrationOpId } from './engine'

beforeEach(async () => {
  await resetDatabaseForTests()
  await deleteDB(DB_NAME)
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
})

describe('IndexedDB v3 and sync engine', () => {
  it('upgrades v2 without losing records and creates all v3 stores', async () => {
    const old = await openDB(DB_NAME, 2, { upgrade(db) {
      const lists = db.createObjectStore('lists', { keyPath: 'id' }); lists.createIndex('by-profile', 'profileId')
      db.createObjectStore('selections', { keyPath: 'key' })
      const favorites = db.createObjectStore('favorites', { keyPath: 'key' }); favorites.createIndex('by-profile', 'profileId')
    } })
    await old.put('lists', { id: 'old-list', profileId: 'default', name: '旧列表', vocabIds: ['ket-0001'], createdAt: 1, updatedAt: 1 })
    await old.put('favorites', { key: 'default:ket-0001', profileId: 'default', vocabId: 'ket-0001', createdAt: 1 }); old.close()
    const upgraded = await database()
    expect((await upgraded.get('lists', 'old-list'))?.name).toBe('旧列表')
    expect((await upgraded.get('favorites', 'default:ket-0001'))?.vocabId).toBe('ket-0001')
    expect([...upgraded.objectStoreNames]).toEqual(expect.arrayContaining(['lists', 'selections', 'favorites', 'pendingOps', 'syncMeta', 'listVocab']))
  })

  it('atomically projects local writes and enqueues protocol operations', async () => {
    const list = await repository.createList('离线列表', ['ket-0001'], 'usr_a'), db = await database(), ops = await db.getAll('pendingOps')
    expect((await repository.getLists('usr_a'))[0].id).toBe(list.id)
    expect(ops).toHaveLength(1); expect(ops[0]).toMatchObject({ profileId: 'usr_a', kind: 'list.create', entityId: list.id, attemptCount: 0 })
    expect(ops[0].createdAt).toBeTypeOf('number')
  })

  it('removes acknowledged operations, applies changes and advances cursor', async () => {
    const list = await repository.createList('本地名', ['ket-0001'], 'usr_a'), db = await database(), [op] = await db.getAll('pendingOps')
    await applySyncResponse('usr_a', { results: [{ opId: op.opId, status: 'applied', seq: 7 }], changes: [{ seq: 7, kind: 'list.create', entityId: list.id, payload: { name: '服务端名', vocabIds: ['ket-0001'] }, serverTime: 10 }], cursor: 7, hasMore: false })
    expect(await db.count('pendingOps')).toBe(0); expect((await db.get('lists', list.id))?.name).toBe('服务端名'); expect((await db.get('syncMeta', 'usr_a'))?.cursor).toBe(7)
  })

  it('uses the documented capped exponential retry sequence with jitter', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((attempt) => retryDelay(attempt, () => 0.5))).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 300_000])
    expect(retryDelay(0, () => 0)).toBe(800); expect(retryDelay(0, () => 1)).toBe(1_200)
  })

  // 回归：服务端拒绝操作后，前端会把该操作从队列删掉，但本地记录仍是 pending。
  // 若不补回，即使服务端修好，这些数据也永远不会再上传
  //（用户看到「有 14 项无法同步」，点立即同步毫无反应）。
  it('re-enqueues local records left pending without a queued operation', async () => {
    const list = await repository.createList('孤儿列表', ['pet-0001'], 'usr_orphan')
    await repository.setFavorite('pet-0002', true, 'usr_orphan')
    const db = await database()

    // 模拟「操作已被服务端拒绝并从队列删除」
    const tx = db.transaction('pendingOps', 'readwrite')
    await tx.store.clear()
    await tx.done
    expect(await db.count('pendingOps')).toBe(0)

    expect(await requeueOrphaned('usr_orphan')).toBe(2)
    const ops = (await db.getAll('pendingOps')).filter((op) => op.profileId === 'usr_orphan')
    expect(ops.map((op) => op.kind).sort()).toEqual(['favorite.set', 'list.create'])
    expect(ops.find((op) => op.kind === 'list.create')).toMatchObject({ entityId: list.id, payload: { vocabIds: ['pet-0001'] } })

    // 已在队列里的不重复入队：再调一次应当没有新增
    expect(await requeueOrphaned('usr_orphan')).toBe(0)
  })

  it('derives stable, user-scoped migration operation ids', async () => {
    const first = await stableMigrationOpId('usr_a', 'list.create', 'legacy-1')
    expect(await stableMigrationOpId('usr_a', 'list.create', 'legacy-1')).toBe(first)
    expect(await stableMigrationOpId('usr_b', 'list.create', 'legacy-1')).not.toBe(first)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })
})
