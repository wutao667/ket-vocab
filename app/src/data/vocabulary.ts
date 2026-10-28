import vocabJson from './vocab.json'
import topicsJson from './topics.json'
import type { Topic, VocabEntry } from './types'

export const vocabulary = vocabJson as VocabEntry[]
export const topics = topicsJson as Topic[]
/** 词库是否带主题分组。TOEFL 是纯 A–Z 词表，依赖主题的排序要按此隐藏。 */
export const hasTopics = topics.length > 0
export const vocabById = new Map(vocabulary.map((entry) => [entry.id, entry]))
export const topicOrder = new Map(topics.flatMap((topic, topicIndex) => topic.vocabIds.map((id, wordIndex) => [id, topicIndex * 10000 + wordIndex] as const)))

export function entriesFor(ids: string[]) {
  return ids.map((id) => vocabById.get(id)).filter((entry): entry is VocabEntry => Boolean(entry))
}
