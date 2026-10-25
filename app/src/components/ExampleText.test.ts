import { describe, expect, it } from 'vitest'
import { splitExample } from './exampleHighlight'

/** 把片段拼回原句，确认没有丢字或重复 */
function rebuild(segments: Array<{ text: string }>) {
  return segments.map((s) => s.text).join('')
}
/** 取出所有被高亮的片段 */
function hits(segments: Array<{ text: string; hit: boolean }>) {
  return segments.filter((s) => s.hit).map((s) => s.text)
}

describe('splitExample', () => {
  it('highlights an exact word match', () => {
    const segments = splitExample('The picnic was called off because of rain.', 'picnic')
    expect(hits(segments)).toEqual(['picnic'])
    expect(rebuild(segments)).toBe('The picnic was called off because of rain.')
  })

  it('highlights an inflected form (third person singular)', () => {
    const segments = splitExample('My sister looks after the baby on Fridays.', 'look after')
    expect(hits(segments)).toEqual(['looks after'])
  })

  it('highlights an irregular past form', () => {
    const segments = splitExample('A fire broke out in the neighborhood yesterday.', 'break')
    expect(hits(segments)).toEqual(['broke'])
  })

  it('highlights another irregular form (buy → bought)', () => {
    const segments = splitExample('Show me the doll that you bought yesterday.', 'buy')
    expect(hits(segments)).toEqual(['bought'])
  })

  it('ignores a parenthetical sense annotation', () => {
    const segments = splitExample('You look smart in that new jacket.', 'smart (stylish)')
    expect(hits(segments)).toEqual(['smart'])
  })

  it('handles slash alternatives without matching the slash itself', () => {
    const segments = splitExample('I would like a cup of tea, please.', 'a/an')
    expect(rebuild(segments)).toBe('I would like a cup of tea, please.')
    expect(hits(segments).length).toBeGreaterThan(0)
  })

  it('matches only whole words, never inside a larger word', () => {
    // "act" 不应命中 "actually" 里的 act
    const segments = splitExample('He actually agreed with me.', 'act')
    expect(hits(segments)).toEqual([])
  })

  it('returns the sentence unchanged when nothing matches', () => {
    const segments = splitExample('Completely unrelated sentence.', 'zebra')
    expect(hits(segments)).toEqual([])
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Completely unrelated sentence.')
  })

  it('handles empty inputs without throwing', () => {
    expect(splitExample('', 'word')).toEqual([{ text: '', hit: false }])
    expect(splitExample('Some sentence.', '')).toEqual([{ text: 'Some sentence.', hit: false }])
  })
})
