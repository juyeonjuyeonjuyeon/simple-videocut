import type { AudioClip, Background, Clip, Overlay, TextOverlay, TimelineMarker } from '../types'
import { audioLength, clipStartOffsets, clipTimelineDuration, overlayLength } from './time'

const finitePoint = (value: number) => Number.isFinite(value) && value >= 0

export function collectTimelineEditPoints(
  clips: Clip[],
  overlays: Overlay[],
  audios: AudioClip[],
  texts: TextOverlay[],
  backgrounds: Background[],
  markers: TimelineMarker[],
): number[] {
  const points = new Set<number>([0])
  const add = (value: number) => { if (finitePoint(value)) points.add(Number(value.toFixed(6))) }
  const offsets = clipStartOffsets(clips)
  clips.forEach((clip, index) => {
    add(offsets[index])
    add(offsets[index] + clipTimelineDuration(clip))
  })
  overlays.forEach((item) => {
    add(item.start)
    add(item.start + overlayLength(item))
    item.positionKeyframes?.forEach((frame) => add(item.start + frame.time))
  })
  audios.forEach((item) => {
    add(item.start)
    add(item.start + audioLength(item))
  })
  texts.forEach((item) => {
    add(item.start)
    add(item.end)
    item.positionKeyframes?.forEach((frame) => add(item.start + frame.time))
  })
  backgrounds.forEach((item) => {
    add(item.start)
    add(item.start + clipTimelineDuration(item))
  })
  markers.forEach((marker) => add(marker.time))
  return [...points].sort((a, b) => a - b)
}

export function nextTimelineEditPoint(points: number[], playhead: number, direction: -1 | 1): number {
  const epsilon = 1 / 600
  if (direction > 0) return points.find((point) => point > playhead + epsilon) ?? points[points.length - 1] ?? 0
  return [...points].reverse().find((point) => point < playhead - epsilon) ?? points[0] ?? 0
}
