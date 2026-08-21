import type { Overlay, StickerKind } from '../types'
import { hexToRgba } from './color'
import { overlayEffectPadding, resolveOverlayStyle } from './overlay-style'
import { translate } from '../i18n'

export interface StickerLayer {
  path: string
  fill?: string
  stroke?: string
  strokeWidth?: number
  lineCap?: 'round' | 'square'
  lineJoin?: 'round' | 'bevel'
}

export const STICKER_OPTIONS: ReadonlyArray<{ value: StickerKind; label: string; labelEn: string }> = [
  { value: 'heart-pop', label: '두근 하트', labelEn: 'Heart pop' },
  { value: 'sparkles', label: '반짝반짝', labelEn: 'Sparkles' },
  { value: 'smile', label: '방긋', labelEn: 'Smile' },
  { value: 'flower', label: '작은 꽃', labelEn: 'Little flower' },
  { value: 'sun', label: '햇살', labelEn: 'Sunshine' },
  { value: 'speech', label: '말풍선', labelEn: 'Speech bubble' },
  { value: 'arrow-note', label: '손그림 화살표', labelEn: 'Doodle arrow' },
  { value: 'check', label: '확인', labelEn: 'Check' },
]

const STICKER_KINDS = new Set<StickerKind>(STICKER_OPTIONS.map((option) => option.value))
export const isStickerKind = (value: unknown): value is StickerKind => typeof value === 'string' && STICKER_KINDS.has(value as StickerKind)

export const stickerLabel = (kind: StickerKind) => {
  const option = STICKER_OPTIONS.find((candidate) => candidate.value === kind)
  return option ? translate(option.label, option.labelEn) : translate('스티커', 'Sticker')
}

export function stickerLayers(kind: StickerKind): StickerLayer[] {
  switch (kind) {
    case 'heart-pop': return [
      { path: 'M50 88C42 78 14 60 14 37C14 19 36 13 50 31C64 13 86 19 86 37C86 60 58 78 50 88Z', fill: '#ff7994', stroke: '#5a3040', strokeWidth: 5 },
      { path: 'M25 27C30 20 39 20 44 26', fill: 'none', stroke: '#ffd7df', strokeWidth: 5, lineCap: 'round' },
      { path: 'M11 18L7 9M20 12L22 4M89 18L94 10', fill: 'none', stroke: '#f7c85e', strokeWidth: 5, lineCap: 'round' },
    ]
    case 'sparkles': return [
      { path: 'M47 8C50 29 58 38 78 42C58 46 50 55 47 77C43 55 36 46 15 42C36 38 43 29 47 8Z', fill: '#ffd968', stroke: '#5a4662', strokeWidth: 4 },
      { path: 'M79 57C81 68 86 73 97 75C86 77 81 82 79 93C77 82 72 77 61 75C72 73 77 68 79 57Z', fill: '#ff91ad', stroke: '#5a4662', strokeWidth: 3.5 },
      { path: 'M18 66C19 72 22 75 28 76C22 77 19 80 18 86C17 80 14 77 8 76C14 75 17 72 18 66Z', fill: '#8dd8d2', stroke: '#5a4662', strokeWidth: 3 },
    ]
    case 'smile': return [
      { path: 'M50 8C75 8 92 25 92 50C92 75 75 92 50 92C25 92 8 75 8 50C8 25 25 8 50 8Z', fill: '#ffd85f', stroke: '#59463d', strokeWidth: 5 },
      { path: 'M31 42C31 36 35 33 39 33C43 33 47 36 47 42', fill: 'none', stroke: '#59463d', strokeWidth: 5, lineCap: 'round' },
      { path: 'M56 42C56 36 60 33 64 33C68 33 72 36 72 42', fill: 'none', stroke: '#59463d', strokeWidth: 5, lineCap: 'round' },
      { path: 'M31 58C38 72 62 76 73 57', fill: 'none', stroke: '#59463d', strokeWidth: 6, lineCap: 'round' },
      { path: 'M18 55C22 52 26 52 30 55M71 55C75 52 79 52 83 55', fill: 'none', stroke: '#ff8f9e', strokeWidth: 5, lineCap: 'round' },
    ]
    case 'flower': return [
      { path: 'M50 38C39 22 45 8 55 9C66 9 68 24 58 39C74 25 90 31 90 43C90 54 75 58 59 51C74 63 69 80 57 82C46 84 39 70 45 53C34 70 16 66 13 54C10 43 24 35 42 43C26 31 32 15 44 14C55 13 59 26 50 38Z', fill: '#ff9eb1', stroke: '#5d4051', strokeWidth: 4 },
      { path: 'M50 38C59 38 65 44 65 52C65 61 59 67 50 67C41 67 35 61 35 52C35 44 41 38 50 38Z', fill: '#ffe16d', stroke: '#5d4051', strokeWidth: 4 },
      { path: 'M48 84C48 75 49 68 51 63M51 76C60 68 68 68 74 71C68 79 61 82 51 80', fill: 'none', stroke: '#5ba87b', strokeWidth: 5, lineCap: 'round', lineJoin: 'round' },
    ]
    case 'sun': return [
      { path: 'M50 21C67 21 79 33 79 50C79 67 67 79 50 79C33 79 21 67 21 50C21 33 33 21 50 21Z', fill: '#ffd45c', stroke: '#5c483b', strokeWidth: 5 },
      { path: 'M50 4V14M50 86V96M4 50H14M86 50H96M17 17L24 24M76 76L83 83M83 17L76 24M24 76L17 83', fill: 'none', stroke: '#f3a94d', strokeWidth: 6, lineCap: 'round' },
      { path: 'M36 44C36 40 39 38 42 38M58 38C61 38 64 40 64 44M37 57C44 65 56 65 63 57', fill: 'none', stroke: '#5c483b', strokeWidth: 4, lineCap: 'round' },
    ]
    case 'speech': return [
      { path: 'M10 16C10 10 15 6 21 6H79C85 6 90 10 90 16V63C90 69 85 73 79 73H45L25 92L29 73H21C15 73 10 69 10 63Z', fill: '#fff7e7', stroke: '#5a4652', strokeWidth: 5, lineJoin: 'round' },
      { path: 'M28 31H72M28 45H63M28 59H52', fill: 'none', stroke: '#e27f92', strokeWidth: 5, lineCap: 'round' },
    ]
    case 'arrow-note': return [
      { path: 'M13 30C34 18 61 22 72 43C79 56 74 69 58 76', fill: 'none', stroke: '#e27f92', strokeWidth: 8, lineCap: 'round' },
      { path: 'M63 58L55 78L76 81', fill: 'none', stroke: '#e27f92', strokeWidth: 8, lineCap: 'round', lineJoin: 'round' },
      { path: 'M14 19L9 11M26 14L28 5', fill: 'none', stroke: '#f1c45d', strokeWidth: 5, lineCap: 'round' },
    ]
    case 'check': return [
      { path: 'M50 7C75 7 93 25 93 50C93 75 75 93 50 93C25 93 7 75 7 50C7 25 25 7 50 7Z', fill: '#80d1bd', stroke: '#385a58', strokeWidth: 5 },
      { path: 'M27 51L43 67L74 34', fill: 'none', stroke: '#fffdf5', strokeWidth: 9, lineCap: 'round', lineJoin: 'round' },
    ]
  }
}

