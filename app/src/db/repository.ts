import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME, DB_VERSION, LEGACY_PROFILE_ID, type KetVocabDB, type OperationKind, type PendingOperation, type StudyList } from './schema'
import { notifyDataChanged } from './events'

const SELECTION_TTL = 24 * 60 * 60 * 1000
const ACTIVE_PROFILE_KEY = 'ket-active-profile'
const DEVICE_KEY = 'ket-device-id'
let databasePromise: Promise<IDBPDatabase<KetVocabDB>> | undefined

export class StorageError extends Error { constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'StorageError' } }
export function activeProfileId(): string { try { return JSON.parse(localStorage.getItem(ACTIVE_PROFILE_KEY) ?? 'null')?.userId || LEGACY_PROFILE_ID } catch { return LEGACY_PROFILE_ID } }
function deviceId(): string { try { const saved = localStorage.getItem(DEVICE_KEY); if (saved) return saved; const value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); return value } catch { return crypto.randomUUID() } }

export function database() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new StorageError('此浏览器不支持 IndexedDB，本次更改无法保存。'))
  databasePromise ??= openDB<KetVocabDB>(DB_NAME, DB_VERSION, { upgrade(db) {
    if (!db.objectStoreNames.contains('lists')) { const store = db.createObjectStore('lists', { keyPath: 'id' }); store.createIndex('by-profile', 'profileId') }
    if (!db.objectStoreNames.contains('selections')) db.createObjectStore('selections', { keyPath: 'key' })
    if (!db.objectStoreNames.contains('favorites')) { const store = db.createObjectStore('favorites', { keyPath: 'key' }); store.createIndex('by-profile', 'profileId') }
    if (!db.objectStoreNames.contains('pendingOps')) { const store = db.createObjectStore('pendingOps', { keyPath: 'opId' }); store.createIndex('by-profile-nextAttempt', ['profileId', 'nextAttemptAt']) }
    if (!db.objectStoreNames.contains('syncMeta')) db.createObjectStore('syncMeta', { keyPath: 'profileId' })
    if (!db.objectStoreNames.contains('listVocab')) { const store = db.createObjectStore('listVocab', { keyPath: 'key' }); store.createIndex('by-profile-list', ['profileId', 'listId']) }
  } }).catch((cause) => { databasePromise = undefined; throw new StorageError('无法打开本地数据库，请检查隐私模式或存储权限。', { cause }) })
  return databasePromise
}
export async function resetDatabaseForTests() { if (databasePromise) (await databasePromise).close(); databasePromise = undefined }
async function safely<T>(operation: (db: IDBPDatabase<KetVocabDB>) => Promise<T>, message: string): Promise<T> { try { return await operation(await database()) } catch (cause) { if (cause instanceof StorageError) throw cause; throw new StorageError(message, { cause }) } }
const selectionKey = (profileId: string) => `temporary:${profileId}`
const listVocabKey = (profileId: string, listId: string, vocabId: string) => `${profileId}:${listId}:${vocabId}`
function operation(profileId: string, kind: OperationKind, entityId: string, payload: Record<string, unknown>, createdAt = Date.now()): PendingOperation { return { opId: crypto.randomUUID(), profileId, deviceId: deviceId(), kind, entityId, payload, createdAt, attemptCount: 0, nextAttemptAt: createdAt } }
function announceLocalChange() {
  // ket-local-change：给同步引擎用（触发上传）
  globalThis.dispatchEvent?.(new Event('ket-local-change'))
  // ket-data-changed：给界面用（重新读取列表/收藏）
  notifyDataChanged()
}

