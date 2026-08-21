import type { Overlay, OverlayBorderStyle, ShapeKind, ShapeStyle } from '../types'
import { hexToRgba } from './color'
import { overlayEffectPadding, resolveOverlayStyle } from './overlay-style'

export const SHAPE_OPTIONS: ReadonlyArray<{ value: ShapeKind; label: string }> = [
  { value: 'rectangle', label: '사각형' },
  { value: 'circle', label: '원' },
  { value: 'triangle', label: '삼각형' },
  { value: 'diamond', label: '마름모' },
  { value: 'star', label: '별' },
  { value: 'heart', label: '하트' },
  { value: 'hexagon', label: '육각형' },
  { value: 'arrow', label: '화살표' },
  { value: 'line', label: '선' },
]

export const SHAPE_STYLE_DEFAULTS: ShapeStyle = {
  kind: 'rectangle',
  fillColor: '#e27f92',
  fillOpacity: 1,
  cornerRadius: 0.14,
}

const SHAPE_KINDS = new Set<ShapeKind>(SHAPE_OPTIONS.map((option) => option.value))

export const isShapeKind = (value: unknown): value is ShapeKind => typeof value === 'string' && SHAPE_KINDS.has(value as ShapeKind)

export const shapeLabel = (kind: ShapeKind) => SHAPE_OPTIONS.find((option) => option.value === kind)?.label ?? '도형'

export function resolveShapeStyle(style?: Partial<ShapeStyle>): ShapeStyle {
  return {
    kind: isShapeKind(style?.kind) ? style.kind : SHAPE_STYLE_DEFAULTS.kind,
    fillColor: /^#[0-9a-f]{6}$/i.test(style?.fillColor ?? '') ? style!.fillColor! : SHAPE_STYLE_DEFAULTS.fillColor,
    fillOpacity: Math.max(0, Math.min(style?.fillOpacity ?? SHAPE_STYLE_DEFAULTS.fillOpacity, 1)),
    cornerRadius: Math.max(0, Math.min(style?.cornerRadius ?? SHAPE_STYLE_DEFAULTS.cornerRadius, 0.5)),
  }
}

const point = (x: number, y: number) => `${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`

const polygonPath = (points: number[][], x: number, y: number, width: number, height: number) =>
  points.map(([px, py], index) => `${index ? 'L' : 'M'} ${point(x + px * width, y + py * height)}`).join(' ') + ' Z'

export function shapePathData(kind: ShapeKind, width: number, height: number, inset = 0, cornerRadius = SHAPE_STYLE_DEFAULTS.cornerRadius): string {
  const x = Math.max(0, inset)
  const y = Math.max(0, inset)
  const w = Math.max(1, width - x * 2)
  const h = Math.max(1, height - y * 2)
  if (kind === 'rectangle') {
    const radius = Math.min(w, h) * Math.max(0, Math.min(cornerRadius, 0.5))
    return `M ${point(x + radius, y)} H ${Number((x + w - radius).toFixed(2))} Q ${point(x + w, y)} ${point(x + w, y + radius)} V ${Number((y + h - radius).toFixed(2))} Q ${point(x + w, y + h)} ${point(x + w - radius, y + h)} H ${Number((x + radius).toFixed(2))} Q ${point(x, y + h)} ${point(x, y + h - radius)} V ${Number((y + radius).toFixed(2))} Q ${point(x, y)} ${point(x + radius, y)} Z`
  }
  if (kind === 'circle') {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry
    return `M ${point(cx - rx, cy)} A ${Number(rx.toFixed(2))} ${Number(ry.toFixed(2))} 0 1 0 ${point(cx + rx, cy)} A ${Number(rx.toFixed(2))} ${Number(ry.toFixed(2))} 0 1 0 ${point(cx - rx, cy)} Z`
  }
  if (kind === 'heart') {
    return `M ${point(x + w / 2, y + h * .94)} C ${point(x + w * .42, y + h * .84)} ${point(x + w * .06, y + h * .62)} ${point(x + w * .06, y + h * .34)} C ${point(x + w * .06, y + h * .08)} ${point(x + w * .38, y + h * .02)} ${point(x + w / 2, y + h * .25)} C ${point(x + w * .62, y + h * .02)} ${point(x + w * .94, y + h * .08)} ${point(x + w * .94, y + h * .34)} C ${point(x + w * .94, y + h * .62)} ${point(x + w * .58, y + h * .84)} ${point(x + w / 2, y + h * .94)} Z`
  }
  if (kind === 'line') {
    const lineHeight = Math.max(2, h * .14)
    const top = y + (h - lineHeight) / 2
    const radius = lineHeight / 2
    return `M ${point(x + radius, top)} H ${Number((x + w - radius).toFixed(2))} A ${Number(radius.toFixed(2))} ${Number(radius.toFixed(2))} 0 0 1 ${point(x + w - radius, top + lineHeight)} H ${Number((x + radius).toFixed(2))} A ${Number(radius.toFixed(2))} ${Number(radius.toFixed(2))} 0 0 1 ${point(x + radius, top)} Z`
  }
  const points: Record<Exclude<ShapeKind, 'rectangle' | 'circle' | 'heart' | 'line'>, number[][]> = {
    triangle: [[.5,.03],[.97,.94],[.03,.94]],
    diamond: [[.5,.02],[.98,.5],[.5,.98],[.02,.5]],
    star: [[.5,.02],[.61,.35],[.96,.36],[.68,.57],[.79,.93],[.5,.71],[.21,.93],[.32,.57],[.04,.36],[.39,.35]],
    hexagon: [[.25,.04],[.75,.04],[.98,.5],[.75,.96],[.25,.96],[.02,.5]],
    arrow: [[.03,.34],[.57,.34],[.57,.08],[.97,.5],[.57,.92],[.57,.66],[.03,.66]],
  }
  return polygonPath(points[kind], x, y, w, h)
}

