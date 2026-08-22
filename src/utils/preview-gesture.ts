export interface GesturePoint {
  x: number
  y: number
}

const midpoint = (a: GesturePoint, b: GesturePoint): GesturePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

const angle = (a: GesturePoint, b: GesturePoint) => Math.atan2(b.y - a.y, b.x - a.x)

const normalizeRadians = (value: number) => {
  let result = value
  while (result > Math.PI) result -= Math.PI * 2
  while (result < -Math.PI) result += Math.PI * 2
  return result
}

/** Resolve one coherent translation, scale and rotation from a two-pointer gesture. */
export function resolveTwoPointerGesture(
  startA: GesturePoint,
  startB: GesturePoint,
  currentA: GesturePoint,
  currentB: GesturePoint,
) {
  const startCenter = midpoint(startA, startB)
  const currentCenter = midpoint(currentA, currentB)
  const startDistance = Math.max(1, Math.hypot(startB.x - startA.x, startB.y - startA.y))
  const currentDistance = Math.hypot(currentB.x - currentA.x, currentB.y - currentA.y)
  return {
    deltaX: currentCenter.x - startCenter.x,
    deltaY: currentCenter.y - startCenter.y,
    scale: currentDistance / startDistance,
    rotation: normalizeRadians(angle(currentA, currentB) - angle(startA, startB)) * 180 / Math.PI,
  }
}
