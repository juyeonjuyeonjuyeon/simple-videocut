import type { Crop } from '../types'

export type CropHandle = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export const cropSize = (crop: Crop) => ({
  width: Math.max(0, 1 - crop.left - crop.right),
  height: Math.max(0, 1 - crop.top - crop.bottom),
})

export function sanitizeCrop(input: Crop, minSize = 0.04): Crop {
  let left = clamp(Number.isFinite(input.left) ? input.left : 0, 0, 1)
  let right = clamp(Number.isFinite(input.right) ? input.right : 0, 0, 1)
  let top = clamp(Number.isFinite(input.top) ? input.top : 0, 0, 1)
  let bottom = clamp(Number.isFinite(input.bottom) ? input.bottom : 0, 0, 1)

  if (left + right > 1 - minSize) {
    const center = clamp((left + 1 - right) / 2, minSize / 2, 1 - minSize / 2)
    left = center - minSize / 2
    right = 1 - center - minSize / 2
  }
  if (top + bottom > 1 - minSize) {
    const center = clamp((top + 1 - bottom) / 2, minSize / 2, 1 - minSize / 2)
    top = center - minSize / 2
    bottom = 1 - center - minSize / 2
  }
  return { top, right, bottom, left }
}

export function moveCrop(input: Crop, dx: number, dy: number): Crop {
  const crop = sanitizeCrop(input)
  const { width, height } = cropSize(crop)
  const centerX = clamp((crop.left + 1 - crop.right) / 2 + dx, width / 2, 1 - width / 2)
  const centerY = clamp((crop.top + 1 - crop.bottom) / 2 + dy, height / 2, 1 - height / 2)
  return {
    left: centerX - width / 2,
    right: 1 - centerX - width / 2,
    top: centerY - height / 2,
    bottom: 1 - centerY - height / 2,
  }
}

/** Scale the kept crop area around its current center. Values below 1 zoom in. */
export function zoomCrop(input: Crop, factor: number, minSize = 0.04): Crop {
  const crop = sanitizeCrop(input, minSize)
  const current = cropSize(crop)
  const width = clamp(current.width * factor, minSize, 1)
  const height = clamp(current.height * factor, minSize, 1)
  const centerX = clamp((crop.left + 1 - crop.right) / 2, width / 2, 1 - width / 2)
  const centerY = clamp((crop.top + 1 - crop.bottom) / 2, height / 2, 1 - height / 2)
  return {
    left: centerX - width / 2,
    right: 1 - centerX - width / 2,
    top: centerY - height / 2,
    bottom: 1 - centerY - height / 2,
  }
}

/** Largest crop with the requested displayed aspect ratio, centered near the existing crop. */
export function cropForAspect(input: Crop, frameAspect: number, targetAspect: number): Crop {
  const crop = sanitizeCrop(input)
  const normalizedAspect = Math.max(0.01, targetAspect / Math.max(0.01, frameAspect))
  const width = normalizedAspect >= 1 ? 1 : normalizedAspect
  const height = normalizedAspect >= 1 ? 1 / normalizedAspect : 1
  const centerX = clamp((crop.left + 1 - crop.right) / 2, width / 2, 1 - width / 2)
  const centerY = clamp((crop.top + 1 - crop.bottom) / 2, height / 2, 1 - height / 2)
  return {
    left: centerX - width / 2,
    right: 1 - centerX - width / 2,
    top: centerY - height / 2,
    bottom: 1 - centerY - height / 2,
  }
}

export function resizeCrop(
  input: Crop,
  handle: CropHandle,
  pointerX: number,
  pointerY: number,
  frameAspect: number,
  targetAspect: number | null,
  minSize = 0.04,
): Crop {
  const crop = sanitizeCrop(input, minSize)
  let x0 = crop.left
  let x1 = 1 - crop.right
  let y0 = crop.top
  let y1 = 1 - crop.bottom
  const x = clamp(pointerX, 0, 1)
  const y = clamp(pointerY, 0, 1)
  const movesLeft = handle.includes('l')
  const movesRight = handle.includes('r')
  const movesTop = handle.includes('t')
  const movesBottom = handle.includes('b')

  if (targetAspect == null) {
    if (movesLeft) x0 = clamp(x, 0, x1 - minSize)
    if (movesRight) x1 = clamp(x, x0 + minSize, 1)
    if (movesTop) y0 = clamp(y, 0, y1 - minSize)
    if (movesBottom) y1 = clamp(y, y0 + minSize, 1)
    return sanitizeCrop({ left: x0, right: 1 - x1, top: y0, bottom: 1 - y1 }, minSize)
  }

  const normalizedAspect = Math.max(0.01, targetAspect / Math.max(0.01, frameAspect))
  const centerX = (x0 + x1) / 2
  const centerY = (y0 + y1) / 2
  const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom)

  if (isCorner) {
    const anchorX = movesLeft ? x1 : x0
    const anchorY = movesTop ? y1 : y0
    const rawWidth = Math.abs(x - anchorX)
    const rawHeight = Math.abs(y - anchorY)
    const minWidth = Math.max(minSize, minSize * normalizedAspect)
    const maxWidth = Math.min(movesLeft ? anchorX : 1 - anchorX, (movesTop ? anchorY : 1 - anchorY) * normalizedAspect)
    let width = (rawWidth + rawHeight / normalizedAspect) / (1 + 1 / (normalizedAspect * normalizedAspect))
    width = clamp(width, Math.min(minWidth, maxWidth), maxWidth)
    const height = width / normalizedAspect
    x0 = movesLeft ? anchorX - width : anchorX
    x1 = movesRight ? anchorX + width : anchorX
    y0 = movesTop ? anchorY - height : anchorY
    y1 = movesBottom ? anchorY + height : anchorY
  } else if (movesLeft || movesRight) {
    const anchorX = movesLeft ? x1 : x0
    const maxWidth = Math.min(movesLeft ? anchorX : 1 - anchorX, normalizedAspect)
    const width = clamp(Math.abs(x - anchorX), Math.min(minSize, maxWidth), maxWidth)
    const height = width / normalizedAspect
    x0 = movesLeft ? anchorX - width : anchorX
    x1 = movesRight ? anchorX + width : anchorX
    y0 = clamp(centerY - height / 2, 0, 1 - height)
    y1 = y0 + height
  } else {
    const anchorY = movesTop ? y1 : y0
    const maxHeight = Math.min(movesTop ? anchorY : 1 - anchorY, 1 / normalizedAspect)
    const height = clamp(Math.abs(y - anchorY), Math.min(minSize, maxHeight), maxHeight)
    const width = height * normalizedAspect
    y0 = movesTop ? anchorY - height : anchorY
    y1 = movesBottom ? anchorY + height : anchorY
    x0 = clamp(centerX - width / 2, 0, 1 - width)
    x1 = x0 + width
  }

  return sanitizeCrop({ left: x0, right: 1 - x1, top: y0, bottom: 1 - y1 }, minSize)
}
