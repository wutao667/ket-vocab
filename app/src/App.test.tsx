import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

let values = new Map<string, string>()
beforeEach(() => { values = new Map(); vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }) })
describe('local session route guard', () => {
  it('forces every business route to the login page without local state', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/lists/private']}><App /></MemoryRouter>)
    expect(html).toContain('进入我的词匣'); expect(html).not.toContain('正在读取列表')
  })
  it('starts the application directly from cached login state without server validation', () => {
    values.set('ket-active-profile', JSON.stringify({ userId: 'usr_offline', username: '离线用户', lastLoginAt: 1 }))
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(html).toContain('离线用户'); expect(html).toContain('我的词匣'); expect(html).not.toContain('进入我的词匣')
  })
})
