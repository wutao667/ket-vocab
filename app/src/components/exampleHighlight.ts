/**
 * 在例句里高亮当前单词。
 *
 * 难点在于词条形态和例句用法常常不一致：
 *   look after      → 例句是 "looks after"（第三人称单数）
 *   break           → 例句是 "broke"（不规则过去式）
 *   smart (stylish) → 词条带语义标注，例句里只有 "smart"
 *   a/an            → 斜杠表示两种写法
 *   a.m.            → 带句点的缩写
 *
 * 处理策略：先把词条归一成可匹配的候选形式，再在例句中找出最长匹配片段。
 * 匹配不到就原样显示例句，不强行高亮（宁可不高亮，也不要高亮错的地方）。
 */

const IRREGULAR: Record<string, string[]> = {
  be: ['is', 'are', 'was', 'were', 'been', 'being', 'am'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  get: ['gets', 'got', 'gotten', 'getting'],
  make: ['makes', 'made', 'making'],
  take: ['takes', 'took', 'taken', 'taking'],
  come: ['comes', 'came', 'coming'],
  see: ['sees', 'saw', 'seen', 'seeing'],
  eat: ['eats', 'ate', 'eaten', 'eating'],
  buy: ['buys', 'bought', 'buying'],
  think: ['thinks', 'thought', 'thinking'],
  give: ['gives', 'gave', 'given', 'giving'],
  put: ['puts', 'putting'],
  sit: ['sits', 'sat', 'sitting'],
  run: ['runs', 'ran', 'running'],
  swim: ['swims', 'swam', 'swum', 'swimming'],
  write: ['writes', 'wrote', 'written', 'writing'],
  read: ['reads', 'reading'],
  speak: ['speaks', 'spoke', 'spoken', 'speaking'],
  meet: ['meets', 'met', 'meeting'],
  win: ['wins', 'won', 'winning'],
  lose: ['loses', 'lost', 'losing'],
  find: ['finds', 'found', 'finding'],
  tell: ['tells', 'told', 'telling'],
  say: ['says', 'said', 'saying'],
  feel: ['feels', 'felt', 'feeling'],
  leave: ['leaves', 'left', 'leaving'],
  sleep: ['sleeps', 'slept', 'sleeping'],
  teach: ['teaches', 'taught', 'teaching'],
  learn: ['learns', 'learnt', 'learned', 'learning'],
  bring: ['brings', 'brought', 'bringing'],
  catch: ['catches', 'caught', 'catching'],
  fall: ['falls', 'fell', 'fallen', 'falling'],
  drink: ['drinks', 'drank', 'drunk', 'drinking'],
  ride: ['rides', 'rode', 'ridden', 'riding'],
  drive: ['drives', 'drove', 'driven', 'driving'],
  fly: ['flies', 'flew', 'flown', 'flying'],
  sing: ['sings', 'sang', 'sung', 'singing'],
  wear: ['wears', 'wore', 'worn', 'wearing'],
  begin: ['begins', 'began', 'begun', 'beginning'],
  break: ['breaks', 'broke', 'broken', 'breaking'],
  choose: ['chooses', 'chose', 'chosen', 'choosing'],
  pay: ['pays', 'paid', 'paying'],
  drop: ['drops', 'dropped', 'dropping'],
  fill: ['fills', 'filled', 'filling'],
  can: ['could', 'cannot', "can't"],
  cannot: ["can't", 'could'],
  will: ['would', "won't", "'ll"],
  shall: ['should'],
  may: ['might'],
}

const VOWELS = new Set('aeiou'.split(''))

function wordForms(raw: string): string[] {
  const w = raw.toLowerCase()
  const forms = new Set<string>([w])
  for (const form of IRREGULAR[w] ?? []) forms.add(form)

  if (w.endsWith('y') && w.length > 2 && !VOWELS.has(w[w.length - 2])) {
    forms.add(`${w.slice(0, -1)}ies`)
    forms.add(`${w.slice(0, -1)}ied`)
  }
  if (/(s|x|ch|sh|zz)$/.test(w)) forms.add(`${w}es`)
  if (w.endsWith('o')) forms.add(`${w}es`)
  forms.add(`${w}s`)
  forms.add(`${w}ed`)
  forms.add(`${w}ing`)
  if (w.endsWith('e')) {
    forms.add(`${w}d`)
    forms.add(`${w.slice(0, -1)}ing`)
  }
  if (w.length > 3 && !VOWELS.has(w[w.length - 1]) && VOWELS.has(w[w.length - 2]) && !VOWELS.has(w[w.length - 3])) {
    forms.add(`${w}${w[w.length - 1]}ed`)
    forms.add(`${w}${w[w.length - 1]}ing`)
  }
  return [...forms].filter(Boolean)
}

/** 把词条拆成若干「可独立匹配的词元」，如 look after → [look, after] */
function headwordParts(word: string): string[][] {
  // 去掉括号里的语义标注：(stylish)、(PLANNING)、(Br Eng)…
  const stripped = word.replace(/\([^)]*\)/g, ' ').trim()
  // 斜杠是二选一
  const variants = stripped.split('/').map((part) => part.trim()).filter(Boolean)
  // 每个变体再按空格拆词，每个词给出所有变形
  return variants.map((variant) =>
    variant.split(/\s+/).filter(Boolean).map((piece) => piece.replace(/[!?.,]/g, '')),
  )
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface HighlightSegment {
  text: string
  hit: boolean
}

/**
 * 把例句切成片段，标记哪些片段匹配当前词条。
 * 多词条目整段高亮（如 "looks after"），不是只高亮其中一个词。
 */
export function splitExample(example: string, word: string): HighlightSegment[] {
  if (!example || !word) return [{ text: example, hit: false }]

  const patterns: RegExp[] = []
  for (const parts of headwordParts(word)) {
    if (!parts.length) continue
    const body = parts
      .map((piece) => {
        const forms = wordForms(piece).sort((a, b) => b.length - a.length)
        return `(?:${forms.map(escapeRegExp).join('|')})`
      })
      .join('\\s+')
    patterns.push(new RegExp(`\\b${body}\\b`, 'gi'))
  }

  // 收集所有匹配区间
  const spans: Array<[number, number]> = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(example)) !== null) {
      if (match[0]) spans.push([match.index, match.index + match[0].length])
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1
    }
  }
  if (!spans.length) return [{ text: example, hit: false }]

  // 合并重叠区间，避免嵌套高亮
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }

  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: example.slice(cursor, start), hit: false })
    segments.push({ text: example.slice(start, end), hit: true })
    cursor = end
  }
  if (cursor < example.length) segments.push({ text: example.slice(cursor), hit: false })
  return segments
}
