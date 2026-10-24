export interface SelectionGesture {
  snapshot: Set<string>
  visited: Set<number>
  target: boolean
  pointerId: number
  clientY: number
  changed: number
  /** 本次手势扫过的索引区间，用于把范围回填到序号输入框 */
  minIndex: number
  maxIndex: number
}

export function beginGesture(snapshot: Set<string>, startId: string, pointerId: number, clientY: number): SelectionGesture {
  return {
    snapshot: new Set(snapshot), visited: new Set(), target: !snapshot.has(startId),
    pointerId, clientY, changed: 0, minIndex: Infinity, maxIndex: -Infinity,
  }
}

export function visitGesture(gesture: SelectionGesture, index: number, id: string): boolean | null {
  if (gesture.visited.has(index)) return null
  gesture.visited.add(index)
  if (index < gesture.minIndex) gesture.minIndex = index
  if (index > gesture.maxIndex) gesture.maxIndex = index
  if (gesture.snapshot.has(id) !== gesture.target) gesture.changed += 1
  return gesture.target
}
