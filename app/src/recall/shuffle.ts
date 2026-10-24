import type { VocabEntry } from '../data/types'

export function shuffleForRecall(entries: VocabEntry[], previousOrder: string[] = [], random: () => number = Math.random) {
  const shuffled = [...entries]
  for (let current = shuffled.length - 1; current > 0; current -= 1) {
    const target = Math.floor(random() * (current + 1))
    ;[shuffled[current], shuffled[target]] = [shuffled[target], shuffled[current]]
  }
  if (shuffled.length > 1 && shuffled.every((entry, position) => entry.id === previousOrder[position])) {
    ;[shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]]
  }
  return shuffled
}