const PLACEHOLDER_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLrWQAAAABJRU5ErkJggg=='

export function createStickerPlaceholderFile(kind: StickerKind): File {
  const bytes = Uint8Array.from(atob(PLACEHOLDER_PNG), (character) => character.charCodeAt(0))
  return new File([bytes], `simplecut-sticker-${kind}.png`, { type: 'image/png' })
}

const canvasPng = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('스티커 이미지를 만들 수 없습니다.')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function renderStickerPng(overlay: Overlay, width: number, height: number, frameHeight: number) {
  const kind = overlay.sticker?.kind ?? 'heart-pop'
  const style = resolveOverlayStyle(overlay)
  const padding = overlayEffectPadding(style, frameHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, width + padding * 2)
  canvas.height = Math.max(2, height + padding * 2)
  const context = canvas.getContext('2d')!
  const sx = width / 100
  const sy = height / 100
  context.translate(padding, padding)
  context.scale(sx, sy)

  for (const layer of stickerLayers(kind)) {
    const path = new Path2D(layer.path)
    context.save()
    if (style.shadowEnabled) {
      context.shadowColor = hexToRgba(style.shadowColor, style.shadowOpacity)
      context.shadowBlur = style.shadowBlur * frameHeight / Math.max(sx, sy)
      context.shadowOffsetX = style.shadowX * frameHeight / sx
      context.shadowOffsetY = style.shadowY * frameHeight / sy
    }
    if (layer.fill && layer.fill !== 'none') {
      context.fillStyle = layer.fill
      context.fill(path)
    }
    if (layer.stroke && layer.stroke !== 'none' && (layer.strokeWidth ?? 0) > 0) {
      context.strokeStyle = layer.stroke
      context.lineWidth = layer.strokeWidth!
      context.lineCap = layer.lineCap ?? 'butt'
      context.lineJoin = layer.lineJoin ?? 'miter'
      context.stroke(path)
    }
    context.restore()
  }
  return { data: await canvasPng(canvas), width: canvas.width, height: canvas.height }
}
