import { describe, expect, it } from 'vitest'
import { beginGesture, visitGesture } from './gesture'

describe('swipe selection gesture', () => {
  it('selects 20 rows once even when rows are crossed repeatedly', () => {
    const gesture = beginGesture(new Set(), 'id-0', 1, 100)
    const applied: string[] = []
    for (const index of [...Array.from({ length: 20 }, (_, value) => value), 9, 8, 9, 19]) {
      const target = visitGesture(gesture, index, `id-${index}`)
      if (target !== null) applied.push(`id-${index}:${target}`)
    }
    expect(gesture.target).toBe(true)
    expect(gesture.visited.size).toBe(20)
    expect(gesture.changed).toBe(20)
    expect(applied).toHaveLength(20)
  })

  it('locks cancel as the target when starting from a selected row', () => {
    const selected = new Set(Array.from({ length: 20 }, (_, index) => `id-${index}`))
    const gesture = beginGesture(selected, 'id-0', 1, 100)
    const values = Array.from({ length: 20 }, (_, index) => visitGesture(gesture, index, `id-${index}`))
    expect(gesture.target).toBe(false)
    expect(values).toEqual(Array(20).fill(false))
    expect(gesture.changed).toBe(20)
  })

  it('keeps an undo snapshot isolated from later changes', () => {
    const selected = new Set(['old'])
    const gesture = beginGesture(selected, 'new', 1, 100)
    selected.add('later')
    expect([...gesture.snapshot]).toEqual(['old'])
  })
})

describe('gesture index bounds', () => {
  it('tracks the min and max index swept by the gesture', () => {
    const gesture = beginGesture(new Set(), 'id-3', 1, 100)
    for (const index of [3, 4, 5, 9, 12, 7, 2]) visitGesture(gesture, index, `id-${index}`)
    expect(gesture.minIndex).toBe(2)
    expect(gesture.maxIndex).toBe(12)
  })

  it('starts with an empty interval before any cell is visited', () => {
    const gesture = beginGesture(new Set(), 'id-0', 1, 100)
    expect(gesture.minIndex).toBe(Infinity)
    expect(gesture.maxIndex).toBe(-Infinity)
  })
})
