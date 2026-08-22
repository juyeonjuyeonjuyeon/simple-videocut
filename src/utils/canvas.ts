import type { AspectRatio, CanvasDimensions } from '../types'

export const CANVAS_MIN_SIDE = 64
export const CANVAS_MAX_WIDTH = 7680
export const CANVAS_MAX_HEIGHT = 4320

export const CANVAS_PRESETS: ReadonlyArray<{ id: Exclude<AspectRatio, 'custom'>; label: string }> = [
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '4:5', label: '4:5' },
  { id: '5:4', label: '5:4' },
  { id: '21:9', label: '21:9' },
  { id: '2:1', label: '2:1' },
]

const PRESET_RATIO = Object.fromEntries(CANVAS_PRESETS.map(({ id }) => {
  const [width, height] = id.split(':').map(Number)
  return [id, width / height]
})) as Record<Exclude<AspectRatio, 'custom'>, number>

const even = (value: number) => Math.round(value / 2) * 2
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function normalizeCanvasDimensions(width: number, height: number): CanvasDimensions {
  return {
    width: even(clamp(Number.isFinite(width) ? width : 1280, CANVAS_MIN_SIDE, CANVAS_MAX_WIDTH)),
    height: even(clamp(Number.isFinite(height) ? height : 720, CANVAS_MIN_SIDE, CANVAS_MAX_HEIGHT)),
  }
}

export function canvasDimensionsForPreset(ratio: Exclude<AspectRatio, 'custom'>, height: number): CanvasDimensions {
  const normalizedHeight = normalizeCanvasDimensions(CANVAS_MIN_SIDE, height).height
  return normalizeCanvasDimensions(normalizedHeight * PRESET_RATIO[ratio], normalizedHeight)
}

export function canvasRatio(aspect: AspectRatio, dimensions: CanvasDimensions): number {
  return aspect === 'custom'
    ? dimensions.width / Math.max(1, dimensions.height)
    : PRESET_RATIO[aspect]
}

export function scaledCanvasDimensions(dimensions: CanvasDimensions, height: number): CanvasDimensions {
  const safe = normalizeCanvasDimensions(dimensions.width, dimensions.height)
  const normalizedHeight = normalizeCanvasDimensions(CANVAS_MIN_SIDE, height).height
  return normalizeCanvasDimensions(normalizedHeight * safe.width / safe.height, normalizedHeight)
}

export function canvasLabel(aspect: AspectRatio, dimensions: CanvasDimensions): string {
  return aspect === 'custom' ? `${dimensions.width}:${dimensions.height}` : aspect
}
