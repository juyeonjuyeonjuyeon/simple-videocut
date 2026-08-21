import type { TextOverlay, Overlay, VisualLayerRef } from '../types'

export const PREVIEW_Z = {
  background: 0,
  main: 1_000,
  overlay: 2_000,
  text: 3_000,
  editor: 4_000,
} as const

const visualKey = (item: VisualLayerRef) => `${item.type}:${item.id}`

/**
 * Return one complete back-to-front visual stack. Old projects do not contain
 * this field, so their former ordering (overlays, then text) is preserved.
 */
export function normalizeVisualOrder(
  overlays: Pick<Overlay, 'id'>[],
  texts: Pick<TextOverlay, 'id'>[],
  order: VisualLayerRef[] = [],
): VisualLayerRef[] {
  const available = new Map<string, VisualLayerRef>([
    ...overlays.map((item) => [`overlay:${item.id}`, { type: 'overlay' as const, id: item.id }] as const),
    ...texts.map((item) => [`text:${item.id}`, { type: 'text' as const, id: item.id }] as const),
  ])
  const result: VisualLayerRef[] = []
  const used = new Set<string>()
  for (const item of order) {
    const key = visualKey(item)
    const current = available.get(key)
    if (current && !used.has(key)) {
      result.push(current)
      used.add(key)
    }
  }
  for (const item of [...overlays.map((entry) => ({ type: 'overlay' as const, id: entry.id })), ...texts.map((entry) => ({ type: 'text' as const, id: entry.id }))]) {
    const key = visualKey(item)
    if (!used.has(key)) result.push(item)
  }
  return result
}

/** Arrays are stored back-to-front: the last item is the frontmost item. */
export const visualPreviewZ = (order: VisualLayerRef[], item: VisualLayerRef) => {
  const index = order.findIndex((entry) => visualKey(entry) === visualKey(item))
  return PREVIEW_Z.overlay + Math.max(0, index)
}

/**
 * Pack visual items into compact timeline rows while preserving their stack:
 * row 0 is the top row, so the frontmost overlapping item is placed there.
 */
export function packVisualLanes(spans: { start: number; end: number }[]): number[] {
  const lanes: { start: number; end: number }[][] = []
  const laneOf = new Array(spans.length).fill(0)

  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index]
    let lane = lanes.findIndex((items) =>
      items.every((item) => span.end <= item.start + 1e-6 || span.start >= item.end - 1e-6),
    )
    if (lane < 0) {
      lane = lanes.length
      lanes.push([])
    }
    lanes[lane].push(span)
    laneOf[index] = lane
  }

  return laneOf
}
