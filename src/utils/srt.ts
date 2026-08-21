import type { CaptionCue } from '../types'

export interface ImportedCaptionCue {
  text: string
  start: number
  end: number
}

const TIMESTAMP = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})\s*-->\s*(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})(?:\s+.*)?$/
const MAX_DURATION = 6 * 60 * 60

const timestampSeconds = (parts: RegExpMatchArray, offset: number) => {
  const hours = Number(parts[offset])
  const minutes = Number(parts[offset + 1])
  const seconds = Number(parts[offset + 2])
  const milliseconds = Number(parts[offset + 3].padEnd(3, '0'))
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
}

export function parseSrt(input: string): ImportedCaptionCue[] {
  const text = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\0/g, '')
  const lines = text.split('\n')
  const cues: ImportedCaptionCue[] = []
  let index = 0

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index++
    if (index >= lines.length) break
    if (/^\d+$/.test(lines[index].trim())) index++
    const row = lines[index].trim()
    const match = row.match(TIMESTAMP)
    if (!match) throw new Error(`${index + 1}번째 줄의 SRT 시간 형식이 잘못되었습니다.`)
    const start = timestampSeconds(match, 1)
    const end = timestampSeconds(match, 5)
    if (end <= start) throw new Error(`${index + 1}번째 줄의 자막 종료 시간이 시작 시간보다 빠릅니다.`)
    if (end > MAX_DURATION) throw new Error('자막은 프로젝트 최대 길이인 6시간을 넘을 수 없습니다.')
    index++
    const body: string[] = []
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index].trim()
      const next = lines[index + 1]?.trim() ?? ''
      if (TIMESTAMP.test(current) || (/^\d+$/.test(current) && TIMESTAMP.test(next))) break
      body.push(lines[index++])
    }
    if (!body.length) throw new Error(`${index + 1}번째 줄 근처의 자막 내용이 비어 있습니다.`)
    cues.push({ start, end, text: body.join('\n') })
    if (cues.length > 10_000) throw new Error('한 자막 트랙에는 자막을 10,000개까지 가져올 수 있습니다.')
  }

  if (!cues.length) throw new Error('가져올 수 있는 SRT 자막이 없습니다.')
  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}

const formatTimestamp = (seconds: number) => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function stringifySrt(cues: Pick<CaptionCue, 'text' | 'start' | 'end'>[]): string {
  return [...cues]
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((cue, index) => [
      String(index + 1),
      `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}`,
      cue.text.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/\n/g, '\r\n'),
      '',
    ].join('\r\n'))
    .join('\r\n')
}
