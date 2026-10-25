import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { setSyncStatus } from '../sync/status'
import type { SyncStatusValue } from '../sync/status'
import SyncStatus from './SyncStatus'
describe('sync status wording', () => {
  it('renders pending, syncing, offline, auth and rejected states', () => {
    const cases: [Partial<SyncStatusValue>, string][] = [
      [{ phase: 'synced' as const, pending: 0, errors: [] }, '已同步'],
      [{ phase: 'synced' as const, pending: 3, errors: [] }, '待同步 3 项'],
      [{ phase: 'syncing' as const, pending: 1, errors: [] }, '同步中…'],
      [{ phase: 'offline' as const, pending: 1, errors: [] }, '离线 · 改动已存本机'],
      [{ phase: 'auth-paused' as const, pending: 1, errors: [] }, '云同步已暂停'],
      [{ phase: 'permanent-error' as const, pending: 0, errors: ['bad'] }, '有 1 项无法同步'],
    ]
    for (const [state, text] of cases) { setSyncStatus(state); expect(renderToStaticMarkup(<SyncStatus />)).toContain(text) }
  })
})
