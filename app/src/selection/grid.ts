import type { VocabEntry } from '../data/types'

export type GridItem =
  | { type: 'row'; key: string; startIndex: number; words: VocabEntry[] }
  | { type: 'divider'; key: string; after: number; from: number; to: number; major: boolean }

export function buildGridItems(vocabulary: VocabEntry[]): GridItem[] {
  const items: GridItem[] = []
  for (let startIndex = 0; startIndex < vocabulary.length; startIndex += 10) {
    const words = vocabulary.slice(startIndex, startIndex + 10)
    items.push({ type: 'row', key: `row-${startIndex}`, startIndex, words })
    const after = startIndex + words.length
    if (after % 50 === 0 && after < vocabulary.length) {
      const major = after % 100 === 0
      items.push({
        type: 'divider',
        key: `divider-${after}`,
        after,
        from: after + 1,
        to: Math.min(vocabulary.length, after + (major ? 100 : 50)),
        major,
      })
    }
  }
  return items
}
