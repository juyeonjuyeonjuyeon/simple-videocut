import { describe, expect, it } from 'vitest'
import type { AudioClip, Background, Clip, Overlay, TextOverlay, TimelineMarker } from '../types'
import { collectTimelineEditPoints, nextTimelineEditPoint } from './timeline-navigation'

describe('timeline edit-point navigation', () => {
  it('collects cuts, free-layer edges, markers, and position keyframes without duplicates', () => {
    const clips = [
      { trimStart: 0, trimEnd: 2, speed: 1, repeat: 1 } as Clip,
      { trimStart: 0, trimEnd: 3, speed: 1, repeat: 1 } as Clip,
    ]
    const overlays = [{ start: 1, trimStart: 0, trimEnd: 2, speed: 1, repeat: 1, positionKeyframes: [{ time: 0.5 }] } as Overlay]
    const audios = [{ start: 2, trimStart: 0, trimEnd: 2, repeat: 1 } as AudioClip]
    const texts = [{ start: 1, end: 4, positionKeyframes: [{ time: 2 }] } as TextOverlay]
    const backgrounds = [{ start: 0, trimStart: 0, trimEnd: 5, speed: 1, repeat: 1 } as Background]
    const markers = [{ time: 2 }] as TimelineMarker[]

    expect(collectTimelineEditPoints(clips, overlays, audios, texts, backgrounds, markers)).toEqual([0, 1, 1.5, 2, 3, 4, 5])
  })

  it('jumps strictly forward or backward and stays at the ends', () => {
    const points = [0, 1, 2, 4]
    expect(nextTimelineEditPoint(points, 1, 1)).toBe(2)
    expect(nextTimelineEditPoint(points, 1, -1)).toBe(0)
    expect(nextTimelineEditPoint(points, 4, 1)).toBe(4)
    expect(nextTimelineEditPoint(points, 0, -1)).toBe(0)
  })
})
