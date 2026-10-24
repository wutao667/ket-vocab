export interface VocabEntry {
  id: string
  word: string
  pos: string
  ipa: string
  zh: string
  example: string
  example_zh: string
  source_ipa: string
  source_example: string
  source_example_zh: string
}

export interface Topic { id: string; name: string; vocabIds: string[] }
