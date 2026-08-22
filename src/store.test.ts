import { beforeEach, describe, expect, it } from 'vitest'
import type { Clip, MediaAsset, Overlay, TextOverlay } from './types'
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
      mediaLibrary: [], clips: [clip(3)], overlays: [], audios: [], backgrounds: [], texts: [], markers: [], groups: [], selectedItems: [],
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

  it('keeps exact custom canvas dimensions when replacing a project', () => {
    const project: ProjectState = {
      clips: [clip(1)], overlays: [], audios: [], backgrounds: [], texts: [],
      aspectRatio: 'custom', canvasWidth: 1200, canvasHeight: 628,
      exportSettings: { height: 628, format: 'mp4', filename: 'custom-canvas' },
    }
    useEditor.getState().replaceProject(project)
    expect(useEditor.getState()).toMatchObject({ aspectRatio: 'custom', canvasWidth: 1200, canvasHeight: 628 })
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

  it('clamps non-destructive color filter settings', () => {
    useEditor.getState().updateClip('clip-1', { filterPreset: 'warm', filterAmount: 180 })
    expect(useEditor.getState().clips[0]).toMatchObject({ filterPreset: 'warm', filterAmount: 100 })
    useEditor.getState().updateClip('clip-1', { filterAmount: -20 })
    expect(useEditor.getState().clips[0].filterAmount).toBe(0)
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

  it('applies basic motion with bounded keyframes shared by preview and export', () => {
    const overlay: Overlay = {
      ...clip(1), id: 'overlay-motion', start: 0, x: 0.5, y: 0.5, scale: 0.5, angle: 0,
      positionKeyframes: [],
    }
    useEditor.setState({ overlays: [overlay], playhead: 0 })

    useEditor.getState().applyBasicMotion('overlay', overlay.id, 'rise')

    const animated = useEditor.getState().overlays[0]
    expect(animated.basicMotion).toBe('rise')
    expect(animated.positionKeyframes).toHaveLength(2)
    expect(animated.fadeIn).toBeGreaterThan(0)
    expect(positionAt(animated, 0).y).toBeGreaterThan(positionAt(animated, 1).y)

    useEditor.getState().clearPositionKeyframes('overlay', overlay.id)
    expect(useEditor.getState().overlays[0].basicMotion).toBeUndefined()
  })

  it('moves grouped free layers together and follows a grouped main clip trim', () => {
    const overlay: Overlay = {
      ...clip(1), id: 'overlay-1', start: 0.5, x: 0.2, y: 0.3, scale: 0.5, angle: 0,
      positionKeyframes: [],
    }
    useEditor.setState({ clips: [clip(1)], overlays: [overlay], groups: [], selectedItems: [], selection: null })
    useEditor.getState().select({ type: 'clip', id: 'clip-1' })
    useEditor.getState().select({ type: 'overlay', id: 'overlay-1' }, true)
    useEditor.getState().groupSelected()

    useEditor.getState().moveTimelineItems([{ type: 'overlay', id: 'overlay-1' }], 1)
    expect(useEditor.getState().overlays[0].start).toBeCloseTo(1.5)

    useEditor.getState().updateClip('clip-1', { trimEnd: 1 })
    const resized = useEditor.getState().overlays[0]
    expect(resized.start).toBeCloseTo(0.75)
    expect(resized.timelineDuration).toBeCloseTo(1)

    const second = { ...overlay, id: 'overlay-2', start: 2 }
    useEditor.setState({ overlays: [...useEditor.getState().overlays, second] })
    useEditor.getState().select({ type: 'overlay', id: 'overlay-1' })
    useEditor.getState().select({ type: 'overlay', id: second.id }, true)
    useEditor.getState().groupSelected()
    expect(useEditor.getState().groups).toHaveLength(1)
    expect(useEditor.getState().groups[0].members).toEqual(expect.arrayContaining([
      { type: 'clip', id: 'clip-1' },
      { type: 'overlay', id: 'overlay-1' },
      { type: 'overlay', id: 'overlay-2' },
    ]))
  })

  it('reorders text and media inside one shared visual stack', () => {
    const overlay: Overlay = {
      ...clip(1), id: 'overlay-1', start: 0, x: 0.5, y: 0.5, scale: 0.5, angle: 0,
      positionKeyframes: [],
    }
    const text: TextOverlay = {
      id: 'text-1', text: '제목', start: 0, end: 2, x: 0.5, y: 0.5, size: 0.08,
      color: '#fff', colorAlpha: 1, box: false, boxColor: '#000', boxAlpha: 0,
      font: 'sans-serif', strokeWidth: 0, strokeColor: '#000', shadow: false,
      shadowColor: '#000', shadowBlur: 0, shadowDist: 0, align: 'center', angle: 0,
    }
    useEditor.setState({
      overlays: [overlay], texts: [text],
      visualOrder: [{ type: 'overlay', id: overlay.id }, { type: 'text', id: text.id }],
    })

    useEditor.getState().raiseOverlay(overlay.id, 1)

    expect(useEditor.getState().visualOrder).toEqual([
      { type: 'text', id: text.id },
      { type: 'overlay', id: overlay.id },
    ])
  })

  it('reuses one media-bin source on multiple tracks without deleting timeline instances', () => {
    const file = new File(['image'], 'still.png', { type: 'image/png' })
    const asset: MediaAsset = {
      id: 'asset-1', kind: 'image', name: file.name, src: 'blob:still', file,
      sourceSize: file.size, duration: 5, hasAudio: false,
    }
    useEditor.setState({ mediaLibrary: [asset], clips: [], overlays: [], visualOrder: [], selection: null })

    useEditor.getState().addMediaAssetToTimeline(asset.id, 'main')
    useEditor.getState().addMediaAssetToTimeline(asset.id, 'overlay')

    expect(useEditor.getState().clips[0].assetId).toBe(asset.id)
    expect(useEditor.getState().overlays[0].assetId).toBe(asset.id)
    useEditor.getState().removeMediaAsset(asset.id)
    expect(useEditor.getState().mediaLibrary).toHaveLength(0)
    expect(useEditor.getState().clips).toHaveLength(1)
    expect(useEditor.getState().overlays).toHaveLength(1)
  })

  it('adds an editable shape at the playhead without polluting the media bin', () => {
    useEditor.setState({
      mediaLibrary: [], clips: [clip(1)], overlays: [], visualOrder: [],
      playhead: 1.25, selection: null, selectedItems: [],
    })

    useEditor.getState().addShape('star')

    const state = useEditor.getState()
    expect(state.overlays).toHaveLength(1)
    expect(state.overlays[0]).toMatchObject({
      kind: 'image', start: 1.25, trimStart: 0, trimEnd: 5,
      shape: { kind: 'star', fillColor: '#e27f92', fillOpacity: 1 },
    })
    expect(state.mediaLibrary).toHaveLength(0)
    expect(state.selection).toEqual({ type: 'overlay', id: state.overlays[0].id })
    expect(state.visualOrder).toContainEqual({ type: 'overlay', id: state.overlays[0].id })

    useEditor.getState().moveOverlayToMain(state.overlays[0].id)
    expect(useEditor.getState().overlays).toHaveLength(1)
    expect(useEditor.getState().clips).toHaveLength(1)
  })

  it('adds an offline sticker through the same restorable overlay path', () => {
    useEditor.setState({
      mediaLibrary: [], clips: [clip(1)], overlays: [], visualOrder: [],
      playhead: 0.75, selection: null, selectedItems: [],
    })

    useEditor.getState().addSticker('sparkles')

    const state = useEditor.getState()
    expect(state.mediaLibrary).toHaveLength(0)
    expect(state.overlays[0]).toMatchObject({
      kind: 'image', start: 0.75, trimStart: 0, trimEnd: 5,
      sticker: { kind: 'sparkles' }, muted: true,
    })
    expect(state.overlays[0].file.type).toBe('image/png')
  })
})
