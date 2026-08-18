import type { PositionKeyframe } from '../types'

type PositionSource = { x: number; y: number; positionKeyframes?: PositionKeyframe[] }

const sorted = (frames: PositionKeyframe[]) => [...frames].sort((a, b) => a.time - b.time)
const smoothstep = (value: number) => value * value * (3 - 2 * value)

/** Resolve the same position used by the live preview at a layer-local time. */
export function positionAt(item: PositionSource, localTime: number): { x: number; y: number } {
  const frames = sorted(item.positionKeyframes ?? [])
  if (!frames.length) return { x: item.x, y: item.y }
  if (localTime <= frames[0].time) return { x: frames[0].x, y: frames[0].y }
  const last = frames[frames.length - 1]
  if (localTime >= last.time) return { x: last.x, y: last.y }

  for (let index = 0; index < frames.length - 1; index++) {
    const from = frames[index]
    const to = frames[index + 1]
    if (localTime > to.time) continue
    const span = Math.max(0.001, to.time - from.time)
    let progress = Math.max(0, Math.min(1, (localTime - from.time) / span))
    if (from.easing === 'ease-in-out') progress = smoothstep(progress)
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    }
  }
  return { x: last.x, y: last.y }
}

const num = (value: number) => Number(value.toFixed(6)).toString()

/**
 * Build a bounded FFmpeg expression matching `positionAt`.
 * `timeExpression` is layer-local (for example `t-2.5`).
 */
export function positionExpression(
  item: PositionSource,
  field: 'x' | 'y',
  timeExpression: string,
): string {
  const frames = sorted(item.positionKeyframes ?? [])
  if (!frames.length) return num(item[field])
  if (frames.length === 1) return num(frames[0][field])

  let expression = num(frames[frames.length - 1][field])
  for (let index = frames.length - 2; index >= 0; index--) {
    const from = frames[index]
    const to = frames[index + 1]
    const span = Math.max(0.001, to.time - from.time)
    const raw = `((${timeExpression})-${num(from.time)})/${num(span)}`
    const progress = from.easing === 'ease-in-out'
      ? `((${raw})*(${raw})*(3-2*(${raw})))`
      : `(${raw})`
    const segment = `(${num(from[field])}+(${num(to[field])}-${num(from[field])})*${progress})`
    expression = `if(lt((${timeExpression}),${num(to.time)}),${segment},${expression})`
  }
  return `if(lte((${timeExpression}),${num(frames[0].time)}),${num(frames[0][field])},${expression})`
}

export function keyframeAt(frames: PositionKeyframe[] | undefined, time: number, tolerance = 0.04) {
  return frames?.find((frame) => Math.abs(frame.time - time) <= tolerance) ?? null
}
