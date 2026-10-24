import { describe, expect, it } from 'vitest'
import { parseRange } from '../selection/range'

describe('parseRange', () => {
  it('maps 1-20 to zero-based inclusive indexes', () => expect(parseRange('1-20', 25)).toEqual([0, 19]))
  it('rejects a reversed range with a specific message', () => expect(() => parseRange('20-1', 25)).toThrow('起始序号 20 不能大于结束序号 1'))
  it('rejects out of bounds and malformed values', () => {
    expect(() => parseRange('0-20', 25)).toThrow('1-25')
    expect(() => parseRange('one-two', 25)).toThrow('例如 21-40')
  })
})
