import { database } from '../db/repository'
import type { KetVocabDB, PendingOperation } from '../db/schema'
import { notifyDataChanged } from '../db/events'
import { getActiveProfile, getDeviceId, setActiveProfile, updateLastSync } from '../auth/session'
import { api } from './client'
import { ApiError, type Snapshot, type SyncChange, type SyncResponse } from './types'
import { getSyncStatus, setSyncStatus } from './status'
import type { IDBPTransaction } from 'idb'
import { config, eventName } from '../config/app-config'

const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
export function retryDelay(attempt: number, random = Math.random): number { const base = attempt < BACKOFF.length ? BACKOFF[attempt] : Math.min(300_000, 60_000 * 2 ** (attempt - BACKOFF.length + 1)); return Math.round(Math.min(300_000, base) * (0.8 + random() * 0.4)) }
const vocabKey = (profileId: string, listId: string, vocabId: string) => `${profileId}:${listId}:${vocabId}`
type WriteTx = IDBPTransaction<KetVocabDB, ('lists' | 'favorites' | 'listVocab' | 'pendingOps' | 'syncMeta')[], 'readwrite'>

async function applyChange(tx: WriteTx, profileId: string, change: SyncChange) {
  const lists = tx.objectStore('lists'), favorites = tx.objectStore('favorites'), listVocab = tx.objectStore('listVocab'), { kind, entityId, payload } = change
  if (kind === 'list.create') {
    const current = await lists.get(entityId), ids = (payload.vocabIds as string[]) ?? []
    await lists.put({ ...current, id: entityId, profileId, name: String(payload.name), vocabIds: ids, createdAt: current?.createdAt ?? Number(payload.createdAt ?? change.serverTime), updatedAt: change.serverTime, deletedAt: null, nameSeq: change.seq, syncState: 'synced' })
    for (const vocabId of ids) await listVocab.put({ key: vocabKey(profileId, entityId, vocabId), profileId, listId: entityId, vocabId, present: true })
  } else if (kind === 'list.rename') { const item = await lists.get(entityId); if (item && (item.nameSeq ?? 0) <= change.seq) await lists.put({ ...item, name: String(payload.name), nameSeq: change.seq, updatedAt: change.serverTime, syncState: 'synced' })
  } else if (kind === 'list.delete') { const item = await lists.get(entityId); if (item) await lists.put({ ...item, deletedAt: Number(payload.deletedAt ?? change.serverTime), updatedAt: change.serverTime, syncState: 'synced' })
  } else if (kind === 'list.vocab.set') {
    const item = await lists.get(entityId), vocabId = String(payload.vocabId), present = Boolean(payload.present)
    await listVocab.put({ key: vocabKey(profileId, entityId, vocabId), profileId, listId: entityId, vocabId, present })
    if (item) await lists.put({ ...item, vocabIds: present ? [...new Set([...item.vocabIds, vocabId])] : item.vocabIds.filter((id) => id !== vocabId), updatedAt: change.serverTime, syncState: 'synced' })
  } else if (kind === 'favorite.set') {
    const key = `${profileId}:${entityId}`, old = await favorites.get(key)
    await favorites.put({ key, profileId, vocabId: entityId, present: Boolean(payload.present), createdAt: old?.createdAt ?? Number(payload.createdAt ?? change.serverTime), sourceListId: payload.sourceListId as string | undefined, syncState: 'synced' })
  }
}

