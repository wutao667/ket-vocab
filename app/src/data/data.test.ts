import { describe, expect, it } from 'vitest'
import topics from './topics.json'
import vocab from './vocab.json'
import meta from './meta.json'

/**
 * 词库产物自检。
 *
 * 断言值全部来自产物自带的 meta.json，而不是写死 1723 / ket-0001：
 * 同一份测试要同时守护 KET（1723 词）/ PET（3099 词）/ TOEFL（5072 词）三个构建。
 * 不用 config 是因为测试环境没有 VITE_APP_ID，会退回默认值 ket 而误判。
 */
describe('generated data', () => {
  const total = meta.wordCount
  const prefix = meta.idPrefix
  // TOEFL 原始词表没有主题分组（纯 A–Z），topics.json 是空数组。
  // 类型断言成数组，避免空数组被 TS 推断为 never[] 导致后续取字段报错。
  const topicList = topics as { id: string; name: string; vocabIds: string[] }[]

  it(`has ${total} unique continuous frozen IDs`, () => {
    expect(vocab).toHaveLength(total)
    expect(vocab[0].id).toBe(`${prefix}-0001`)
    expect(vocab.at(-1)?.id).toBe(`${prefix}-${String(total).padStart(4, '0')}`)
    expect(new Set(vocab.map(({ id }) => id)).size).toBe(total)
    expect(vocab.every(({ id }, index) => id === `${prefix}-${String(index + 1).padStart(4, '0')}`)).toBe(true)
  })

  it('contains non-empty themes with valid vocabulary IDs', () => {
    const ids = new Set(vocab.map(({ id }) => id))
    expect(topicList).toHaveLength(meta.topicCount)
    // 没有主题的词库（TOEFL）跳过内容校验，但仍要保证文件结构与 meta 一致
    if (meta.topicCount === 0) return
    expect(topicList.every((topic) => topic.vocabIds.length > 0 && topic.vocabIds.every((id) => ids.has(id)))).toBe(true)
  })

  it('has no missing runtime fields', () => {
    const missing = vocab.filter((entry) =>
      ['word', 'pos', 'ipa', 'zh', 'example', 'example_zh'].some((field) => !entry[field as keyof typeof entry]))
    expect(missing).toEqual([])
  })
})
