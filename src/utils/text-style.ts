import type { TextOverlay } from '../types'

export type TextStylePreset = 'default' | 'clean' | 'yellow' | 'strawberry' | 'paper' | 'caption'

export type TextStylePatch = Pick<TextOverlay,
  'color' | 'colorAlpha' | 'box' | 'boxColor' | 'boxAlpha' | 'strokeWidth' | 'strokeColor' |
  'shadow' | 'shadowColor' | 'shadowBlur' | 'shadowDist'>

export const TEXT_STYLE_OPTIONS: ReadonlyArray<{ value: TextStylePreset; label: string; labelEn: string; patch: TextStylePatch }> = [
  {
    value: 'default', label: '기본 자막', labelEn: 'Default caption',
    patch: { color: '#ffffff', colorAlpha: 1, box: true, boxColor: '#000000', boxAlpha: .55, strokeWidth: 0, strokeColor: '#000000', shadow: true, shadowColor: '#000000', shadowBlur: .12, shadowDist: .04 },
  },
  {
    value: 'clean', label: '깔끔한 흰색', labelEn: 'Clean white',
    patch: { color: '#ffffff', colorAlpha: 1, box: false, boxColor: '#000000', boxAlpha: 0, strokeWidth: .035, strokeColor: '#222222', shadow: true, shadowColor: '#000000', shadowBlur: .14, shadowDist: .04 },
  },
  {
    value: 'yellow', label: '노란 강조', labelEn: 'Yellow emphasis',
    patch: { color: '#ffda55', colorAlpha: 1, box: false, boxColor: '#000000', boxAlpha: 0, strokeWidth: .08, strokeColor: '#2b2524', shadow: false, shadowColor: '#000000', shadowBlur: 0, shadowDist: 0 },
  },
  {
    value: 'strawberry', label: '딸기우유', labelEn: 'Strawberry milk',
    patch: { color: '#fff8fa', colorAlpha: 1, box: true, boxColor: '#d8788b', boxAlpha: .92, strokeWidth: .025, strokeColor: '#ffffff', shadow: true, shadowColor: '#5e3240', shadowBlur: .15, shadowDist: .05 },
  },
  {
    value: 'paper', label: '종이 라벨', labelEn: 'Paper label',
    patch: { color: '#3f3430', colorAlpha: 1, box: true, boxColor: '#fff0cf', boxAlpha: .96, strokeWidth: 0, strokeColor: '#3f3430', shadow: true, shadowColor: '#000000', shadowBlur: .1, shadowDist: .04 },
  },
  {
    value: 'caption', label: '또렷한 자막', labelEn: 'Clear caption',
    patch: { color: '#ffffff', colorAlpha: 1, box: true, boxColor: '#111111', boxAlpha: .8, strokeWidth: 0, strokeColor: '#000000', shadow: false, shadowColor: '#000000', shadowBlur: 0, shadowDist: 0 },
  },
]

export function textStylePatch(preset: TextStylePreset): TextStylePatch {
  return { ...(TEXT_STYLE_OPTIONS.find((option) => option.value === preset) ?? TEXT_STYLE_OPTIONS[0]).patch }
}

export function inferTextStylePreset(text: Partial<TextOverlay>): TextStylePreset | null {
  const same = (left: unknown, right: unknown) => typeof left === 'number' && typeof right === 'number'
    ? Math.abs(left - right) < 1e-6
    : left === right
  return TEXT_STYLE_OPTIONS.find((option) => Object.entries(option.patch).every(([key, value]) => same(text[key as keyof TextOverlay], value)))?.value ?? null
}