async function replay(tx: WriteTx, op: PendingOperation) {
  const lists = tx.objectStore('lists'), favorites = tx.objectStore('favorites'), listVocab = tx.objectStore('listVocab'), p = op.payload
  if (op.kind === 'list.create') { const old = await lists.get(op.entityId); const ids = p.vocabIds as string[]; await lists.put({ id: op.entityId, profileId: op.profileId, name: String(p.name), vocabIds: ids, createdAt: old?.createdAt ?? op.createdAt, updatedAt: op.createdAt, deletedAt: null, syncState: 'pending' }); for (const vocabId of ids) await listVocab.put({ key: vocabKey(op.profileId, op.entityId, vocabId), profileId: op.profileId, listId: op.entityId, vocabId, present: true }) }
  else if (op.kind === 'list.rename') { const old = await lists.get(op.entityId); if (old) await lists.put({ ...old, name: String(p.name), updatedAt: op.createdAt, syncState: 'pending' }) }
  else if (op.kind === 'list.delete') { const old = await lists.get(op.entityId); if (old) await lists.put({ ...old, deletedAt: op.createdAt, syncState: 'pending' }) }
  else if (op.kind === 'list.vocab.set') { const old = await lists.get(op.entityId), vocabId = String(p.vocabId), present = Boolean(p.present); await listVocab.put({ key: vocabKey(op.profileId, op.entityId, vocabId), profileId: op.profileId, listId: op.entityId, vocabId, present }); if (old) await lists.put({ ...old, vocabIds: present ? [...new Set([...old.vocabIds, vocabId])] : old.vocabIds.filter((id) => id !== vocabId), syncState: 'pending' }) }
  else { const key = `${op.profileId}:${op.entityId}`, old = await favorites.get(key); await favorites.put({ key, profileId: op.profileId, vocabId: op.entityId, createdAt: old?.createdAt ?? op.createdAt, sourceListId: old?.sourceListId ?? p.sourceListId as string | undefined, present: Boolean(p.present), syncState: 'pending' }) }
}

export async function applySyncResponse(profileId: string, response: SyncResponse) {
  const db = await database(), tx = db.transaction(['lists', 'favorites', 'listVocab', 'pendingOps', 'syncMeta'], 'readwrite'), rejected: string[] = []
  for (const result of response.results) {
    // 服务端只回 opId，不回 entityId。要在删除前先取出操作本身，
    // 否则后面想根据实体做补偿（如 LIST_EXISTS）就拿不到目标了。
    const source = await tx.objectStore('pendingOps').get(result.opId)
    if (result.status === 'applied' || result.status === 'duplicate' || result.status === 'rejected') await tx.objectStore('pendingOps').delete(result.opId)
    if (result.status !== 'rejected') continue
    rejected.push(result.code ?? '操作被拒绝')
    // LIST_EXISTS / LIST_DELETED 表示服务端已有该列表，本地只是缺一次快照。
    // 把本地标记为已同步，避免被 requeueOrphaned 再次入队造成死循环。
    if ((result.code === 'LIST_EXISTS' || result.code === 'LIST_DELETED') && source) {
      const lists = tx.objectStore('lists'), item = await lists.get(source.entityId)
      if (item) await lists.put({ ...item, syncState: 'synced' })
    }
  }
  for (const change of [...response.changes].sort((a, b) => a.seq - b.seq)) await applyChange(tx, profileId, change)
  const remaining = (await tx.objectStore('pendingOps').getAll()).filter((op) => op.profileId === profileId).sort((a, b) => a.createdAt - b.createdAt)
  for (const op of remaining) await replay(tx, op)
  await tx.objectStore('syncMeta').put({ ...(await tx.objectStore('syncMeta').get(profileId)), profileId, cursor: response.cursor, lastSyncAt: Date.now() }); await tx.done
  // 同步可能带来其他设备的改动，通知界面重新读取
  notifyDataChanged()
  return rejected
}

/**
 * 修复「本地有、队列里没有」的孤儿数据。
 *
 * 为什么需要：操作被服务端拒绝（例如早期把词条 ID 格式写死成 ket- 导致 PET
 * 全被拒）后，前端会把该操作从队列删掉，但本地记录仍停在 pending。
 * 结果是服务端修好了，这些数据也永远不会再上传——用户看到的正是
 * 「有 14 项无法同步」且点「立即同步」毫无反应。
 *
 * 策略：把标记为 pending 却没有对应待办操作的列表/收藏重新入队一次。
 * 已正常排队的不会重复入队（有 op 就跳过），因此可安全地在每轮同步前调用。
 */
