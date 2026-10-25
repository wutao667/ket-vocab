import type { DBSchema } from 'idb'

export const DB_NAME = 'ket-vocab'
export const DB_VERSION = 3
export const LEGACY_PROFILE_ID = 'default'
/** @deprecated only retained for source compatibility with v2 callers. */
export const PROFILE_ID = LEGACY_PROFILE_ID

export type OperationKind = 'list.create' | 'list.rename' | 'list.delete' | 'list.vocab.set' | 'favorite.set'
export type SyncState = 'synced' | 'pending'
export interface StudyList { id: string; profileId: string; name: string; vocabIds: string[]; createdAt: number; updatedAt: number; nameSeq?: number; deletedAt?: number | null; syncState?: SyncState }
export interface TemporarySelection { key: string; profileId: string; vocabIds: string[]; updatedAt: number }
export interface FavoriteRecord { key: string; profileId: string; vocabId: string; createdAt: number; sourceListId?: string; present?: boolean; syncState?: SyncState }
export interface PendingOperation { opId: string; profileId: string; deviceId: string; kind: OperationKind; entityId: string; payload: Record<string, unknown>; createdAt: number; attemptCount: number; nextAttemptAt: number }
export interface SyncMeta { profileId: string; cursor: number; lastSyncAt?: number; migrationVersion?: number }
export interface LocalListVocab { key: string; profileId: string; listId: string; vocabId: string; present: boolean }

export interface KetVocabDB extends DBSchema {
  lists: { key: string; value: StudyList; indexes: { 'by-profile': string } }
  selections: { key: string; value: TemporarySelection }
  favorites: { key: string; value: FavoriteRecord; indexes: { 'by-profile': string } }
  pendingOps: { key: string; value: PendingOperation; indexes: { 'by-profile-nextAttempt': [string, number] } }
  syncMeta: { key: string; value: SyncMeta }
  listVocab: { key: string; value: LocalListVocab; indexes: { 'by-profile-list': [string, string] } }
}
