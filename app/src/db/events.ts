/**
 * 本地数据变更事件。
 *
 * 为什么需要：数据写入 IndexedDB 后，React 组件并不知道。
 * 尤其是登录流程 —— setActiveProfile 会让主界面立刻挂载，
 * 但此时远端快照还没下载完，页面会先渲染成空列表并且不再刷新。
 *
 * 所以任何写入数据的地方（本地改动、快照应用、同步合并、旧数据迁移）
 * 都要发一次事件，页面订阅后重新读一遍。
 */

const EVENT_NAME = 'ket-data-changed'

export function notifyDataChanged() {
  globalThis.dispatchEvent?.(new Event(EVENT_NAME))
}

export function subscribeDataChanged(listener: () => void) {
  globalThis.addEventListener?.(EVENT_NAME, listener)
  return () => globalThis.removeEventListener?.(EVENT_NAME, listener)
}
