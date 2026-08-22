import type { VisualFilterPreset, VisualFilterSettings } from '../types'

export type ColorMatrix = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number, number,
]

export const VISUAL_FILTER_OPTIONS: ReadonlyArray<{ value: VisualFilterPreset; label: string; labelEn: string }> = [
  { value: 'none', label: '원본', labelEn: 'Original' },
  { value: 'mono', label: '흑백', labelEn: 'Mono' },
  { value: 'warm', label: '따뜻함', labelEn: 'Warm' },
  { value: 'cool', label: '시원함', labelEn: 'Cool' },
  { value: 'soft', label: '부드러움', labelEn: 'Soft' },
  { value: 'vivid', label: '선명함', labelEn: 'Vivid' },
  { value: 'cinema', label: '시네마', labelEn: 'Cinema' },
  { value: 'sunset', label: '노을', labelEn: 'Sunset' },
  { value: 'aqua', label: '아쿠아', labelEn: 'Aqua' },
  { value: 'vintage', label: '빈티지', labelEn: 'Vintage' },
  { value: 'dream', label: '몽환', labelEn: 'Dream' },
  { value: 'noir', label: '누아르', labelEn: 'Noir' },
]

const IDENTITY: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
]

const saturationMatrix = (saturation: number): ColorMatrix => {
  const inverse = 1 - saturation
  const r = 0.2126 * inverse
  const g = 0.7152 * inverse
  const b = 0.0722 * inverse
  return [
    r + saturation, g, b, 0, 0,
    r, g + saturation, b, 0, 0,
    r, g, b + saturation, 0, 0,
    0, 0, 0, 1, 0,
  ]
}

const TARGETS: Record<VisualFilterPreset, ColorMatrix> = {
  none: IDENTITY,
  mono: saturationMatrix(0),
  warm: [1.08, .03, 0, 0, 0, 0, 1.01, 0, 0, 0, 0, .02, .88, 0, 0, 0, 0, 0, 1, 0],
  cool: [.91, .01, 0, 0, 0, 0, 1.01, .01, 0, 0, 0, .02, 1.1, 0, 0, 0, 0, 0, 1, 0],
  soft: saturationMatrix(.76),
  vivid: saturationMatrix(1.28),
  cinema: [1.06, .02, 0, 0, 0, 0, .98, .01, 0, 0, 0, .01, .86, 0, 0, 0, 0, 0, 1, 0],
  sunset: [1.12, .03, 0, 0, 0, .01, .96, 0, 0, 0, 0, .02, .76, 0, 0, 0, 0, 0, 1, 0],
  aqua: [.84, .01, 0, 0, 0, 0, 1.04, .02, 0, 0, 0, .02, 1.12, 0, 0, 0, 0, 0, 1, 0],
  vintage: [.76, .16, .05, 0, 0, .08, .76, .08, 0, 0, .05, .15, .66, 0, 0, 0, 0, 0, 1, 0],
  dream: [.9, .06, .04, 0, 0, .03, .91, .05, 0, 0, .07, .04, .94, 0, 0, 0, 0, 0, 1, 0],
  noir: [.25, .65, .1, 0, 0, .25, .65, .1, 0, 0, .25, .65, .1, 0, 0, 0, 0, 0, 1, 0],
}

export const isVisualFilterPreset = (value: unknown): value is VisualFilterPreset =>
  VISUAL_FILTER_OPTIONS.some((option) => option.value === value)

export function resolveVisualFilter(settings?: VisualFilterSettings): Required<VisualFilterSettings> {
  return {
    filterPreset: isVisualFilterPreset(settings?.filterPreset) ? settings!.filterPreset! : 'none',
    filterAmount: Math.max(0, Math.min(Number.isFinite(settings?.filterAmount) ? settings!.filterAmount! : 100, 100)),
  }
}

export function visualFilterMatrix(settings?: VisualFilterSettings): ColorMatrix {
  const { filterPreset, filterAmount } = resolveVisualFilter(settings)
  const mix = filterPreset === 'none' ? 0 : filterAmount / 100
  const target = TARGETS[filterPreset]
  return IDENTITY.map((value, index) => Number((value + (target[index] - value) * mix).toFixed(6))) as unknown as ColorMatrix
}

const clean = (value: number) => Number(value.toFixed(6)).toString()

export const svgColorMatrixValues = (settings?: VisualFilterSettings) => visualFilterMatrix(settings).map(clean).join(' ')

/** FFmpeg's colorchannelmixer uses the same 4x4 part of the SVG matrix. */
export function ffmpegColorFilter(settings?: VisualFilterSettings): string {
  const resolved = resolveVisualFilter(settings)
  if (resolved.filterPreset === 'none' || resolved.filterAmount <= 0) return ''
  const matrix = visualFilterMatrix(resolved)
  return `colorchannelmixer=rr=${clean(matrix[0])}:rg=${clean(matrix[1])}:rb=${clean(matrix[2])}:ra=${clean(matrix[3])}` +
    `:gr=${clean(matrix[5])}:gg=${clean(matrix[6])}:gb=${clean(matrix[7])}:ga=${clean(matrix[8])}` +
    `:br=${clean(matrix[10])}:bg=${clean(matrix[11])}:bb=${clean(matrix[12])}:ba=${clean(matrix[13])}` +
    `:ar=${clean(matrix[15])}:ag=${clean(matrix[16])}:ab=${clean(matrix[17])}:aa=${clean(matrix[18])},`
}

export const colorFilterDomId = (id: string) => `simplecut-color-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`

export function colorFilterCss(id: string, settings?: VisualFilterSettings): string {
  const resolved = resolveVisualFilter(settings)
  return resolved.filterPreset === 'none' || resolved.filterAmount <= 0 ? 'none' : `url(#${colorFilterDomId(id)})`
}
