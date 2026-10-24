export interface SelectionGesture {
  snapshot: Set<string>
  visited: Set<number>
  target: boolean
  pointerId: number
  clientY: number
  changed: number
}

export function beginGesture(snapshot: Set<string>, startId: string, pointerId: number, clientY: number): SelectionGesture {
  return { snapshot: new Set(snapshot), visited: new Set(), target: !snapshot.has(startId), pointerId, clientY, changed: 0 }
}

export function visitGesture(gesture: SelectionGesture, index: number, id: string): boolean | null {
  if (gesture.visited.has(index)) return null
  gesture.visited.add(index)
  if (gesture.snapshot.has(id) !== gesture.target) gesture.changed += 1
  return gesture.target
}
