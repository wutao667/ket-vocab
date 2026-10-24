import { describe, expect, it } from 'vitest'
import vocabJson from '../data/vocab.json'
import type { VocabEntry } from '../data/types'
import { buildGridItems } from './grid'

const vocabulary = vocabJson as VocabEntry[]

describe('A-Z selection grid model', () => {
  const items = buildGridItems(vocabulary)
  const rows = items.filter((item) => item.type === 'row')
  const dividers = items.filter((item) => item.type === 'divider')

  it('keeps all words in source order and uses ten columns per full row', () => {
    expect(rows.flatMap((row) => row.words).map((entry) => entry.id)).toEqual(vocabulary.map((entry) => entry.id))
    expect(rows.slice(0, -1).every((row) => row.words.length === 10)).toBe(true)
    expect(rows.at(-1)?.words).toHaveLength(3)
  })

  it('inserts minor and major dividers at the required boundaries', () => {
    expect(dividers.find((item) => item.after === 50)).toMatchObject({ major: false, from: 51, to: 100 })
    expect(dividers.find((item) => item.after === 100)).toMatchObject({ major: true, from: 101, to: 200 })
    expect(dividers.find((item) => item.after === 150)).toMatchObject({ major: false, from: 151, to: 200 })
    expect(dividers.find((item) => item.after === 1700)).toMatchObject({ major: true, from: 1701, to: 1723 })
    expect(dividers.every((item) => item.major === (item.after % 100 === 0))).toBe(true)
  })
})
