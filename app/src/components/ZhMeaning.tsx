/**
 * 中文释义里的词性标记（名./动./形.…）用不同颜色显示。
 *
 * 词库里的 `zh` 形如 "限. 一个、一件" 或 "副. 大约、四处；介. 在…周围"，
 * 多个义项用 `；` 分隔。这里把它们拆开，只给词性标记上色，
 * 释义正文保持原色，避免整行花掉。
 */
const POS_LABELS = ['名', '动', '形', '副', '介', '连', '代', '限', '叹', '助', '数', '量', 'abbr']

const LABEL_RE = new RegExp(`^\\s*(${POS_LABELS.join('|')})\\.\\s*`)

export function ZhMeaning({ zh, className = '', labelClassName = 'text-sky-600 font-semibold' }: {
  zh: string
  className?: string
  /** 词性标记的额外样式；默认蓝色加粗 */
  labelClassName?: string
}) {
  if (!zh) return null
  const segments = zh.split('；')
  return <span className={className}>
    {segments.map((segment, index) => {
      const match = LABEL_RE.exec(segment)
      const separator = index > 0 ? '；' : ''
      if (!match) {
        return <span key={index}>{separator}{segment}</span>
      }
      const label = `${match[1]}.`
      const body = segment.slice(match[0].length)
      return <span key={index}>
        {separator}
        <span className={labelClassName}>{label}</span>
        {body ? ` ${body}` : ''}
      </span>
    })}
  </span>
}
