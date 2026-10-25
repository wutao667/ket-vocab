import { useSyncExternalStore } from 'react'
export type SyncPhase = 'local-only' | 'syncing' | 'synced' | 'offline' | 'retry-wait' | 'auth-paused' | 'permanent-error'
export interface SyncStatusValue { phase: SyncPhase; pending: number; errors: string[]; lastSyncAt?: number }
let current: SyncStatusValue = { phase: 'local-only', pending: 0, errors: [] }
const listeners = new Set<() => void>()
export function setSyncStatus(value: Partial<SyncStatusValue>) { current = { ...current, ...value }; listeners.forEach((listener) => listener()) }
export function getSyncStatus() { return current }
export function useSyncStatus() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, getSyncStatus, getSyncStatus) }