export async function requeueOrphaned(profileId: string): Promise<number> {
  const db = await database()
  const ops = (await db.getAll('pendingOps')).filter((op) => op.profileId === profileId)
  const covered = new Set(ops.map((op) => `${op.kind === 'favorite.set' ? 'fav' : 'list'}:${op.entityId}`))
  const lists = (await db.getAllFromIndex('lists', 'by-profile', profileId)).filter((item) => item.syncState === 'pending')
  const favorites = (await db.getAllFromIndex('favorites', 'by-profile', profileId)).filter((item) => item.syncState === 'pending')

  const pending: PendingOperation[] = []
  const now = Date.now()
  for (const list of lists) {
    if (covered.has(`list:${list.id}`)) continue
    if (list.deletedAt != null) {
      pending.push({ opId: crypto.randomUUID(), profileId, deviceId: getDeviceId(), kind: 'list.delete', entityId: list.id, payload: {}, createdAt: now, attemptCount: 0, nextAttemptAt: now })
    } else {
      pending.push({ opId: crypto.randomUUID(), profileId, deviceId: getDeviceId(), kind: 'list.create', entityId: list.id, payload: { name: list.name, vocabIds: list.vocabIds }, createdAt: now, attemptCount: 0, nextAttemptAt: now })
    }
  }
  for (const favorite of favorites) {
    if (covered.has(`fav:${favorite.vocabId}`)) continue
    pending.push({ opId: crypto.randomUUID(), profileId, deviceId: getDeviceId(), kind: 'favorite.set', entityId: favorite.vocabId, payload: { present: favorite.present !== false, ...(favorite.sourceListId ? { sourceListId: favorite.sourceListId } : {}) }, createdAt: now, attemptCount: 0, nextAttemptAt: now })
  }
  if (!pending.length) return 0

  const tx = db.transaction('pendingOps', 'readwrite')
  for (const op of pending) await tx.store.put(op)
  await tx.done
  return pending.length
}

export async function applySnapshot(profileId: string, snapshot: Snapshot) {
  const db = await database(), tx = db.transaction(['lists', 'favorites', 'listVocab', 'pendingOps', 'syncMeta'], 'readwrite')
  for (const item of await tx.objectStore('lists').index('by-profile').getAll(profileId)) await tx.objectStore('lists').delete(item.id)
  for (const item of await tx.objectStore('favorites').index('by-profile').getAll(profileId)) await tx.objectStore('favorites').delete(item.key)
  for (const item of await tx.objectStore('listVocab').getAll()) if (item.profileId === profileId) await tx.objectStore('listVocab').delete(item.key)
  for (const item of snapshot.lists) { const ids = item.vocab.filter((v) => v.present).map((v) => v.vocabId); await tx.objectStore('lists').put({ id: item.listId, profileId, name: item.name, vocabIds: ids, createdAt: item.createdAt, updatedAt: item.deletedAt ?? item.createdAt, deletedAt: item.deletedAt, syncState: 'synced' }); for (const v of item.vocab) await tx.objectStore('listVocab').put({ key: vocabKey(profileId, item.listId, v.vocabId), profileId, listId: item.listId, vocabId: v.vocabId, present: v.present }) }
  for (const item of snapshot.favorites) await tx.objectStore('favorites').put({ key: `${profileId}:${item.vocabId}`, profileId, vocabId: item.vocabId, present: item.present, sourceListId: item.sourceListId, createdAt: item.createdAt, syncState: 'synced' })
  const pending = (await tx.objectStore('pendingOps').getAll()).filter((op) => op.profileId === profileId).sort((a, b) => a.createdAt - b.createdAt); for (const op of pending) await replay(tx, op)
  await tx.objectStore('syncMeta').put({ ...(await tx.objectStore('syncMeta').get(profileId)), profileId, cursor: snapshot.cursor, lastSyncAt: Date.now() }); await tx.done
  // 快照落地后必须通知界面，否则登录后会停在空列表
  notifyDataChanged()
}

