import { describe, expect, it } from 'vitest'
import topics from './topics.json'
import vocab from './vocab.json'
import { config } from '../config/app-config'

/**
 * 词库产物自检。
 *
 * 断言值全部来自 config，而不是写死 1723 / ket-0001：
 * 同一份测试要同时守护 KET（1723 词）与 PET（3099 词）两个构建。
 */
describe('generated data', () => {
  const total = config.wordCount
  const prefix = config.idPrefix

  it(`has ${total} unique continuous frozen IDs`, () => {
    expect(vocab).toHaveLength(total)
    expect(vocab[0].id).toBe(`${prefix}-0001`)
    expect(vocab.at(-1)?.id).toBe(`${prefix}-${String(total).padStart(4, '0')}`)
    expect(new Set(vocab.map(({ id }) => id)).size).toBe(total)
    expect(vocab.every(({ id }, index) => id === `${prefix}-${String(index + 1).padStart(4, '0')}`)).toBe(true)
  })

  it('contains non-empty themes with valid vocabulary IDs', () => {
    const ids = new Set(vocab.map(({ id }) => id))
    expect(topics.length).toBeGreaterThan(0)
    expect(topics.every((topic) => topic.vocabIds.length > 0 && topic.vocabIds.every((id) => ids.has(id)))).toBe(true)
  })

  it('has no missing runtime fields', () => {
    const missing = vocab.filter((entry) =>
      ['word', 'pos', 'ipa', 'zh', 'example', 'example_zh'].some((field) => !entry[field as keyof typeof entry]))
    expect(missing).toEqual([])
  })
})
