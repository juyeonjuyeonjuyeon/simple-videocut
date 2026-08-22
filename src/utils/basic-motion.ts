import type { BasicMotionPreset, KeyframeEasing } from '../types'

export interface MotionFrameDraft {
  time: number
  x: number
  y: number
  easing: KeyframeEasing
}

export const BASIC_MOTION_OPTIONS: ReadonlyArray<{ value: BasicMotionPreset; label: string; labelEn: string }> = [
  { value: 'none', label: '없음', labelEn: 'None' },
  { value: 'fade', label: '부드럽게', labelEn: 'Fade' },
  { value: 'rise', label: '아래에서', labelEn: 'Rise' },
  { value: 'fall', label: '위에서', labelEn: 'Drop in' },
  { value: 'slide-left', label: '왼쪽에서', labelEn: 'From left' },
  { value: 'slide-right', label: '오른쪽에서', labelEn: 'From right' },
  { value: 'drift', label: '천천히 이동', labelEn: 'Gentle drift' },
  { value: 'float', label: '위아래 부유', labelEn: 'Float' },
  { value: 'sway', label: '좌우 흔들림', labelEn: 'Sway' },
]

const clamp01 = (value: number) => Math.max(0, Math.min(value, 1))

export function isBasicMotionPreset(value: unknown): value is BasicMotionPreset {
  return BASIC_MOTION_OPTIONS.some((option) => option.value === value)
}

export function basicMotionFadeIn(preset: BasicMotionPreset, length: number): number {
  if (['none', 'drift', 'float', 'sway'].includes(preset)) return 0
  return Math.min(0.45, Math.max(0.12, length * 0.18), length / 2)
}

/** Creates at most two frames, keeping FFmpeg expressions bounded even on long projects. */
export function basicMotionFrames(preset: BasicMotionPreset, x: number, y: number, length: number): MotionFrameDraft[] {
  const safeLength = Math.max(0.1, length)
  const entrance = Math.min(0.55, Math.max(0.18, safeLength * 0.22))
  const target = { x: clamp01(x), y: clamp01(y) }
  if (preset === 'rise') return [
    { time: 0, x: target.x, y: clamp01(target.y + 0.14), easing: 'ease-in-out' },
    { time: entrance, ...target, easing: 'ease-in-out' },
  ]
  if (preset === 'fall') return [
    { time: 0, x: target.x, y: clamp01(target.y - 0.14), easing: 'ease-in-out' },
    { time: entrance, ...target, easing: 'ease-in-out' },
  ]
  if (preset === 'slide-left') return [
    { time: 0, x: clamp01(target.x - 0.16), y: target.y, easing: 'ease-in-out' },
    { time: entrance, ...target, easing: 'ease-in-out' },
  ]
  if (preset === 'slide-right') return [
    { time: 0, x: clamp01(target.x + 0.16), y: target.y, easing: 'ease-in-out' },
    { time: entrance, ...target, easing: 'ease-in-out' },
  ]
  if (preset === 'drift') return [
    { time: 0, x: clamp01(target.x - 0.035), y: clamp01(target.y + 0.015), easing: 'ease-in-out' },
    { time: safeLength, x: clamp01(target.x + 0.035), y: clamp01(target.y - 0.015), easing: 'ease-in-out' },
  ]
  if (preset === 'float') return [
    { time: 0, x: target.x, y: clamp01(target.y + 0.04), easing: 'ease-in-out' },
    { time: safeLength, x: target.x, y: clamp01(target.y - 0.04), easing: 'ease-in-out' },
  ]
  if (preset === 'sway') return [
    { time: 0, x: clamp01(target.x - 0.055), y: target.y, easing: 'ease-in-out' },
    { time: safeLength, x: clamp01(target.x + 0.055), y: target.y, easing: 'ease-in-out' },
  ]
  return []
}
