import { FONT_OPTIONS } from '../types'
import type { CaptionCue, CaptionStyle, CaptionTrack } from '../types'

const MAX_PROJECT_DURATION = 6 * 60 * 60

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Number.isFinite(value) ? value : min, max))

export const CAPTION_STYLE_DEFAULTS: Readonly<CaptionStyle> = Object.freeze({
  font: FONT_OPTIONS[0].value,
  size: 0.056,
  color: '#ffffff',
  colorAlpha: 1,
  box: true,
  boxColor: '#000000',
  boxAlpha: 0.62,
  boxPadding: 0.24,
  boxRadius: 0.18,
  strokeWidth: 0,
  strokeColor: '#000000',
  shadow: true,
  shadowColor: '#000000',
  shadowBlur: 0.12,
  shadowDist: 0.05,
  align: 'center',
  x: 0.5,
  y: 0.86,
  maxWidth: 0.84,
  lineHeight: 1.22,
  lineLimit: 2,
})

export function resolveCaptionStyle(style?: Partial<CaptionStyle>): CaptionStyle {
  const value = { ...CAPTION_STYLE_DEFAULTS, ...style }
  return {
    font: typeof value.font === 'string' && value.font ? value.font : CAPTION_STYLE_DEFAULTS.font,
    size: clamp(value.size, 0.02, 0.16),
    color: typeof value.color === 'string' ? value.color : CAPTION_STYLE_DEFAULTS.color,
    colorAlpha: clamp(value.colorAlpha, 0, 1),
    box: Boolean(value.box),
    boxColor: typeof value.boxColor === 'string' ? value.boxColor : CAPTION_STYLE_DEFAULTS.boxColor,
    boxAlpha: clamp(value.boxAlpha, 0, 1),
    boxPadding: clamp(value.boxPadding, 0, 1.5),
    boxRadius: clamp(value.boxRadius, 0, 1.5),
    strokeWidth: clamp(value.strokeWidth, 0, 0.3),
    strokeColor: typeof value.strokeColor === 'string' ? value.strokeColor : CAPTION_STYLE_DEFAULTS.strokeColor,
    shadow: Boolean(value.shadow),
    shadowColor: typeof value.shadowColor === 'string' ? value.shadowColor : CAPTION_STYLE_DEFAULTS.shadowColor,
    shadowBlur: clamp(value.shadowBlur, 0, 1),
    shadowDist: clamp(value.shadowDist, 0, 1),
    align: value.align === 'left' || value.align === 'right' ? value.align : 'center',
    x: clamp(value.x, 0.05, 0.95),
    y: clamp(value.y, 0.05, 0.95),
    maxWidth: clamp(value.maxWidth, 0.2, 0.94),
    lineHeight: clamp(value.lineHeight, 0.8, 2),
    lineLimit: value.lineLimit === 1 || value.lineLimit === 3 ? value.lineLimit : 2,
  }
}

export function normalizeCaptionStylePatch(style?: Partial<CaptionStyle>): Partial<CaptionStyle> | undefined {
  if (!style) return undefined
  const resolved = resolveCaptionStyle(style)
  const result: Partial<CaptionStyle> = {}
  for (const key of Object.keys(CAPTION_STYLE_DEFAULTS) as (keyof CaptionStyle)[]) {
    if (Object.prototype.hasOwnProperty.call(style, key)) Object.assign(result, { [key]: resolved[key] })
  }
  return Object.keys(result).length ? result : undefined
}

export function normalizeCaptionCue(cue: CaptionCue): CaptionCue {
  const start = clamp(cue.start, 0, MAX_PROJECT_DURATION - 0.05)
  const end = clamp(cue.end, start + 0.05, MAX_PROJECT_DURATION)
  return {
    ...cue,
    text: String(cue.text ?? ''),
    start,
    end,
    origin: cue.origin === 'imported' || cue.origin === 'generated' ? cue.origin : 'manual',
    style: normalizeCaptionStylePatch(cue.style),
    source: cue.source ? {
      type: cue.source.type === 'audio' ? 'audio' : 'clip',
      id: cue.source.id,
      offsetStart: Math.max(0, cue.source.offsetStart),
      offsetEnd: Math.max(cue.source.offsetStart, cue.source.offsetEnd),
    } : undefined,
  }
}

export function normalizeCaptionTrack(track: CaptionTrack): CaptionTrack {
  return {
    ...track,
    name: String(track.name ?? ''),
    language: String(track.language || 'und'),
    hidden: Boolean(track.hidden),
    locked: Boolean(track.locked),
    style: resolveCaptionStyle(track.style),
    cues: [...track.cues].map(normalizeCaptionCue).sort((a, b) => a.start - b.start || a.end - b.end),
  }
}

export function captionStyleForCue(track: CaptionTrack, cue: CaptionCue): CaptionStyle {
  return resolveCaptionStyle({ ...track.style, ...(cue.style ?? {}) })
}

/** Wrap text the same way the preview intends to: prefer words, then break a long word by grapheme. */
export function wrapCaptionLines(
  value: string,
  maxWidth: number,
  lineLimit: number,
  measure: (text: string) => number,
): string[] {
  const safeWidth = Math.max(1, maxWidth)
  const safeLimit = Math.max(1, Math.floor(lineLimit))
  const lines: string[] = []
  let clipped = false
  const push = (line: string) => {
    if (lines.length < safeLimit) lines.push(line.trimEnd())
    else clipped = true
  }
  // Korean syllables, Latin text, and supplementary Unicode code points are
  // kept intact without requiring Intl.Segmenter on older Safari builds.
  const graphemes = (text: string) => Array.from(text)

  for (const paragraph of String(value ?? '').split('\n')) {
    if (lines.length >= safeLimit) { clipped = true; break }
    if (!paragraph) { push(''); continue }
    const tokens = paragraph.match(/\S+\s*|\s+/g) ?? [paragraph]
    let line = ''
    for (const token of tokens) {
      if (measure((line + token).trimEnd()) <= safeWidth) { line += token; continue }
      if (line.trim()) { push(line); line = ''; if (lines.length >= safeLimit) { clipped = true; break } }
      let chunk = ''
      for (const grapheme of graphemes(token.trimStart())) {
        if (chunk && measure(chunk + grapheme) > safeWidth) {
          push(chunk)
          chunk = ''
          if (lines.length >= safeLimit) { clipped = true; break }
        }
        chunk += grapheme
      }
      if (lines.length >= safeLimit) break
      line = chunk
    }
    if (lines.length >= safeLimit) { if (line.trim() || tokens.length) clipped = true; break }
    if (line || !lines.length) push(line)
  }

  if (!lines.length) lines.push('')
  if (clipped) {
    const ellipsis = '…'
    let last = lines[lines.length - 1].trimEnd()
    while (last && measure(last + ellipsis) > safeWidth) last = graphemes(last).slice(0, -1).join('')
    lines[lines.length - 1] = last + ellipsis
  }
  return lines.slice(0, safeLimit)
}
