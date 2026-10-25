import type { OperationKind } from '../db/schema'
export interface ProtocolOperation { opId: string; kind: OperationKind; entityId: string; payload: Record<string, unknown>; clientTime: number }
export interface SyncChange { seq: number; kind: OperationKind; entityId: string; payload: Record<string, unknown>; serverTime: number }
export interface SyncResult { opId: string; status: 'applied' | 'duplicate' | 'rejected'; seq?: number; code?: string }
export interface SyncResponse { results: SyncResult[]; changes: SyncChange[]; cursor: number; hasMore: boolean }
export interface SnapshotList { listId: string; name: string; createdAt: number; deletedAt: number | null; vocab: { vocabId: string; present: boolean }[] }
export interface Snapshot { protocolVersion: 1; cursor: number; lists: SnapshotList[]; favorites: { vocabId: string; present: boolean; sourceListId?: string; createdAt: number }[] }
export interface LoginResponse { userId: string; username: string; cursor: number; created: boolean }
export class ApiError extends Error { constructor(public code: string, message: string, public retryable: boolean, public status: number) { super(message); this.name = 'ApiError' } }
