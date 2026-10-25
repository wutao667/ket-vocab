export interface ActiveProfile { userId: string; username: string; lastLoginAt: number; lastSyncAt?: number; needsOnlineLogin?: boolean }
export const ACTIVE_PROFILE_KEY = 'ket-active-profile'
const RECENT_KEY = 'ket-recent-accounts'
const DEVICE_KEY = 'ket-device-id'

export function getDeviceId(): string { const current = localStorage.getItem(DEVICE_KEY); if (current) return current; const value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); return value }
export function getActiveProfile(): ActiveProfile | null { try { return JSON.parse(localStorage.getItem(ACTIVE_PROFILE_KEY) ?? 'null') } catch { return null } }
export function getRecentAccounts(): ActiveProfile[] { try { const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(value) ? value.slice(0, 5) : [] } catch { return [] } }
export function setActiveProfile(profile: ActiveProfile) { localStorage.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(profile)); const recent = [profile, ...getRecentAccounts().filter((item) => item.userId !== profile.userId)].slice(0, 5); localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); window.dispatchEvent(new Event('ket-session-change')) }
export function clearActiveProfile() { localStorage.removeItem(ACTIVE_PROFILE_KEY); window.dispatchEvent(new Event('ket-session-change')) }
export function updateLastSync(lastSyncAt: number) { const value = getActiveProfile(); if (value) setActiveProfile({ ...value, lastSyncAt }) }
