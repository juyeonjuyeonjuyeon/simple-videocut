import type { TextOverlay } from '../types'

export interface SubtitleCue {
  start: number
  end: number
  text: string
}

const MAX_CUES = 200
const MAX_TIME = 6 * 60 * 60

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
}

function plainCueText(lines: string[]): string {
  return decodeEntities(lines.join('\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')).trim()
}

export function parseSubtitleTime(value: string): number | null {
  const parts = value.trim().replace(',', '.').split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const values = parts.map(Number)
  if (values.some((part) => !Number.isFinite(part) || part < 0)) return null
  const seconds = parts.length === 3
    ? values[0] * 3600 + values[1] * 60 + values[2]
    : values[0] * 60 + values[1]
  return seconds <= MAX_TIME ? seconds : null
}

/** Parses SRT and WebVTT while discarding unsupported markup and cue settings. */
export function parseSubtitles(source: string): SubtitleCue[] {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd())
    if (!lines.length || /^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0].trim())) continue
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) continue
    const match = lines[timingIndex].match(/^\s*([^\s]+)\s*-->\s*([^\s]+)/)
    if (!match) continue
    const start = parseSubtitleTime(match[1])
    const end = parseSubtitleTime(match[2])
    const text = plainCueText(lines.slice(timingIndex + 1))
    if (start == null || end == null || end <= start || !text) continue
    cues.push({ start, end, text: text.slice(0, 10_000) })
    if (cues.length >= MAX_CUES) break
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}

function srtTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const ms = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

export function serializeSrt(texts: TextOverlay[]): string {
  return texts
    .filter((item) => !item.hidden && item.role === 'caption' && item.end > item.start && item.text.trim())
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((item, index) => `${index + 1}\n${srtTime(item.start)} --> ${srtTime(item.end)}\n${item.text.trim()}`)
    .join('\n\n') + (texts.some((item) => item.role === 'caption' && !item.hidden && item.end > item.start && item.text.trim()) ? '\n' : '')
}