export const repository = {
  async checkAvailable() { await safely(async (db) => { await db.count('lists') }, '无法读取本地数据库。') },
  async loadSelection(profileId = activeProfileId()) { return safely(async (db) => { const record = await db.get('selections', selectionKey(profileId)); if (!record) return []; if (Date.now() - record.updatedAt >= SELECTION_TTL) { await db.delete('selections', record.key); return [] } return record.vocabIds }, '无法读取临时选择。') },
  async saveSelection(vocabIds: string[], profileId = activeProfileId()) { await safely(async (db) => { await db.put('selections', { key: selectionKey(profileId), profileId, vocabIds: [...new Set(vocabIds)], updatedAt: Date.now() }) }, '保存选择失败，请检查设备存储空间。') },
  async clearSelection(profileId = activeProfileId()) { await safely(async (db) => { await db.delete('selections', selectionKey(profileId)) }, '清空选择失败。') },
  async getLists(profileId = activeProfileId()) { return safely(async (db) => (await db.getAllFromIndex('lists', 'by-profile', profileId)).filter((item) => item.deletedAt == null).sort((a, b) => b.createdAt - a.createdAt), '无法读取背诵列表。') },
  async getList(id: string) { return safely(async (db) => { const value = await db.get('lists', id); return value && value.deletedAt == null && value.profileId === activeProfileId() ? value : undefined }, '无法读取背诵列表。') },
  async createList(name: string, vocabIds: string[], profileId = activeProfileId()) {
    const now = Date.now(), unique = [...new Set(vocabIds)]; const list: StudyList = { id: crypto.randomUUID(), profileId, name: name.trim(), vocabIds: unique, createdAt: now, updatedAt: now, deletedAt: null, syncState: 'pending' }
    await safely(async (db) => { const tx = db.transaction(['lists', 'listVocab', 'pendingOps'], 'readwrite'); await tx.objectStore('lists').add(list); await Promise.all(unique.map((vocabId) => tx.objectStore('listVocab').put({ key: listVocabKey(profileId, list.id, vocabId), profileId, listId: list.id, vocabId, present: true }))); await tx.objectStore('pendingOps').add(operation(profileId, 'list.create', list.id, { name: list.name, vocabIds: unique }, now)); await tx.done }, '创建列表失败，请检查设备存储空间。'); announceLocalChange(); return list
  },
  async renameList(id: string, name: string) { await safely(async (db) => { const tx = db.transaction(['lists', 'pendingOps'], 'readwrite'), store = tx.objectStore('lists'), list = await store.get(id); if (!list) throw new Error('missing'); const now = Date.now(); await store.put({ ...list, name: name.trim(), updatedAt: now, syncState: 'pending' }); await tx.objectStore('pendingOps').add(operation(list.profileId, 'list.rename', id, { name: name.trim() }, now)); await tx.done }, '列表重命名失败。'); announceLocalChange() },
  async removeVocab(id: string, vocabId: string) { await safely(async (db) => { const tx = db.transaction(['lists', 'listVocab', 'pendingOps'], 'readwrite'), store = tx.objectStore('lists'), list = await store.get(id); if (!list) throw new Error('missing'); const now = Date.now(); await store.put({ ...list, vocabIds: list.vocabIds.filter((item) => item !== vocabId), updatedAt: now, syncState: 'pending' }); await tx.objectStore('listVocab').put({ key: listVocabKey(list.profileId, id, vocabId), profileId: list.profileId, listId: id, vocabId, present: false }); await tx.objectStore('pendingOps').add(operation(list.profileId, 'list.vocab.set', id, { vocabId, present: false }, now)); await tx.done }, '移除词条失败。'); announceLocalChange() },
  async deleteList(id: string) { await safely(async (db) => { const tx = db.transaction(['lists', 'pendingOps'], 'readwrite'), store = tx.objectStore('lists'), list = await store.get(id); if (!list) return; const now = Date.now(); await store.put({ ...list, deletedAt: now, updatedAt: now, syncState: 'pending' }); await tx.objectStore('pendingOps').add(operation(list.profileId, 'list.delete', id, {}, now)); await tx.done }, '删除列表失败。'); announceLocalChange() },
  async getFavoriteRecords(profileId = activeProfileId()) { return safely(async (db) => (await db.getAllFromIndex('favorites', 'by-profile', profileId)).filter((item) => item.present !== false).sort((a, b) => a.createdAt - b.createdAt), '无法读取生词收藏。') },
  async getFavoriteIds(profileId = activeProfileId()) { return (await this.getFavoriteRecords(profileId)).map(({ vocabId }) => vocabId) },
  async setFavorite(vocabId: string, favorite: boolean, profileId = activeProfileId(), sourceListId?: string) { const key = `${profileId}:${vocabId}`; await safely(async (db) => { const tx = db.transaction(['favorites', 'pendingOps'], 'readwrite'), store = tx.objectStore('favorites'), existing = await store.get(key), now = Date.now(); await store.put({ key, profileId, vocabId, createdAt: existing?.createdAt ?? now, sourceListId: existing?.sourceListId ?? sourceListId, present: favorite, syncState: 'pending' }); await tx.objectStore('pendingOps').add(operation(profileId, 'favorite.set', vocabId, { present: favorite, ...(sourceListId ? { sourceListId } : {}) }, now)); await tx.done }, favorite ? '收藏生词失败。' : '取消收藏失败。'); announceLocalChange() },
}
