import type { MosaicRegion } from '../types'

export const DEFAULT_MOSAIC_REGION: MosaicRegion = {
  id: 'mosaic-1', x: 0.3, y: 0.3, width: 0.4, height: 0.4, pixelSize: 18,
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function sanitizeMosaicRegion(region: MosaicRegion): MosaicRegion {
  const width = clamp(Number.isFinite(region.width) ? region.width : 0.4, 0.03, 1)
  const height = clamp(Number.isFinite(region.height) ? region.height : 0.4, 0.03, 1)
  return {
    id: String(region.id || `mosaic-${Date.now()}`).slice(0, 100),
    x: clamp(Number.isFinite(region.x) ? region.x : 0.3, 0, 1 - width),
    y: clamp(Number.isFinite(region.y) ? region.y : 0.3, 0, 1 - height),
    width,
    height,
    pixelSize: Math.round(clamp(Number.isFinite(region.pixelSize) ? region.pixelSize : 18, 4, 80)),
  }
}

export function sanitizeMosaicRegions(regions: MosaicRegion[] | undefined): MosaicRegion[] {
  if (!Array.isArray(regions)) return []
  return regions.slice(0, 12).map(sanitizeMosaicRegion)
}

export function moveMosaicRegion(region: MosaicRegion, dx: number, dy: number): MosaicRegion {
  return sanitizeMosaicRegion({ ...region, x: region.x + dx, y: region.y + dy })
}

export type MosaicHandle = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l'

export function resizeMosaicRegion(region: MosaicRegion, handle: MosaicHandle, x: number, y: number): MosaicRegion {
  const right = region.x + region.width
  const bottom = region.y + region.height
  const movesLeft = handle.includes('l')
  const movesRight = handle.includes('r')
  const movesTop = handle.includes('t')
  const movesBottom = handle.includes('b')
  const left = movesLeft ? clamp(x, 0, right - 0.03) : region.x
  const top = movesTop ? clamp(y, 0, bottom - 0.03) : region.y
  const nextRight = movesRight ? clamp(x, left + 0.03, 1) : right
  const nextBottom = movesBottom ? clamp(y, top + 0.03, 1) : bottom
  return sanitizeMosaicRegion({ ...region, x: left, y: top, width: nextRight - left, height: nextBottom - top })
}