let running = false
async function runUnlocked(profileId: string) {
  if (running) return; running = true
  let attempted: PendingOperation[] = []
  try {
    // 错误只在「本轮同步」内累积。若沿用上一轮的残留错误，服务端修好后
    // 界面会永远停在「有 N 项无法同步」，用户点了立即同步也没反应（实测踩过）。
    // 先补回「本地 pending 但队列里没有」的孤儿数据：
    // 早期被服务端拒绝的操作会从队列删除，本地却仍标记 pending，
    // 不补的话即使服务端已修好，这些数据也永远不会再上传。
    await requeueOrphaned(profileId)
    setSyncStatus({ phase: 'syncing' }); let hasMore = true, first = true, errors: string[] = []
    while (hasMore) {
      const db = await database(), meta = await db.get('syncMeta', profileId), now = Date.now()
      const pending = (await db.getAll('pendingOps')).filter((op) => op.profileId === profileId && op.nextAttemptAt <= now).sort((a, b) => a.createdAt - b.createdAt).slice(0, first ? 50 : 0); attempted = pending
      const response = await api.sync(getDeviceId(), meta?.cursor ?? 0, pending.map((op) => ({ opId: op.opId, kind: op.kind, entityId: op.entityId, payload: op.payload, clientTime: op.createdAt })))
      errors = [...errors, ...(await applySyncResponse(profileId, response))]; hasMore = response.hasMore; first = false
    }
    const db = await database(), queued = (await db.getAll('pendingOps')).filter((op) => op.profileId === profileId), count = queued.length, lastSyncAt = Date.now(); updateLastSync(lastSyncAt); setSyncStatus({ phase: errors.length ? 'permanent-error' : count ? 'retry-wait' : 'synced', pending: count, errors, lastSyncAt }); if (queued.length) window.setTimeout(() => void syncNow(), Math.max(0, Math.min(...queued.map((op) => op.nextAttemptAt)) - Date.now()))
  } catch (cause) {
    const error = cause as ApiError
    if (error.code === 'CURSOR_EXPIRED') { const snapshot = await api.snapshot(); await applySnapshot(profileId, snapshot); running = false; return runUnlocked(profileId) }
    const db = await database(), tx = db.transaction('pendingOps', 'readwrite'), now = Date.now(), delays: number[] = []; for (const op of attempted) { const current = await tx.store.get(op.opId); if (!current) continue; const delay = retryDelay(current.attemptCount); delays.push(delay); await tx.store.put({ ...current, attemptCount: current.attemptCount + 1, nextAttemptAt: now + delay }) } await tx.done
    const count = (await db.getAll('pendingOps')).filter((op) => op.profileId === profileId).length
    if (error.status === 401) setSyncStatus({ phase: 'auth-paused', pending: count })
    else if (error.status === 0 || !navigator.onLine) setSyncStatus({ phase: 'offline', pending: count })
    // 同一错误连续重试会重复入列（曾出现 14 条一模一样的提示），这里去重。
    else setSyncStatus({ phase: error.retryable || error.status === 429 || error.status >= 500 ? 'retry-wait' : 'permanent-error', pending: count, errors: error.retryable ? getSyncStatus().errors : [...new Set([...getSyncStatus().errors, error.message])] })
    if (error.status !== 401 && delays.length) window.setTimeout(() => void syncNow(), Math.min(...delays))
  } finally { running = false }
}

export async function syncNow() {
  let profile = getActiveProfile(); if (!profile) return
  if (profile.needsOnlineLogin) {
    try { await api.login(profile.username, false, getDeviceId()); profile = { ...profile, needsOnlineLogin: false, lastLoginAt: Date.now() }; setActiveProfile(profile) }
    catch (cause) { const error = cause as ApiError; setSyncStatus({ phase: error.status === 0 ? 'offline' : 'auth-paused' }); return }
  }
  const locks = navigator.locks; if (locks) await locks.request(`${config.storagePrefix}-sync:${profile.userId}`, { ifAvailable: true }, async (lock) => { if (lock) await runUnlocked(profile.userId) }); else await runUnlocked(profile.userId)
}
let debounce: number | undefined
export function startSyncTriggers() {
  const trigger = () => void syncNow(), local = () => { window.clearTimeout(debounce); debounce = window.setTimeout(trigger, 500) }, visible = () => { if (document.visibilityState === 'visible') trigger() }
  window.addEventListener('online', trigger); window.addEventListener(eventName('local-change'), local); document.addEventListener('visibilitychange', visible); const timer = window.setInterval(trigger, 60_000); trigger()
  return () => { window.removeEventListener('online', trigger); window.removeEventListener(eventName('local-change'), local); document.removeEventListener('visibilitychange', visible); window.clearInterval(timer); window.clearTimeout(debounce) }
}

export async function stableMigrationOpId(userId: string, kind: string, legacyKey: string) { const bytes = new TextEncoder().encode(`migration-v1\0${userId}${kind}${legacyKey}`), hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); return [...hash].map((value) => value.toString(16).padStart(2, '0')).join('') }
export async function legacyCounts() { const db = await database(); return { lists: (await db.getAllFromIndex('lists', 'by-profile', 'default')).filter((x) => x.deletedAt == null).length, favorites: (await db.getAllFromIndex('favorites', 'by-profile', 'default')).filter((x) => x.present !== false).length } }

