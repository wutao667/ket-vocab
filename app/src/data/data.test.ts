import { describe, expect, it } from 'vitest'
import topics from './topics.json'
import vocab from './vocab.json'

describe('generated data', () => {
  it('has 1723 unique continuous frozen IDs', () => {
    expect(vocab).toHaveLength(1723)
    expect(vocab[0].id).toBe('ket-0001'); expect(vocab.at(-1)?.id).toBe('ket-1723')
    expect(new Set(vocab.map(({ id }) => id)).size).toBe(1723)
    expect(vocab.every(({ id }, index) => id === `ket-${String(index + 1).padStart(4, '0')}`)).toBe(true)
  })
  it('contains all 25 non-empty themes with valid vocabulary IDs', () => {
    const ids = new Set(vocab.map(({ id }) => id))
    expect(topics).toHaveLength(25)
    expect(topics.every((topic) => topic.vocabIds.length > 0 && topic.vocabIds.every((id) => ids.has(id)))).toBe(true)
  })
})
