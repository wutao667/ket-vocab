export function parseRange(value: string, total: number): [number, number] {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(value)
  if (!match) throw new Error('请输入“起始序号-结束序号”，例如 21-40。')
  const start = Number(match[1]); const end = Number(match[2])
  if (start > end) throw new Error(`起始序号 ${start} 不能大于结束序号 ${end}。`)
  if (start < 1 || end > total) throw new Error(`序号须在 1-${total} 范围内。`)
  return [start - 1, end - 1]
}