const PLACEHOLDER_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLrWQAAAABJRU5ErkJggg=='

export function createShapePlaceholderFile(kind: ShapeKind): File {
  const bytes = Uint8Array.from(atob(PLACEHOLDER_PNG), (character) => character.charCodeAt(0))
  return new File([bytes], `simplecut-${kind}.png`, { type: 'image/png' })
}

const strokeDash = (style: OverlayBorderStyle, width: number) => style === 'dashed'
  ? [width * 3, width * 2]
  : style === 'dotted' ? [0.1, width * 1.9] : []

const canvasPng = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('도형 이미지를 만들 수 없습니다.')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function renderShapePng(overlay: Overlay, width: number, height: number, frameHeight: number) {
  const shape = resolveShapeStyle(overlay.shape)
  const style = resolveOverlayStyle(overlay)
  const padding = overlayEffectPadding(style, frameHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, width + padding * 2)
  canvas.height = Math.max(2, height + padding * 2)
  const context = canvas.getContext('2d')!
  context.translate(padding, padding)
  const borderWidth = Math.max(0, style.borderWidth * frameHeight)
  const path = new Path2D(shapePathData(shape.kind, width, height, borderWidth / 2 + 1, shape.cornerRadius))

  if (style.shadowEnabled) {
    context.shadowColor = hexToRgba(style.shadowColor, style.shadowOpacity)
    context.shadowBlur = style.shadowBlur * frameHeight
    context.shadowOffsetX = style.shadowX * frameHeight
    context.shadowOffsetY = style.shadowY * frameHeight
  }
  context.fillStyle = hexToRgba(shape.fillColor, shape.fillOpacity)
  context.fill(path)
  context.shadowColor = 'transparent'

  if (borderWidth >= .5) {
    context.strokeStyle = style.borderColor
    context.lineJoin = 'round'
    context.lineCap = style.borderStyle === 'dotted' ? 'round' : 'butt'
    context.setLineDash(strokeDash(style.borderStyle, borderWidth))
    if (style.borderStyle === 'double') {
      context.lineWidth = Math.max(1, borderWidth / 3)
      context.stroke(path)
      context.stroke(new Path2D(shapePathData(shape.kind, width, height, borderWidth * .85 + 1, shape.cornerRadius)))
    } else {
      context.lineWidth = borderWidth
      context.stroke(path)
    }
  }

  return { data: await canvasPng(canvas), width: canvas.width, height: canvas.height }
}