/**
 * 清除 legacy（profileId='default'）的旧列表与旧收藏。
 *
 * 用户明确要求：合并提示只在第一次出现，选「确定」或「取消」之后都要清掉本地旧数据，
 * 否则每次登录都会重复询问。
 *
 * 只删 legacy 分区的数据，不动任何已登录账号（userId）的数据。
 */
export async function clearLegacyData() {
  const db = await database()
  const tx = db.transaction(['lists', 'favorites', 'listVocab', 'selections'], 'readwrite')

  for (const item of await tx.objectStore('lists').index('by-profile').getAll('default')) {
    await tx.objectStore('lists').delete(item.id)
  }
  for (const item of await tx.objectStore('favorites').index('by-profile').getAll('default')) {
    await tx.objectStore('favorites').delete(item.key)
  }
  for (const item of await tx.objectStore('listVocab').getAll()) {
    if (item.profileId === 'default') await tx.objectStore('listVocab').delete(item.key)
  }
  // 临时选择也一并清掉，避免草稿指向已删除的旧列表
  await tx.objectStore('selections').delete('temporary:default')

  await tx.done
}

/** 记录「迁移提示已处理过」，避免同一账号再次弹出 */
export async function markMigrationHandled(userId: string) {
  const db = await database()
  const meta = await db.get('syncMeta', userId)
  await db.put('syncMeta', { ...meta, profileId: userId, cursor: meta?.cursor ?? 0, migrationVersion: 1 })
}

export async function migrateLegacy(userId: string) {
  const db = await database(), meta = await db.get('syncMeta', userId); if (meta?.migrationVersion === 1) return
  const legacyLists = (await db.getAllFromIndex('lists', 'by-profile', 'default')).filter((x) => x.deletedAt == null), legacyFavorites = (await db.getAllFromIndex('favorites', 'by-profile', 'default')).filter((x) => x.present !== false), deviceId = getDeviceId()
  const preparedLists = await Promise.all(legacyLists.map(async (list) => { const opId = await stableMigrationOpId(userId, 'list.create', list.id); return { list, id: `mig_${opId.slice(0, 32)}`, opId } }))
  const migratedListIds = new Map(preparedLists.map((item) => [item.list.id, item.id]))
  const preparedFavorites = await Promise.all(legacyFavorites.map(async (favorite) => ({ favorite, opId: await stableMigrationOpId(userId, 'favorite.set', favorite.key) })))
  const tx = db.transaction(['lists', 'favorites', 'listVocab', 'pendingOps', 'syncMeta'], 'readwrite')
  for (const { list, id, opId } of preparedLists) { const now = Date.now(); await tx.objectStore('lists').put({ ...list, id, profileId: userId, syncState: 'pending' }); for (const vocabId of list.vocabIds) await tx.objectStore('listVocab').put({ key: vocabKey(userId, id, vocabId), profileId: userId, listId: id, vocabId, present: true }); await tx.objectStore('pendingOps').put({ opId, profileId: userId, deviceId, kind: 'list.create', entityId: id, payload: { name: list.name, vocabIds: list.vocabIds }, createdAt: now, attemptCount: 0, nextAttemptAt: now }) }
  for (const { favorite, opId } of preparedFavorites) { const now = Date.now(), key = `${userId}:${favorite.vocabId}`, sourceListId = favorite.sourceListId ? (migratedListIds.get(favorite.sourceListId) ?? favorite.sourceListId) : undefined; await tx.objectStore('favorites').put({ ...favorite, key, profileId: userId, sourceListId, present: true, syncState: 'pending' }); await tx.objectStore('pendingOps').put({ opId, profileId: userId, deviceId, kind: 'favorite.set', entityId: favorite.vocabId, payload: { present: true, ...(sourceListId ? { sourceListId } : {}) }, createdAt: now, attemptCount: 0, nextAttemptAt: now }) }
  await tx.objectStore('syncMeta').put({ ...meta, profileId: userId, cursor: meta?.cursor ?? 0, migrationVersion: 1 }); await tx.done
}
