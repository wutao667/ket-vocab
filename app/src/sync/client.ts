import { ApiError, type LoginResponse, type Snapshot, type SyncResponse } from './types'
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(path, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }) }
  catch (cause) { throw new ApiError('NETWORK_ERROR', cause instanceof Error ? cause.message : '网络不可用', true, 0) }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) { const error = body?.error; throw new ApiError(error?.code ?? `HTTP_${response.status}`, error?.message ?? '请求失败', Boolean(error?.retryable), response.status) }
  return body as T
}
export const api = {
  lookup: (username: string) => request<{ exists: boolean; username: string; userId: string | null }>('/api/v1/auth/lookup', { method: 'POST', body: JSON.stringify({ username }) }),
  login: (username: string, create: boolean, deviceId: string) => request<LoginResponse>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, create, deviceId }) }),
  logout: () => request<Record<string, never>>('/api/v1/auth/logout', { method: 'POST', body: '{}' }),
  session: () => request<{ userId: string; username: string; cursor: number }>('/api/v1/auth/session'),
  snapshot: () => request<Snapshot>('/api/v1/sync/snapshot'),
  sync: (deviceId: string, cursor: number, operations: unknown[]) => request<SyncResponse>('/api/v1/sync', { method: 'POST', body: JSON.stringify({ protocolVersion: 1, deviceId, cursor, operations }) }),
}
