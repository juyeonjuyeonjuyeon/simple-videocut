import type { Crop, Rotation } from '../types'

/** Build a CSS transform string for rotation + mirroring (+ free angle). */
export function cssTransform(rotate: Rotation, flipH: boolean, flipV: boolean, angle = 0): string {
  const parts: string[] = []
  const deg = (rotate || 0) + (angle || 0)
  if (deg) parts.push(`rotate(${deg}deg)`)
  if (flipH) parts.push('scaleX(-1)')
  if (flipV) parts.push('scaleY(-1)')
  return parts.join(' ')
}

/** Build a CSS clip-path inset() for the crop, or 'none'. */
export function cssClipPath(crop: Crop): string {
  if (!crop.top && !crop.right && !crop.bottom && !crop.left) return 'none'
  return `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
}

/**
 * CSS transform that scales the kept (cropped) region up so it FILLS the
 * container with no margins — the normal "crop result" look. Container clips the
 * overflow. Returns '' when there's no crop. Compose as `${fill} ${cssTransform}`.
 */
export function cssCropFill(crop: Crop): string {
  const { top: T, right: R, bottom: B, left: L } = crop
  if (!T && !R && !B && !L) return ''
  const keptW = Math.max(1e-3, 1 - L - R)
  const keptH = Math.max(1e-3, 1 - T - B)
  const s = Math.max(1 / keptW, 1 / keptH)
  const ccx = 0.5 + (L - R) / 2 // kept-region center, as a fraction of the box
  const ccy = 0.5 + (T - B) / 2
  const tx = -(ccx - 0.5) * s * 100
  const ty = -(ccy - 0.5) * s * 100
  return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${s.toFixed(4)})`
}

export function rotateBy(r: Rotation, delta: 90 | -90): Rotation {
  return (((r + delta + 360) % 360) as Rotation)
}
