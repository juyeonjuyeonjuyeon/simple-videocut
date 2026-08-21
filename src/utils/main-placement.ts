import type { Crop, Rotation } from '../types'
import { NO_CROP } from '../types'

export interface MainCanvasPlacementSource {
  rotate?: Rotation
  crop?: Crop
  canvasX?: number
  canvasY?: number
  /** Scale relative to the source's automatic contained size. */
  canvasScale?: number
  /** Independent vertical scale relative to the automatic contained height. */
  canvasScaleY?: number
  canvasAspectLocked?: boolean
  canvasAngle?: number
}

export interface ResolvedMainPlacement {
  x: number
  y: number
  width: number
  height: number
  angle: number
  baseWidth: number
  baseHeight: number
}

const finiteOr = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function mainVisualAspect(source: MainCanvasPlacementSource, sourceWidth: number, sourceHeight: number): number {
  const crop = source.crop ?? NO_CROP
  const croppedWidth = Math.max(1, finiteOr(sourceWidth, 1) * Math.max(0.01, 1 - crop.left - crop.right))
  const croppedHeight = Math.max(1, finiteOr(sourceHeight, 1) * Math.max(0.01, 1 - crop.top - crop.bottom))
  const aspect = croppedWidth / croppedHeight
  return source.rotate === 90 || source.rotate === 270 ? 1 / aspect : aspect
}

export function resolveMainPlacement(
  source: MainCanvasPlacementSource,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): ResolvedMainPlacement {
  const safeFrameWidth = Math.max(1, finiteOr(frameWidth, 1))
  const safeFrameHeight = Math.max(1, finiteOr(frameHeight, 1))
  const aspect = mainVisualAspect(source, sourceWidth, sourceHeight)
  let baseWidth = safeFrameWidth
  let baseHeight = baseWidth / aspect
  if (baseHeight > safeFrameHeight) {
    baseHeight = safeFrameHeight
    baseWidth = baseHeight * aspect
  }

  const scale = clamp(finiteOr(source.canvasScale, 1), 0.05, 3)
  const locked = source.canvasAspectLocked ?? true
  const scaleY = locked ? scale : clamp(finiteOr(source.canvasScaleY, scale), 0.05, 3)
  return {
    x: clamp(finiteOr(source.canvasX, 0.5), 0, 1) * safeFrameWidth,
    y: clamp(finiteOr(source.canvasY, 0.5), 0, 1) * safeFrameHeight,
    width: baseWidth * scale,
    height: baseHeight * scaleY,
    angle: clamp(finiteOr(source.canvasAngle, 0), -180, 180),
    baseWidth,
    baseHeight,
  }
}
