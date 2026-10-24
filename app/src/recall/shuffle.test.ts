import { describe, expect, it } from 'vitest'
import type { VocabEntry } from '../data/types'
import { shuffleForRecall } from './shuffle'

const entries = Array.from({ length: 8 }, (_, index) => ({ id: `id-${index}` })) as VocabEntry[]

describe('shuffleForRecall', () => {
  it('uses a Fisher-Yates pass without changing the source list', () => {
    const original = [...entries]
    const shuffled = shuffleForRecall(entries, [], () => 0)
    expect(entries).toEqual(original)
    expect(shuffled.map((entry) => entry.id)).toEqual(['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7', 'id-0'])
  })

  it('prevents two consecutive rounds from having an identical order', () => {
    const previous = entries.map((entry) => entry.id)
    const shuffled = shuffleForRecall(entries, previous, () => 0.999999)
    expect(shuffled.map((entry) => entry.id)).not.toEqual(previous)
    expect(new Set(shuffled.map((entry) => entry.id))).toEqual(new Set(previous))
  })
})
