import { useEffect, useState } from 'react'
import { subscribeDataChanged } from '../db/events'

/**
 * 订阅本地数据变更，返回一个递增的版本号。
 *
 * 用法：把返回值放进读取数据的 effect 依赖里，
 * 这样任何写入（本地改动、快照应用、同步合并、旧数据迁移）
 * 都会让页面重新读一遍 IndexedDB。
 */
export function useDataRefresh() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const unsubscribe = subscribeDataChanged(() => setVersion((value) => value + 1))
    return () => { unsubscribe() }
  }, [])
  return version
}
