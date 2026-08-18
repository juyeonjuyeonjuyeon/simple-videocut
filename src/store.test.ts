import { beforeEach, describe, expect, it } from 'vitest'
import type { Clip, Overlay } from './types'
import type { ProjectState } from './utils/project'
import { useEditor } from './store'
import { projectDuration } from './utils/time'
import { positionAt } from './utils/motion'

const clip = (repeat = 1): Clip => ({
  id: 'clip-1', kind: 'video', name: 'repeat.mp4', src: 'blob:repeat',
  file: new File(['video'], 'repeat.mp4', { type: 'video/mp4' }),
  sourceSize: 5,
  duration: 2, trimStart: 0, trimEnd: 2, speed: 1, volume: 1, muted: false,
  hasAudio: false, color: '#000000', rotate: 0, flipH: false, flipV: false,
  crop: { top: 0, right: 0, bottom: 0, left: 0 }, repeat,
})

describe('timeline splitting', () => {
  beforeEach(() => {
    useEditor.setState({
      clips: [clip(3)], overlays: [], audios: [], backgrounds: [], texts: [], markers: [],
      playhead: 2.5, selection: { type: 'clip', id: 'clip-1' },
      isPlaying: false,
    })
  })

  it('splits inside a repeated cycle without creating invalid source trims', () => {
    const before = useEditor.getState()
    const durationBefore = projectDuration(before.clips, [], [], [], [])

    before.splitAtPlayhead()

    const after = useEditor.getState()
    expect(after.clips).toHaveLength(4)
    expect(after.clips.map((item) => [item.trimStart, item.trimEnd, item.repeat])).toEqual([
      [0, 2, 1], [0, 0.5, 1], [0.5, 2, 1], [0, 2, 1],
    ])
    expect(after.clips.every((item) => item.trimStart >= 0 && item.trimStart < item.trimEnd && item.trimEnd <= item.duration)).toBe(true)
    expect(projectDuration(after.clips, [], [], [], [])).toBeCloseTo(durationBefore)
  })

  it('keeps repeated groups compact when splitting on a repeat boundary', () => {
    useEditor.getState().setPlayhead(2)
    useEditor.getState().splitAtPlayhead()

    const after = useEditor.getState().clips
    expect(after).toHaveLength(2)
    expect(after.map((item) => item.repeat)).toEqual([1, 2])
    expect(projectDuration(after, [], [], [], [])).toBeCloseTo(6)
  })

  it('starts a loaded project with a clean undo history', () => {
    useEditor.getState().updateClip('clip-1', { volume: 0.5 })
    expect(useEditor.getState().canUndo).toBe(true)

    const project: ProjectState = {
      clips: [clip(1)], overlays: [], audios: [], backgrounds: [], texts: [],
      aspectRatio: '16:9', exportSettings: { height: 720, format: 'mp4', filename: 'loaded' },
    }
    useEditor.getState().replaceProject(project)

    expect(useEditor.getState().canUndo).toBe(false)
    expect(useEditor.getState().canRedo).toBe(false)
  })

  it('keeps fades inside half of the edited clip and stores timeline markers', () => {
    useEditor.getState().updateClip('clip-1', { fadeIn: 20, fadeOut: 20 })
    expect(useEditor.getState().clips[0].fadeIn).toBeCloseTo(3)
    expect(useEditor.getState().clips[0].fadeOut).toBeCloseTo(3)

    useEditor.getState().addMarker(2.5)
    const marker = useEditor.getState().markers[0]
    expect(marker.time).toBe(2.5)
    useEditor.getState().updateMarker(marker.id, { time: 1.25, label: '중요 장면' })
    expect(useEditor.getState().markers[0]).toMatchObject({ time: 1.25, label: '중요 장면' })
  })

  it('adds a new position keyframe when a keyed layer is moved at another time', () => {
    const overlay: Overlay = {
      ...clip(1), id: 'overlay-1', start: 0, x: 0.2, y: 0.3, scale: 0.5, angle: 0,
      positionKeyframes: [],
    }
    useEditor.setState({ clips: [clip(1)], overlays: [overlay], playhead: 0 })
    useEditor.getState().togglePositionKeyframe('overlay', overlay.id)
    useEditor.getState().setPlayhead(1)
    useEditor.getState().updateLayerPosition('overlay', overlay.id, { x: 0.8, y: 0.7 })

    const result = useEditor.getState().overlays[0]
    expect(result.positionKeyframes).toHaveLength(2)
    expect(positionAt(result, 0.5).x).toBeGreaterThan(0.2)
    expect(positionAt(result, 1)).toMatchObject({ x: 0.8, y: 0.7 })
  })
})
