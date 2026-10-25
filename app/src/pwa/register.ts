/**
 * Service Worker 注册。
 *
 * 只在生产构建注册：开发环境下 SW 会缓存源码模块，导致改动不生效，
 * 而且 Vite 的 HMR 与 SW 缓存会互相干扰。
 *
 * 升级策略：发现新版本不自动刷新（避免打断背诵中途的状态），
 * 而是返回一个可订阅的状态，由界面提示用户刷新。
 */

export interface SwStatus {
  /** 是否已注册成功 */
  registered: boolean
  /** 是否有新版本在等待激活 */
  updateReady: boolean
  /** 当前是否可离线打开（壳已缓存） */
  offlineReady: boolean
}

type Listener = (status: SwStatus) => void

const state: SwStatus = { registered: false, updateReady: false, offlineReady: false }
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener({ ...state })
}

export function subscribeSwStatus(listener: Listener) {
  listeners.add(listener)
  listener({ ...state })
  return () => listeners.delete(listener)
}

export function getSwStatus(): SwStatus {
  return { ...state }
}

/** 应用新版本：让等待中的 SW 立即接管并刷新页面 */
export async function applySwUpdate() {
  const registration = await navigator.serviceWorker?.getRegistration()
  registration?.waiting?.postMessage('SKIP_WAITING')
  setTimeout(() => window.location.reload(), 300)
}

export function registerServiceWorker() {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  // 开发环境不注册，避免缓存干扰 HMR
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' })
        state.registered = true
        // 首次安装完成即认为可以离线打开
        state.offlineReady = true
        emit()

        // 已有等待中的新版本（上次访问装好但没激活）
        if (registration.waiting) {
          state.updateReady = true
          emit()
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              // 有旧版本在控制页面，说明这是一次更新
              state.updateReady = true
              emit()
            }
          })
        })
      } catch {
        // SW 注册失败不影响应用本身（只是失去离线能力）
        state.registered = false
        emit()
      }
    })()
  })
}
