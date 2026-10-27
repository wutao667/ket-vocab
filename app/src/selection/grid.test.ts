import { describe, expect, it } from 'vitest'
import vocabJson from '../data/vocab.json'
import meta from '../data/meta.json'
import type { VocabEntry } from '../data/types'
import { buildGridItems } from './grid'

const vocabulary = vocabJson as VocabEntry[]
const total = meta.wordCount

describe('A-Z selection grid model', () => {
  const items = buildGridItems(vocabulary)
  const rows = items.filter((item) => item.type === 'row')
  const dividers = items.filter((item) => item.type === 'divider')

  it('keeps all words in source order and uses ten columns per full row', () => {
    expect(rows.flatMap((row) => row.words).map((entry) => entry.id)).toEqual(vocabulary.map((entry) => entry.id))
    expect(rows.slice(0, -1).every((row) => row.words.length === 10)).toBe(true)
    // 最后一行是除不尽的余数：1723 → 3，3099 → 9
    expect(rows.at(-1)?.words).toHaveLength(total % 10 === 0 ? 10 : total % 10)
  })

  it('inserts minor and major dividers at the required boundaries', () => {
    expect(dividers.find((item) => item.after === 50)).toMatchObject({ major: false, from: 51, to: 100 })
    expect(dividers.find((item) => item.after === 100)).toMatchObject({ major: true, from: 101, to: 200 })
    expect(dividers.find((item) => item.after === 150)).toMatchObject({ major: false, from: 151, to: 200 })
    // 最后一个整百处的分割线：KET 到 1723 结束，PET 到 3099 结束
    const lastHundred = Math.floor(total / 100) * 100
    expect(dividers.find((item) => item.after === lastHundred)).toMatchObject({ major: true, from: lastHundred + 1, to: total })
    expect(dividers.every((item) => item.major === (item.after % 100 === 0))).toBe(true)
  })
})
