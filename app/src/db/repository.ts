import { openDB, type IDBPDatabase } from 'idb'
import { DB_NAME, DB_VERSION, PROFILE_ID, type KetVocabDB, type StudyList } from './schema'

const SELECTION_TTL = 24 * 60 * 60 * 1000
let databasePromise: Promise<IDBPDatabase<KetVocabDB>> | undefined

export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'StorageError' }
}

function database() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new StorageError('此浏览器不支持 IndexedDB，本次更改无法保存。'))
  databasePromise ??= openDB<KetVocabDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('lists')) {
        const lists = db.createObjectStore('lists', { keyPath: 'id' })
        lists.createIndex('by-profile', 'profileId')
      }
      if (!db.objectStoreNames.contains('selections')) db.createObjectStore('selections', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('favorites')) {
        const favorites = db.createObjectStore('favorites', { keyPath: 'key' })
        favorites.createIndex('by-profile', 'profileId')
      }
    },
  }).catch((cause) => {
    databasePromise = undefined
    throw new StorageError('无法打开本地数据库，请检查隐私模式或存储权限。', { cause })
  })
  return databasePromise
}

async function safely<T>(operation: (db: IDBPDatabase<KetVocabDB>) => Promise<T>, message: string): Promise<T> {
  try { return await operation(await database()) }
  catch (cause) {
    if (cause instanceof StorageError) throw cause
    throw new StorageError(message, { cause })
  }
}

const selectionKey = (profileId = PROFILE_ID) => `temporary:${profileId}`

export const repository = {
  async checkAvailable() { await safely(async (db) => { await db.count('lists') }, '无法读取本地数据库。') },
  async loadSelection(profileId = PROFILE_ID) {
    return safely(async (db) => {
      const record = await db.get('selections', selectionKey(profileId))
      if (!record) return []
      if (Date.now() - record.updatedAt >= SELECTION_TTL) {
        await db.delete('selections', record.key)
        return []
      }
      return record.vocabIds
    }, '无法读取临时选择。')
  },
  async saveSelection(vocabIds: string[], profileId = PROFILE_ID) {
    await safely(async (db) => {
      await db.put('selections', { key: selectionKey(profileId), profileId, vocabIds: [...new Set(vocabIds)], updatedAt: Date.now() })
    }, '保存选择失败，请检查设备存储空间。')
  },
  async clearSelection(profileId = PROFILE_ID) {
    await safely(async (db) => { await db.delete('selections', selectionKey(profileId)) }, '清空选择失败。')
  },
  async getLists(profileId = PROFILE_ID) {
    return safely(async (db) => (await db.getAllFromIndex('lists', 'by-profile', profileId)).sort((a, b) => b.createdAt - a.createdAt), '无法读取背诵列表。')
  },
  async getList(id: string) { return safely((db) => db.get('lists', id), '无法读取背诵列表。') },
  async createList(name: string, vocabIds: string[], profileId = PROFILE_ID) {
    const now = Date.now()
    const list: StudyList = { id: crypto.randomUUID(), profileId, name: name.trim(), vocabIds: [...new Set(vocabIds)], createdAt: now, updatedAt: now }
    await safely(async (db) => { await db.add('lists', list) }, '创建列表失败，请检查设备存储空间。')
    return list
  },
  async renameList(id: string, name: string) {
    await safely(async (db) => {
      const list = await db.get('lists', id)
      if (!list) throw new Error('missing')
      await db.put('lists', { ...list, name: name.trim(), updatedAt: Date.now() })
    }, '列表重命名失败。')
  },
  async removeVocab(id: string, vocabId: string) {
    await safely(async (db) => {
      const list = await db.get('lists', id)
      if (!list) throw new Error('missing')
      await db.put('lists', { ...list, vocabIds: list.vocabIds.filter((item) => item !== vocabId), updatedAt: Date.now() })
    }, '移除词条失败。')
  },
  async deleteList(id: string) { await safely(async (db) => { await db.delete('lists', id) }, '删除列表失败。') },
  async getFavoriteRecords(profileId = PROFILE_ID) {
    return safely(async (db) => (await db.getAllFromIndex('favorites', 'by-profile', profileId)).sort((a, b) => a.createdAt - b.createdAt), '无法读取生词收藏。')
  },
  async getFavoriteIds(profileId = PROFILE_ID) {
    return (await this.getFavoriteRecords(profileId)).map(({ vocabId }) => vocabId)
  },
  async setFavorite(vocabId: string, favorite: boolean, profileId = PROFILE_ID, sourceListId?: string) {
    const key = `${profileId}:${vocabId}`
    await safely(async (db) => {
      if (favorite) {
        const existing = await db.get('favorites', key)
        await db.put('favorites', existing ?? { key, profileId, vocabId, createdAt: Date.now(), sourceListId })
      }
      else await db.delete('favorites', key)
    }, favorite ? '收藏生词失败。' : '取消收藏失败。')
  },
}
