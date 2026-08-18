export const PREVIEW_Z = {
  background: 0,
  main: 1_000,
  overlay: 2_000,
  text: 3_000,
  editor: 4_000,
} as const

/** Arrays are stored back-to-front: the last item is the frontmost item. */
export const overlayPreviewZ = (index: number) => PREVIEW_Z.overlay + index

/** Text is exported after every media overlay, so it always occupies a higher band. */
export const textPreviewZ = (index: number) => PREVIEW_Z.text + index

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
