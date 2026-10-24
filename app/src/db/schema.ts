import type { DBSchema } from 'idb'

export const DB_NAME = 'ket-vocab'
export const DB_VERSION = 2
export const PROFILE_ID = 'default'

export interface StudyList {
  id: string
  profileId: string
  name: string
  vocabIds: string[]
  createdAt: number
  updatedAt: number
}

export interface TemporarySelection {
  key: string
  profileId: string
  vocabIds: string[]
  updatedAt: number
}

export interface FavoriteRecord {
  key: string
  profileId: string
  vocabId: string
  createdAt: number
  sourceListId?: string
}

export interface KetVocabDB extends DBSchema {
  lists: {
    key: string
    value: StudyList
    indexes: { 'by-profile': string }
  }
  selections: { key: string; value: TemporarySelection }
  favorites: {
    key: string
    value: FavoriteRecord
    indexes: { 'by-profile': string }
  }
}
