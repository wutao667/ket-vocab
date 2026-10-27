import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 词库构建脚本（A2 方案：一套代码、两个应用）
 *
 * 用法：
 *   node scripts/build-data.mjs ket   → 读 data/ket_*，写 src/data/vocab.json
 *   node scripts/build-data.mjs pet   → 读 data/pet/pet_*，写 src/data/vocab.json
 *
 * 两个应用共用 app/src/data/vocabulary.ts 与同一套组件，
 * 差异只在词库内容与 ID 前缀，因此构建产物文件路径固定不变——
 * 每次构建前由 npm script 按目标应用重新生成即可。
 */

const APP = (process.argv[2] || process.env.APP_ID || 'ket').toLowerCase()
if (APP !== 'ket' && APP !== 'pet') throw new Error(`未知应用：${APP}（只接受 ket 或 pet）`)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataRoot = resolve(root, '../data')
const outputRoot = resolve(root, 'src/data')
const mapPath = resolve(root, `scripts/vocab-id-map.${APP}.json`)

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

/** 各应用的数据源与 ID 前缀 */
const SOURCES = {
  ket: {
    prefix: 'ket',
    vocab: resolve(dataRoot, 'ket_vocab_dataset.json'),
    topics: resolve(dataRoot, 'a2key_topics.json'),
    mapping: resolve(dataRoot, 'topic_mapping.json'),
    // 主题映射里「只出现在主题表、主词库没有」的词单独存放
    mappingKey: 'mapping',
  },
  pet: {
    prefix: 'pet',
    vocab: resolve(dataRoot, 'pet/pet_vocab_dataset.json'),
    topics: resolve(dataRoot, 'pet/pet_topics.json'),
    mapping: resolve(dataRoot, 'pet/pet_topic_mapping.json'),
    mappingKey: 'mapping',
  },
}

const source = SOURCES[APP]
const vocab = await readJson(source.vocab)
const sourceTopics = await readJson(source.topics)
const topicMapping = await readJson(source.mapping)

let frozen = { nextNumber: 1, entries: {} }
try {
  frozen = await readJson(mapPath)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

// ID 一旦分配就必须永久稳定：用户数据只存 ID，重排会让所有历史列表错位。
// 因此用「单词」作为主键查已分配表，查不到才发新号。
const duplicateWords = new Set()
const seen = new Set()
for (const entry of vocab) {
  if (seen.has(entry.word)) duplicateWords.add(entry.word)
  seen.add(entry.word)
}
if (duplicateWords.size) {
  throw new Error(`Duplicate word identities require an explicit migration: ${[...duplicateWords].join(', ')}`)
}

const entries = {}
for (const entry of vocab) {
  if (!frozen.entries[entry.word]) {
    frozen.entries[entry.word] = `${source.prefix}-${String(frozen.nextNumber).padStart(4, '0')}`
    frozen.nextNumber += 1
  }
  entries[entry.word] = frozen.entries[entry.word]
}
frozen.entries = entries

// 只保留运行时真正用到的字段。
// source_* 是构建期的溯源信息，界面从不读取，留着会让首屏包大 140KB+。
const RUNTIME_FIELDS = ['word', 'pos', 'ipa', 'zh', 'example', 'example_zh']
const generatedVocab = vocab.map((entry) => {
  const runtime = {}
  for (const field of RUNTIME_FIELDS) runtime[field] = entry[field] ?? ''
  return { id: entries[entry.word], ...runtime }
})

const idsByWord = new Map()
for (const entry of generatedVocab) {
  const bucket = idsByWord.get(entry.word) ?? []
  bucket.push(entry.id)
  idsByWord.set(entry.word, bucket)
}

const mappingByTopic = new Map(sourceTopics.map(({ topic }) => [topic, []]))
let unmapped = 0
for (const item of topicMapping[source.mappingKey]) {
  const bucket = mappingByTopic.get(item.topic)
  if (!bucket) throw new Error(`Unknown topic in mapping: ${item.topic}`)
  for (const word of item.vocab_words) {
    const ids = idsByWord.get(word)
    if (!ids?.length) { unmapped += 1; continue }
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
// 同时记下本次产物属于哪个应用。
// 测试环境没有 VITE_APP_ID，单靠 import.meta.env 判断会拿到默认值 ket，
// 而 vocab.json 可能正是 PET 的产物，断言就会假失败（实测踩过）。
// 让产物自带身份，测试直接读它，结果就与运行环境无关。
await writeFile(resolve(outputRoot, 'meta.json'), `${JSON.stringify({
  appId: APP,
  idPrefix: source.prefix,
  wordCount: generatedVocab.length,
  topicCount: topics.length,
}, null, 2)}\n`)

const ids = generatedVocab.map(({ id }) => id)
if (new Set(ids).size !== vocab.length) throw new Error('Generated IDs are not unique')
console.log(`[${APP}] Generated ${generatedVocab.length} vocabulary records (${ids[0]} … ${ids.at(-1)})`)
console.log(`[${APP}] Generated ${topics.length} topics (${topics.reduce((sum, topic) => sum + topic.vocabIds.length, 0)} links, ${unmapped} unmapped words skipped)`)
