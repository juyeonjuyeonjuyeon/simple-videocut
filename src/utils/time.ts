import type { Clip, Overlay, AudioClip, TextOverlay, Background, AspectRatio } from '../types'

/** One playthrough of a clip's trimmed segment (trim + speed), ignoring repeat. */
export function clipBaseLength(clip: Clip): number {
  return (clip.trimEnd - clip.trimStart) / clip.speed
}

/** Length this clip occupies on the timeline (trim + speed × repeat). */
export function clipTimelineDuration(clip: Clip): number {
  return clipBaseLength(clip) * Math.max(1, clip.repeat)
}

/** Timeline length of an overlay (trim + speed × repeat). */
export function overlayLength(o: Overlay): number {
  return ((o.trimEnd - o.trimStart) / o.speed) * Math.max(1, o.repeat)
}

/** Timeline length of an audio clip (trim × repeat). */
export function audioLength(a: AudioClip): number {
  return (a.trimEnd - a.trimStart) * Math.max(1, a.repeat)
}

/** Overall project length = the latest end across all tracks. */
export function projectDuration(
  clips: Clip[],
  overlays: Overlay[],
  audios: AudioClip[],
  texts: TextOverlay[],
  backgrounds: Background[] = [],
): number {
  let max = totalDuration(clips)
  for (const o of overlays) max = Math.max(max, o.start + overlayLength(o))
  for (const a of audios) max = Math.max(max, a.start + audioLength(a))
  for (const t of texts) max = Math.max(max, t.end)
  for (const b of backgrounds) max = Math.max(max, b.start + clipTimelineDuration(b))
  return max
}

/**
 * Greedily pack timed items into horizontal lanes so items that don't overlap
 * in time can share a lane. Returns a lane index per item (input order).
 */
export function packLanes(spans: { start: number; end: number }[]): number[] {
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].start - spans[b].start)
  const laneEnds: number[] = []
  const laneOf: number[] = new Array(spans.length).fill(0)
  for (const i of order) {
    let placed = false
    for (let l = 0; l < laneEnds.length; l++) {
      if (spans[i].start >= laneEnds[l] - 1e-6) {
        laneOf[i] = l
        laneEnds[l] = spans[i].end
        placed = true
        break
      }
    }
    if (!placed) {
      laneOf[i] = laneEnds.length
      laneEnds.push(spans[i].end)
    }
  }
  return laneOf
}

/** Total timeline length across all clips, in seconds. */
export function totalDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + clipTimelineDuration(c), 0)
}

/** Start offset of each clip on the timeline (parallel array to clips). */
export function clipStartOffsets(clips: Clip[]): number[] {
  const offsets: number[] = []
  let acc = 0
  for (const c of clips) {
    offsets.push(acc)
    acc += clipTimelineDuration(c)
  }
  return offsets
}

/**
 * Map a timeline time to the clip playing at that moment and the local
 * source time within it (already accounting for trim + speed).
 */
export function resolveTimelineTime(
  clips: Clip[],
  time: number,
): { index: number; clip: Clip; localTime: number } | null {
  let acc = 0
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const dur = clipTimelineDuration(clip)
    if (time < acc + dur || i === clips.length - 1) {
      const base = clipBaseLength(clip)
      const into = Math.max(0, Math.min(time - acc, dur))
      // Wrap within a single playthrough when the clip repeats.
      const localInto = clip.repeat > 1 && base > 0 ? into % base : into
      const localTime = clip.trimStart + localInto * clip.speed
      return { index: i, clip, localTime }
    }
    acc += dur
  }
  return null
}

/** Duration / clock as [H:]MM:SS (hours shown only when present). */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Editable timecode [H:]MM:SS.ss (two decimals) — for duration fields. */
export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const ss = s.toFixed(2).padStart(5, '0')
  const mm = String(m).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Parse a timecode string ([H:]MM:SS.ss, MM:SS, or plain seconds) into seconds. */
export function parseClock(str: string): number {
  const parts = str.trim().split(':').map((p) => Number(p.trim()))
  if (parts.some((n) => !isFinite(n))) return NaN
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** Like formatTime but with one decimal of seconds — for ruler ticks below 1s. */
export function formatTimeFine(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = s.toFixed(1).padStart(4, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function aspectToWH(ratio: AspectRatio, height: number): { w: number; h: number } {
  const map: Record<AspectRatio, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }
  const w = Math.round((height * map[ratio]) / 2) * 2 // keep even for codecs
  return { w, h: height }
}
