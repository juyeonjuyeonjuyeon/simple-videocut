import type { Overlay, OverlayBorderStyle, OverlayMaskShape } from '../types'
import { hexToRgba } from './color'

export const OVERLAY_STYLE_DEFAULTS = {
  borderWidth: 0,
  borderColor: '#ffffff',
  borderStyle: 'solid' as OverlayBorderStyle,
  shadowEnabled: false,
  shadowColor: '#000000',
  shadowOpacity: 0.55,
  shadowBlur: 12 / 720,
  shadowX: 6 / 720,
  shadowY: 8 / 720,
  maskShape: 'none' as OverlayMaskShape,
}

export type ResolvedOverlayStyle = typeof OVERLAY_STYLE_DEFAULTS

const MASK_POINTS: Partial<Record<OverlayMaskShape, number[][]>> = {
  heart: [[.5,.94],[.42,.85],[.13,.58],[.05,.39],[.07,.22],[.18,.1],[.32,.08],[.43,.15],[.5,.26],[.57,.15],[.68,.08],[.82,.1],[.93,.22],[.95,.39],[.87,.58],[.58,.85]],
  star: [[.5,.03],[.61,.35],[.95,.36],[.68,.56],[.78,.91],[.5,.7],[.22,.91],[.32,.56],[.05,.36],[.39,.35]],
  hexagon: [[.25,.05],[.75,.05],[.98,.5],[.75,.95],[.25,.95],[.02,.5]],
}

const fittedShapeBox = (width: number, height: number, inset: number, preserveRatio: boolean) => {
  let x = Math.max(0, inset), y = Math.max(0, inset)
  let w = Math.max(1, width - x * 2), h = Math.max(1, height - y * 2)
  if (preserveRatio) {
    const side = Math.min(w, h)
    x += (w - side) / 2
    y += (h - side) / 2
    w = side
    h = side
  }
  return { x, y, w, h }
}

export const resolveOverlayStyle = (overlay: Overlay): ResolvedOverlayStyle => ({
  borderWidth: overlay.borderWidth ?? OVERLAY_STYLE_DEFAULTS.borderWidth,
  borderColor: overlay.borderColor ?? OVERLAY_STYLE_DEFAULTS.borderColor,
  borderStyle: overlay.borderStyle ?? OVERLAY_STYLE_DEFAULTS.borderStyle,
  shadowEnabled: overlay.shadowEnabled ?? OVERLAY_STYLE_DEFAULTS.shadowEnabled,
  shadowColor: overlay.shadowColor ?? OVERLAY_STYLE_DEFAULTS.shadowColor,
  shadowOpacity: overlay.shadowOpacity ?? OVERLAY_STYLE_DEFAULTS.shadowOpacity,
  shadowBlur: overlay.shadowBlur ?? OVERLAY_STYLE_DEFAULTS.shadowBlur,
  shadowX: overlay.shadowX ?? OVERLAY_STYLE_DEFAULTS.shadowX,
  shadowY: overlay.shadowY ?? OVERLAY_STYLE_DEFAULTS.shadowY,
  maskShape: overlay.maskShape ?? OVERLAY_STYLE_DEFAULTS.maskShape,
})

export const maskClipPath = (shape: OverlayMaskShape, width = 1, height = 1): string => {
  if (shape === 'none') return 'none'
  if (shape === 'rounded') return 'inset(0 round 12%)'
  if (shape === 'circle') return 'circle(closest-side at 50% 50%)'
  if (shape === 'ellipse') return 'ellipse(50% 42% at 50% 50%)'
  const points = MASK_POINTS[shape] ?? MASK_POINTS.hexagon!
  const box = fittedShapeBox(width, height, 0, true)
  return `polygon(${points.map(([px, py]) => `${((box.x + px * box.w) / width * 100).toFixed(2)}% ${((box.y + py * box.h) / height * 100).toFixed(2)}%`).join(', ')})`
}

const point = (x: number, y: number) => `${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`

