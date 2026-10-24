import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataRoot = resolve(root, '../data')
const outputRoot = resolve(root, 'src/data')
const mapPath = resolve(root, 'scripts/vocab-id-map.json')

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const vocab = await readJson(resolve(dataRoot, 'ket_vocab_dataset.json'))
const sourceTopics = await readJson(resolve(dataRoot, 'a2key_topics.json'))
const topicMapping = await readJson(resolve(dataRoot, 'topic_mapping.json'))

let frozen = { nextNumber: 1, entries: {} }
try { frozen = await readJson(mapPath) } catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const duplicateWords = vocab.filter((entry, index) => vocab.findIndex((candidate) => candidate.word === entry.word) !== index)
if (duplicateWords.length) throw new Error(`Duplicate word identities require an explicit migration: ${duplicateWords.map(({ word }) => word).join(', ')}`)
const legacyEntries = frozen.entries
const entries = {}

for (const entry of vocab) {
  const legacyPrefix = `${entry.word}\u241f${entry.pos}\u241f${entry.ipa}\u241f${entry.zh}\u241f1`
  entries[entry.word] = legacyEntries[entry.word] ?? legacyEntries[legacyPrefix]
  if (!entries[entry.word]) {
    entries[entry.word] = `ket-${String(frozen.nextNumber).padStart(4, '0')}`
    frozen.nextNumber += 1
  }
}
frozen.entries = entries

const generatedVocab = vocab.map((entry) => ({ id: frozen.entries[entry.word], ...entry }))
const idsByWord = new Map()
for (const entry of generatedVocab) {
  const bucket = idsByWord.get(entry.word) ?? []
  bucket.push(entry.id)
  idsByWord.set(entry.word, bucket)
}

const mappingByTopic = new Map(sourceTopics.map(({ topic }) => [topic, []]))
for (const mapping of topicMapping.mapping) {
  const bucket = mappingByTopic.get(mapping.topic)
  if (!bucket) throw new Error(`Unknown topic in mapping: ${mapping.topic}`)
  for (const word of mapping.vocab_words) {
    const ids = idsByWord.get(word)
    if (!ids?.length) throw new Error(`Mapped word missing from vocabulary: ${mapping.topic} / ${word}`)
    bucket.push(...ids)
  }
}

const topics = sourceTopics.map(({ topic }) => ({
  id: `topic-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
  name: topic,
  vocabIds: [...new Set(mappingByTopic.get(topic))],
}))

await mkdir(outputRoot, { recursive: true })
await writeFile(mapPath, `${JSON.stringify(frozen, null, 2)}\n`)
await writeFile(resolve(outputRoot, 'vocab.json'), `${JSON.stringify(generatedVocab, null, 2)}\n`)
await writeFile(resolve(outputRoot, 'topics.json'), `${JSON.stringify(topics, null, 2)}\n`)

const ids = generatedVocab.map(({ id }) => id)
if (new Set(ids).size !== vocab.length) throw new Error('Generated IDs are not unique')
console.log(`Generated ${generatedVocab.length} vocabulary records (${ids[0]} … ${ids.at(-1)})`)
console.log(`Generated ${topics.length} topics (${topics.reduce((sum, topic) => sum + topic.vocabIds.length, 0)} topic-vocabulary links)`)
