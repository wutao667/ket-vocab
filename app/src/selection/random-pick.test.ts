import { describe, expect, it } from 'vitest'
import { pickRandomUnseen, remainingCount } from './random-pick'

/** 固定序列的假随机源，让抽取结果可复现 */
function seeded(values: number[]) {
  let index = 0
  return () => values[index++ % values.length] ?? 0
}

const ALL = ['ket-0001', 'ket-0002', 'ket-0003', 'ket-0004', 'ket-0005']

describe('pickRandomUnseen', () => {
  it('每次抽 10 个，抽不到就返回全部剩余', () => {
    const many = Array.from({ length: 30 }, (_, i) => `ket-${String(i + 1).padStart(4, '0')}`)
    expect(pickRandomUnseen(many, new Set(), new Set(), 10)).toHaveLength(10)
    // 池子只剩 5 个时只返回 5 个，不会返回 undefined
    expect(pickRandomUnseen(ALL, new Set(), new Set(), 10)).toHaveLength(5)
  })

  it('排除已选过（在列表/生词本）与当前已勾选', () => {
    const excluded = new Set(['ket-0001', 'ket-0002'])
    const current = new Set(['ket-0003'])
    const picked = pickRandomUnseen(ALL, excluded, current, 10)
    expect(picked.sort()).toEqual(['ket-0004', 'ket-0005'])
  })

  it('没有候选时返回空数组', () => {
    const all = new Set(ALL)
    expect(pickRandomUnseen(ALL, all, new Set(), 10)).toEqual([])
    expect(pickRandomUnseen([], new Set(), new Set(), 10)).toEqual([])
    expect(pickRandomUnseen(ALL, new Set(), new Set(), 0)).toEqual([])
  })

  it('结果不重复，连续点击天然累加', () => {
    const first = pickRandomUnseen(ALL, new Set(), new Set(), 2, seeded([0.1, 0.7]))
    const second = pickRandomUnseen(ALL, new Set(), new Set(first), 2, seeded([0.3, 0.9]))
    const merged = [...first, ...second]
    expect(new Set(merged).size).toBe(merged.length)
  })

  it('抽到的词全部来自候选池', () => {
    const picked = pickRandomUnseen(ALL, new Set(['ket-0004']), new Set(), 10)
    expect(picked).not.toContain('ket-0004')
    for (const id of picked) expect(ALL).toContain(id)
  })
})

describe('remainingCount', () => {
  it('统计还可抽取的数量', () => {
    expect(remainingCount(ALL, new Set(), new Set())).toBe(5)
    expect(remainingCount(ALL, new Set(['ket-0001']), new Set(['ket-0002']))).toBe(3)
    expect(remainingCount(ALL, new Set(ALL), new Set())).toBe(0)
  })
})