export function maskPathData(shape: OverlayMaskShape, width: number, height: number, inset = 0): string {
  const { x, y, w, h } = fittedShapeBox(width, height, inset, Boolean(MASK_POINTS[shape]))
  if (shape === 'rounded') {
    const r = Math.min(w, h) * 0.12
    return `M ${point(x + r, y)} H ${Number((x + w - r).toFixed(2))} Q ${point(x + w, y)} ${point(x + w, y + r)} V ${Number((y + h - r).toFixed(2))} Q ${point(x + w, y + h)} ${point(x + w - r, y + h)} H ${Number((x + r).toFixed(2))} Q ${point(x, y + h)} ${point(x, y + h - r)} V ${Number((y + r).toFixed(2))} Q ${point(x, y)} ${point(x + r, y)} Z`
  }
  if (shape === 'circle') {
    const r = Math.max(0.5, Math.min(w, h) / 2)
    const cx = x + w / 2, cy = y + h / 2
    return `M ${point(cx - r, cy)} A ${Number(r.toFixed(2))} ${Number(r.toFixed(2))} 0 1 0 ${point(cx + r, cy)} A ${Number(r.toFixed(2))} ${Number(r.toFixed(2))} 0 1 0 ${point(cx - r, cy)} Z`
  }
  if (shape === 'ellipse') {
    const rx = w / 2, ry = h * 0.42, cx = x + rx, cy = y + h / 2
    return `M ${point(cx - rx, cy)} A ${Number(rx.toFixed(2))} ${Number(ry.toFixed(2))} 0 1 0 ${point(cx + rx, cy)} A ${Number(rx.toFixed(2))} ${Number(ry.toFixed(2))} 0 1 0 ${point(cx - rx, cy)} Z`
  }
  const polygon = MASK_POINTS[shape] ?? [[0,0],[1,0],[1,1],[0,1]]
  return polygon.map(([px, py], index) => `${index ? 'L' : 'M'} ${point(x + px * w, y + py * h)}`).join(' ') + ' Z'
}

export function overlayOutputSize(overlay: Overlay, sourceWidth: number, sourceHeight: number, frameWidth: number, frameHeight: number) {
  const width = Math.max(2, Math.round((overlay.scale * frameWidth) / 2) * 2)
  if (overlay.scaleY != null && !(overlay.aspectLocked ?? true)) {
    return { width, height: Math.max(2, Math.round((overlay.scaleY * frameHeight) / 2) * 2) }
  }
  const cropWidth = Math.max(1, sourceWidth * (1 - overlay.crop.left - overlay.crop.right))
  const cropHeight = Math.max(1, sourceHeight * (1 - overlay.crop.top - overlay.crop.bottom))
  const aspect = overlay.rotate === 90 || overlay.rotate === 270 ? cropHeight / cropWidth : cropWidth / cropHeight
  return { width, height: Math.max(2, Math.round((width / Math.max(0.01, aspect)) / 2) * 2) }
}

export function overlayEffectPadding(style: ResolvedOverlayStyle, frameHeight: number): number {
  if (!style.shadowEnabled) return 0
  const blur = style.shadowBlur * frameHeight
  const offset = Math.max(Math.abs(style.shadowX * frameHeight), Math.abs(style.shadowY * frameHeight))
  return Math.ceil(blur * 2 + offset + 2)
}

const canvasPng = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('스타일 이미지를 만들 수 없습니다.')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function renderOverlayEffectAssets(overlay: Overlay, width: number, height: number, frameHeight: number) {
  const style = resolveOverlayStyle(overlay)
  const maskPath = new Path2D(maskPathData(style.maskShape, width, height))
  let mask: Uint8Array | null = null
  if (style.maskShape !== 'none') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fill(maskPath)
    mask = await canvasPng(canvas)
  }

  const borderPx = Math.max(0, style.borderWidth * frameHeight)
  const hasDecoration = borderPx >= 0.5 || style.shadowEnabled
  if (!hasDecoration) return { mask, decoration: null, padding: 0 }

  const padding = overlayEffectPadding(style, frameHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width + padding * 2
  canvas.height = height + padding * 2
  const ctx = canvas.getContext('2d')!
  ctx.translate(padding, padding)

  if (style.shadowEnabled) {
    ctx.save()
    ctx.fillStyle = hexToRgba(style.shadowColor, style.shadowOpacity)
    ctx.shadowColor = hexToRgba(style.shadowColor, style.shadowOpacity)
    ctx.shadowBlur = style.shadowBlur * frameHeight
    ctx.shadowOffsetX = style.shadowX * frameHeight
    ctx.shadowOffsetY = style.shadowY * frameHeight
    ctx.fill(maskPath)
    ctx.restore()
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fill(maskPath)
    ctx.restore()
  }

  if (borderPx >= 0.5) {
    const drawStroke = (lineWidth: number, inset: number, dash: number[] = [], round = false) => {
      ctx.save()
      ctx.strokeStyle = style.borderColor
      ctx.lineWidth = lineWidth
      ctx.lineJoin = 'round'
      ctx.lineCap = round ? 'round' : 'butt'
      ctx.setLineDash(dash)
      ctx.stroke(new Path2D(maskPathData(style.maskShape, width, height, inset)))
      ctx.restore()
    }
    if (style.borderStyle === 'double') {
      const line = Math.max(1, borderPx / 3)
      drawStroke(line, line / 2)
      drawStroke(line, borderPx - line / 2)
    } else if (style.borderStyle === 'dashed') drawStroke(borderPx, borderPx / 2, [borderPx * 3, borderPx * 2])
    else if (style.borderStyle === 'dotted') drawStroke(borderPx, borderPx / 2, [0.1, borderPx * 1.9], true)
    else drawStroke(borderPx, borderPx / 2)
  }
  return { mask, decoration: await canvasPng(canvas), padding }
}
