import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDeviceId, getRecentAccounts, setActiveProfile, type ActiveProfile } from '../auth/session'
import { api } from '../sync/client'
import { applySnapshot, legacyCounts, migrateLegacy, syncNow } from '../sync/engine'

type Lookup = { exists: boolean; username: string; userId: string | null }
export default function LoginPage() {
  const navigate = useNavigate(), recent = getRecentAccounts()
  const [username, setUsername] = useState(''), [lookup, setLookup] = useState<Lookup | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [offlineAccount, setOfflineAccount] = useState<ActiveProfile | null>(null)
  const continueLogin = async () => { setBusy(true); setError(''); setOfflineAccount(null); try { setLookup(await api.lookup(username.trim())) } catch (problem) { const cached = recent.find((item) => item.username === username.trim()); if (cached) setOfflineAccount(cached); setError(cached ? '当前离线，可以进入本机登录过的账号。' : (problem as Error).message) } finally { setBusy(false) } }
  const enterOffline = (profile: ActiveProfile) => { setActiveProfile({ ...profile, lastLoginAt: Date.now(), needsOnlineLogin: true }); navigate('/', { replace: true }) }
  const login = async () => {
    if (!lookup) return; setBusy(true); setError('')
    try {
      const result = await api.login(lookup.username, !lookup.exists, getDeviceId()), profile = { userId: result.userId, username: result.username, lastLoginAt: Date.now() }
      setActiveProfile(profile)
      const snapshot = await api.snapshot(), visibleRemote = snapshot.lists.some((item) => item.deletedAt == null) || snapshot.favorites.some((item) => item.present), legacy = await legacyCounts()
      await applySnapshot(result.userId, snapshot)
      if (legacy.lists + legacy.favorites > 0) {
        const wording = visibleRemote ? `云端已有数据。本机还有 ${legacy.lists} 个旧列表和 ${legacy.favorites} 个旧收藏，是否合并上传？（不会删除任一边）` : `云端当前为空。本机有 ${legacy.lists} 个旧列表和 ${legacy.favorites} 个旧收藏，是否上传？`
        if (window.confirm(wording)) await migrateLegacy(result.userId)
      }
      if (!visibleRemote && legacy.lists + legacy.favorites === 0 && recent.some((item) => item.userId !== result.userId)) window.alert('当前账号没有数据，是否输错了？')
      void syncNow(); navigate('/', { replace: true })
    } catch (problem) { setError((problem as Error).message) } finally { setBusy(false) }
  }
  return <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-5 py-10">
    <p className="text-sm font-bold uppercase tracking-[.2em] text-brand">KET Vocabulary</p><h1 className="mt-2 text-4xl font-black">进入我的词匣</h1><p className="mt-3 text-stone-600">输入用户名即可登录。新用户名会在你再次确认后创建。</p>
    <label className="mt-8 font-bold">用户名<input autoFocus value={username} maxLength={40} onChange={(event) => { setUsername(event.target.value); setLookup(null); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && username.trim()) void continueLogin() }} className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-white px-4 font-normal" /></label>
    {!lookup && <button disabled={busy || !username.trim()} onClick={() => void continueLogin()} className="mt-4 min-h-12 rounded-xl bg-brand font-bold text-white disabled:opacity-50">{busy ? '查询中…' : '继续'}</button>}
    {lookup && <section className="mt-5 rounded-2xl border border-emerald-200 bg-white p-5"><h2 className="font-bold">{lookup.exists ? `将进入已有账号「${lookup.username}」` : `将创建新账号「${lookup.username}」`}</h2>{!lookup.exists && <p className="mt-2 text-sm text-amber-700">这是新账号，数据为空。确认后才会创建。</p>}<div className="mt-4 flex gap-3"><button onClick={() => setLookup(null)} className="min-h-11 flex-1 rounded-xl border">返回修改</button><button disabled={busy} onClick={() => void login()} className="min-h-11 flex-1 rounded-xl bg-brand font-bold text-white">{busy ? '处理中…' : '确认'}</button></div></section>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}{offlineAccount && <button onClick={() => enterOffline(offlineAccount)} className="mt-3 min-h-12 rounded-xl border border-brand bg-white font-bold text-brand">离线进入「{offlineAccount.username}」</button>}
    {recent.length > 0 && <section className="mt-8"><h2 className="text-sm font-bold text-stone-500">最近使用过的账号</h2><div className="mt-2 flex flex-wrap gap-2">{recent.map((item) => <button key={item.userId} onClick={() => { setUsername(item.username); setLookup(null); setError('') }} className="rounded-full border bg-white px-4 py-2">{item.username}</button>)}</div></section>}
  </main>
}
