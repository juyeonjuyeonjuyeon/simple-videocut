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
      mediaLibrary: [], clips: [clip(3)], overlays: [], audios: [], backgrounds: [], texts: [], captionTracks: [], markers: [], groups: [], selectedItems: [],
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

  it('preserves a styled text layer when a saved project is restored', () => {
    const text: TextOverlay = {
      id: 'text-restored', text: '기존 일반 텍스트', start: 0.25, end: 1.75,
      x: 0.35, y: 0.72, size: 0.09, color: '#fefefe', colorAlpha: 0.85,
      box: true, boxColor: '#123456', boxAlpha: 0.4, font: 'sans-serif',
      strokeWidth: 0.08, strokeColor: '#010101', shadow: true,
      shadowColor: '#222222', shadowBlur: 0.15, shadowDist: 0.05,
      align: 'right', angle: 12, opacity: 0.9, locked: true, hidden: false,
      fadeIn: 0.2, fadeOut: 0.3, positionKeyframes: [],
    }
    const project: ProjectState = {
      clips: [clip(1)], overlays: [], audios: [], backgrounds: [], texts: [text],
      visualOrder: [{ type: 'text', id: text.id }],
      aspectRatio: '16:9', exportSettings: { height: 720, format: 'mp4', filename: 'text-restore' },
    }

    useEditor.getState().replaceProject(project)

    expect(useEditor.getState().texts).toEqual([text])
    expect(useEditor.getState().visualOrder).toEqual([{ type: 'text', id: text.id }])
    expect(useEditor.getState().selection).toBeNull()
  })

  it('edits dedicated caption cues without turning them into regular text layers', () => {
    const trackId = useEditor.getState().addCaptionTrack('한국어 자막')
    const cueId = useEditor.getState().addCaptionCue(trackId, 0.5)
    expect(cueId).not.toBeNull()

    useEditor.getState().updateCaptionCue(trackId, cueId!, {
      text: '첫 번째 자막', start: 0.75, end: 2.25, style: { color: '#ffccdd' },
    })

    const state = useEditor.getState()
    expect(state.texts).toHaveLength(0)
    expect(state.captionTracks[0]).toMatchObject({ name: '한국어 자막', language: 'und', hidden: false, locked: false })
    expect(state.captionTracks[0].cues[0]).toMatchObject({
      id: cueId, text: '첫 번째 자막', start: 0.75, end: 2.25, origin: 'manual', style: { color: '#ffccdd' },
    })
  })

  it('moves, duplicates, and deletes caption cues through shared timeline actions', () => {
    const trackId = useEditor.getState().addCaptionTrack('편집 자막')
    const cueId = useEditor.getState().addCaptionCue(trackId, 0.5)!
    useEditor.getState().select({ type: 'caption', id: cueId })

    useEditor.getState().moveTimelineItems([{ type: 'caption', id: cueId }], 0.75)
    expect(useEditor.getState().captionTracks[0].cues[0].start).toBeCloseTo(1.25)

    useEditor.getState().duplicateSelected()
    const duplicated = useEditor.getState().selection
    expect(duplicated?.type).toBe('caption')
    expect(useEditor.getState().captionTracks[0].cues).toHaveLength(2)

    useEditor.getState().deleteSelected()
    expect(useEditor.getState().captionTracks[0].cues).toHaveLength(1)
    expect(useEditor.getState().captionTracks[0].cues[0].id).toBe(cueId)
  })

  it('imports SRT cues in append or replace mode as one track edit', () => {
    const trackId = useEditor.getState().addCaptionTrack('SRT')
    const manualId = useEditor.getState().addCaptionCue(trackId, 0)!
    useEditor.getState().select({ type: 'caption', id: manualId })

    expect(useEditor.getState().importCaptionCues(trackId, [{ text: '추가', start: 1, end: 2 }])).toBe(1)
    expect(useEditor.getState().captionTracks[0].cues.map((cue) => cue.origin)).toEqual(['manual', 'imported'])

    expect(useEditor.getState().importCaptionCues(trackId, [{ text: '교체', start: 3, end: 4 }], true)).toBe(1)
    expect(useEditor.getState().captionTracks[0].cues).toMatchObject([{ text: '교체', start: 3, end: 4, origin: 'imported' }])
    expect(useEditor.getState().selection).toBeNull()
  })

  it('keeps automatically bound captions aligned through main-track edits', () => {
    const first = clip(1)
    const second = { ...clip(1), id: 'clip-2', name: 'second.mp4' }
    useEditor.setState({ clips: [first, second], audios: [], captionTracks: [] })
    const trackId = useEditor.getState().addCaptionTrack('연결 자막')
    const cueId = useEditor.getState().addCaptionCue(trackId, 2.25)!
    useEditor.getState().updateCaptionCue(trackId, cueId, { end: 3 })

    expect(useEditor.getState().captionTracks[0].cues[0]).toMatchObject({
      start: 2.25, end: 3, source: { type: 'clip', id: 'clip-2', offsetStart: 0.25, offsetEnd: 1 },
    })

    useEditor.getState().updateClip('clip-1', { trimEnd: 1 })
    expect(useEditor.getState().captionTracks[0].cues[0]).toMatchObject({ start: 1.25, end: 2 })

    useEditor.getState().reorderClip('clip-2', 0)
    expect(useEditor.getState().captionTracks[0].cues[0]).toMatchObject({ start: 0.25, end: 1 })

    useEditor.getState().removeClip('clip-2')
    expect(useEditor.getState().captionTracks[0].cues[0]).toMatchObject({ start: 0.25, end: 1 })
    expect(useEditor.getState().captionTracks[0].cues[0].source).toBeUndefined()
  })

  it('can bind a caption to an audio source and follows its timeline move', () => {
    const audio = {
      id: 'audio-1', name: 'voice.m4a', src: '', file: new File([], 'voice.m4a'), sourceSize: 0,
      duration: 4, trimStart: 0, trimEnd: 4, volume: 1, muted: false, color: '#000', start: 0, repeat: 1,
    }
    useEditor.setState({ clips: [clip(1)], audios: [audio], captionTracks: [] })
    const trackId = useEditor.getState().addCaptionTrack('음성 자막')
    const cueId = useEditor.getState().addCaptionCue(trackId, 0.5)!

    expect(useEditor.getState().setCaptionCueSource(trackId, cueId, { type: 'audio', id: audio.id })).toBe(true)
    useEditor.getState().updateAudio(audio.id, { start: 2 })

    expect(useEditor.getState().captionTracks[0].cues[0]).toMatchObject({
      start: 2.5, end: 4, source: { type: 'audio', id: audio.id, offsetStart: 0.5, offsetEnd: 2 },
    })
  })

  it('rebinds a contained caption to the correct main-track piece after a split', () => {
    useEditor.setState({ clips: [clip(1)], audios: [], captionTracks: [], playhead: 1 })
    const trackId = useEditor.getState().addCaptionTrack('분할 자막')
    const cueId = useEditor.getState().addCaptionCue(trackId, 0.2)!
    useEditor.getState().updateCaptionCue(trackId, cueId, { end: 0.8 })

    useEditor.getState().splitAtPlayhead()

    const state = useEditor.getState()
    expect(state.clips).toHaveLength(2)
    expect(state.captionTracks[0].cues[0]).toMatchObject({
      start: 0.2, end: 0.8, source: { type: 'clip', id: state.clips[0].id, offsetStart: 0.2, offsetEnd: 0.8 },
    })
  })

  it('migrates older projects to an empty dedicated caption collection', () => {
    const legacyProject: ProjectState = {
      clips: [clip(1)], overlays: [], audios: [], backgrounds: [], texts: [],
      aspectRatio: '16:9', exportSettings: { height: 720, format: 'mp4', filename: 'legacy' },
    }

    useEditor.getState().replaceProject(legacyProject)

    expect(useEditor.getState().captionTracks).toEqual([])
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
})
