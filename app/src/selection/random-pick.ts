/**
 * 「随机挑选未选过的词」纯逻辑。
 *
 * 这里的「选过」按产品定义（方案 A）指的是：
 *   已经进入任何背诵列表，或已收藏进生词本。
 * 当前页面临时勾选但还没创建列表的词不算「选过」——
 * 因此同一个词在清空后理论上可能再次被抽中，这是已知且可接受的取舍。
 *
 * 抽成纯函数（不碰 IndexedDB、不碰 React）是为了能直接单测：
 * 随机性、去重、池子耗尽这三种情况用固定种子就能稳定覆盖。
 */

/**
 * 从候选池里随机抽 count 个，不放回。
 *
 * @param allIds     全部词条 ID
 * @param excluded   需要排除的 ID（已在列表 / 已收藏）
 * @param current    当前已勾选的 ID（抽完不能让总数超过预期，也避免重复勾选）
 * @param count      本次要抽几个
 * @param random     随机源，测试时注入固定实现
 */
export function pickRandomUnseen(
  allIds: readonly string[],
  excluded: ReadonlySet<string>,
  current: ReadonlySet<string>,
  count: number,
  random: () => number = Math.random,
): string[] {
  // 候选 = 全部 - 已选过 - 当前已勾选
  const pool = allIds.filter((id) => !excluded.has(id) && !current.has(id))
  if (pool.length === 0 || count <= 0) return []

  const take = Math.min(count, pool.length)

  // 部分洗牌：只需要前 take 个有序，其余不必排完，省一次全排序。
  for (let index = 0; index < take; index += 1) {
    const swapWith = index + Math.floor(random() * (pool.length - index))
    const held = pool[index]
    pool[index] = pool[swapWith]
    pool[swapWith] = held
  }
  return pool.slice(0, take)
}

/**
 * 候选池还剩多少可抽。
 * 用于按钮文案与「抽完了」的提示，避免用户点了没反应。
 */
export function remainingCount(
  allIds: readonly string[],
  excluded: ReadonlySet<string>,
  current: ReadonlySet<string>,
): number {
  let left = 0
  for (const id of allIds) {
    if (!excluded.has(id) && !current.has(id)) left += 1
  }
  return left
}
