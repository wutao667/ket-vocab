import { describe, expect, it } from 'vitest'
import { indexForAnchor, indexForScrollTop } from './useScrollMemory'

describe('stable scroll anchors', () => {
  it('stores the nearest row with at most half-row error', () => {
    expect(indexForScrollTop(37 * 64 + 33, 100, 64)).toBe(38)
    expect(Math.abs(38 * 64 - (37 * 64 + 33))).toBeLessThanOrEqual(64)
  })
  it('restores by stable ID even if preceding data moves', () => {
    expect(indexForAnchor(['new', 'a', 'anchor', 'b'], 'anchor')).toBe(2)
    expect(indexForAnchor(['a', 'anchor', 'b'], 'anchor')).toBe(1)
  })
})
