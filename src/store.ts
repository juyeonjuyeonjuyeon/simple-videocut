import { create } from 'zustand'
import type { Clip, Overlay, AudioClip, TextOverlay, Background, Selection, AspectRatio, ExportSettings, Crop, TimelineMarker, KeyframeEasing, TimelineItemRef, TimelineGroup } from './types'
import { NO_CROP, FONT_OPTIONS } from './types'
import type { ProjectState } from './utils/project'
import { assertMediaCapacity, probeVideo, probeImage, probeAudio, nextClipColor, isVideoFile, isImageFile, isAudioFile } from './utils/media'
import { clipTimelineDuration, clipStartOffsets, projectDuration, overlayLength, audioLength, exactDurationPatch } from './utils/time'
import { keyframeAt, positionAt } from './utils/motion'

const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)
const registerNativeMedia = async (file: File) => {
  if (!window.simplecutDesktop) return undefined
  try { return (await window.simplecutDesktop.registerMedia(file)).id }
  catch (error) { console.warn('데스크톱 미디어 등록을 나중으로 미룹니다.', error); return undefined }
}

const IMAGE_NOMINAL_MAX = 3600 // images can be stretched up to this length (s)
const DEFAULT_IMAGE_DUR = 5

interface EditorState {
  clips: Clip[]
  overlays: Overlay[]
  audios: AudioClip[]
  texts: TextOverlay[]
  backgrounds: Background[]
  markers: TimelineMarker[]
  groups: TimelineGroup[]
  selection: Selection
  selectedItems: TimelineItemRef[]
  aspectRatio: AspectRatio
  playhead: number
  isPlaying: boolean
  loop: boolean
  exportSettings: ExportSettings

  // ---- main track (video + image) ----
  addFiles: (files: FileList | File[]) => Promise<void>
  removeClip: (id: string) => void
  updateClip: (id: string, patch: Partial<Clip>) => void
  moveClip: (id: string, dir: -1 | 1) => void
  reorderClip: (id: string, toIndex: number) => void
  splitAtPlayhead: () => void
  moveClipToOverlay: (id: string) => void
  moveClipToBackground: (id: string) => void

  // ---- background layer (behind the main track) ----
  addBackground: () => void
  updateBackground: (id: string, patch: Partial<Background>) => void
  removeBackground: (id: string) => void
  raiseBackground: (id: string, dir: -1 | 1) => void
  moveBackgroundToMain: (id: string) => void

  // ---- overlay (PiP) layers ----
  addOverlayFiles: (files: FileList | File[]) => Promise<void>
  updateOverlay: (id: string, patch: Partial<Overlay>) => void
  removeOverlay: (id: string) => void
  raiseOverlay: (id: string, dir: -1 | 1) => void
  moveOverlayToMain: (id: string) => void

  // ---- audio / music ----
  addAudioFiles: (files: FileList | File[]) => Promise<void>
  updateAudio: (id: string, patch: Partial<AudioClip>) => void
  removeAudio: (id: string) => void

  // ---- text overlays ----
  addText: () => void
  updateText: (id: string, patch: Partial<TextOverlay>) => void
  removeText: (id: string) => void
  raiseText: (id: string, dir: -1 | 1) => void

  // ---- timeline markers ----
  addMarker: (time?: number) => void
  updateMarker: (id: string, patch: Partial<TimelineMarker>) => void
  removeMarker: (id: string) => void

  // ---- position keyframes (overlay + text) ----
  updateLayerPosition: (type: 'overlay' | 'text', id: string, patch: Partial<{ x: number; y: number }>) => void
  togglePositionKeyframe: (type: 'overlay' | 'text', id: string) => void
  clearPositionKeyframes: (type: 'overlay' | 'text', id: string) => void
  setPositionKeyframeEasing: (type: 'overlay' | 'text', id: string, keyframeId: string, easing: KeyframeEasing) => void

  // ---- misc ----
  select: (sel: Selection, additive?: boolean) => void
  groupSelected: () => void
  ungroupSelected: () => void
  moveTimelineItems: (items: TimelineItemRef[], delta: number) => void
  setAspectRatio: (r: AspectRatio) => void
  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  setLoop: (l: boolean) => void
  setExportSettings: (patch: Partial<ExportSettings>) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  replaceProject: (p: ProjectState) => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

type MediaState = Pick<EditorState, 'clips' | 'overlays' | 'audios' | 'backgrounds'>
const mediaItems = (s: MediaState) => [...s.clips, ...s.overlays, ...s.audios, ...s.backgrounds]
const existingMediaFiles = (s: MediaState) => {
  const seen = new Set<File | string>()
  return mediaItems(s).flatMap((item) => {
    if (!item.sourceSize) return []
    const key = item.nativeMediaId || item.file
    if (seen.has(key)) return []
    seen.add(key)
    return [{ name: item.name, size: item.sourceSize }]
  })
}
const allowMediaBatch = (files: File[], state: MediaState) => {
  try { assertMediaCapacity(files, existingMediaFiles(state)); return true }
  catch (error) { alert((error as Error).message); return false }
}

const clampTrim = (c: { trimStart: number; trimEnd: number; duration: number }) => {
  c.trimStart = Math.max(0, Math.min(c.trimStart, c.duration - 0.1))
  c.trimEnd = Math.max(c.trimStart + 0.1, Math.min(c.trimEnd, c.duration))
}

const clampCrop = (c: Crop): Crop => ({
  top: Math.max(0, Math.min(c.top, 0.45)),
  right: Math.max(0, Math.min(c.right, 0.45)),
  bottom: Math.max(0, Math.min(c.bottom, 0.45)),
  left: Math.max(0, Math.min(c.left, 0.45)),
})

const clampFades = <T extends { fadeIn?: number; fadeOut?: number }>(item: T, length: number): T => {
  const max = Math.max(0, length / 2)
  item.fadeIn = Math.max(0, Math.min(item.fadeIn ?? 0, max))
  item.fadeOut = Math.max(0, Math.min(item.fadeOut ?? 0, max))
  return item
}

const DURATION_KEYS = ['trimStart', 'trimEnd', 'speed', 'repeat'] as const
const normalizeExactDuration = (
  item: { timelineDuration?: number; repeat: number },
  patch: object,
  baseLength: number,
) => {
  const changedDurationInput = DURATION_KEYS.some((key) => Object.prototype.hasOwnProperty.call(patch, key))
  const suppliedExact = Object.prototype.hasOwnProperty.call(patch, 'timelineDuration')
  if (changedDurationInput && !suppliedExact) delete item.timelineDuration
  if (item.timelineDuration != null) {
    item.timelineDuration = Math.max(0.1, Math.min(item.timelineDuration, Math.max(0.1, baseLength * item.repeat)))
  }
}

const TRANSFORM_DEFAULTS = { rotate: 0 as const, flipH: false, flipV: false, crop: NO_CROP }

export const useEditor = create<EditorState>((set, get) => ({
  clips: [],
  overlays: [],
  audios: [],
  texts: [],
  backgrounds: [],
  markers: [],
  groups: [],
  selection: null,
  selectedItems: [],
  aspectRatio: '16:9',
  playhead: 0,
  isPlaying: false,
  loop: false,
  exportSettings: { height: 720, format: 'mp4', filename: 'simplecut' },
  canUndo: false,
  canRedo: false,
  undo: () => undoEditor(),
  redo: () => redoEditor(),

  // ---------- main track ----------
  addFiles: async (files) => {
    const list = Array.from(files).filter((f) => isVideoFile(f) || isImageFile(f))
    if (!list.length || !allowMediaBatch(list, get())) return
    for (const file of list) {
      try {
        let clip: Clip
        if (isImageFile(file)) {
          const { src } = await probeImage(file)
          clip = {
            id: uid(), kind: 'image', name: file.name, src, file,
            sourceSize: file.size, nativeMediaId: await registerNativeMedia(file),
            duration: IMAGE_NOMINAL_MAX, trimStart: 0, trimEnd: DEFAULT_IMAGE_DUR,
            speed: 1, volume: 1, muted: false, hasAudio: false, color: nextClipColor(),
            ...TRANSFORM_DEFAULTS, repeat: 1, fadeIn: 0, fadeOut: 0,
          }
        } else {
          const { duration, hasAudio, src } = await probeVideo(file)
          clip = {
            id: uid(), kind: 'video', name: file.name, src, file,
            sourceSize: file.size, nativeMediaId: await registerNativeMedia(file),
            duration, trimStart: 0, trimEnd: duration,
            speed: 1, volume: 1, muted: false, hasAudio, color: nextClipColor(),
            ...TRANSFORM_DEFAULTS, repeat: 1, fadeIn: 0, fadeOut: 0,
          }
        }
        set((s) => ({
          clips: [...s.clips, clip],
          selection: s.selection ?? { type: 'clip', id: clip.id },
        }))
      } catch (e) {
        console.error(e)
        alert((e as Error).message)
      }
    }
  },

  removeClip: (id) => {
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      selection: s.selection?.type === 'clip' && s.selection.id === id ? null : s.selection,
    }))
  },

  updateClip: (id, patch) =>
    set((s) => {
      const anchorIndex = s.clips.findIndex((clip) => clip.id === id)
      const anchorBefore = s.clips[anchorIndex]
      const anchorStart = anchorIndex >= 0 ? clipStartOffsets(s.clips)[anchorIndex] : 0
      const beforeLength = anchorBefore ? clipTimelineDuration(anchorBefore) : 0
      const clips = s.clips.map((c) => {
        if (c.id !== id) return c
        const next = { ...c, ...patch }
        clampTrim(next)
        next.speed = Math.max(0.1, Math.min(next.speed, 4))
        next.volume = Math.max(0, Math.min(next.volume, 2))
        next.crop = clampCrop(next.crop)
        next.repeat = Math.max(1, Math.min(Math.round(next.repeat), 99))
        normalizeExactDuration(next, patch, (next.trimEnd - next.trimStart) / next.speed)
        clampFades(next, clipTimelineDuration(next))
        return next
      })
      const anchorAfter = clips[anchorIndex]
      const afterLength = anchorAfter ? clipTimelineDuration(anchorAfter) : beforeLength
      const ratio = beforeLength > 0 ? afterLength / beforeLength : 1
      const anchoredGroups = s.groups.filter((group) => group.members.some((member) => member.type === 'clip' && member.id === id))
      if (!anchoredGroups.length || Math.abs(ratio - 1) < 1e-6) return { clips }
      const grouped = (type: TimelineItemRef['type'], itemId: string) => anchoredGroups.some((group) => group.members.some((member) => member.type === type && member.id === itemId))
      const scaleStart = (start: number) => Math.max(0, anchorStart + (start - anchorStart) * ratio)
      return {
        clips,
        overlays: s.overlays.map((item) => grouped('overlay', item.id) ? {
          ...item,
          start: scaleStart(item.start),
          ...exactDurationPatch((item.trimEnd - item.trimStart) / item.speed, overlayLength(item) * ratio),
        } : item),
        audios: s.audios.map((item) => grouped('audio', item.id) ? {
          ...item,
          start: scaleStart(item.start),
          ...exactDurationPatch(item.trimEnd - item.trimStart, audioLength(item) * ratio),
        } : item),
        backgrounds: s.backgrounds.map((item) => grouped('background', item.id) ? {
          ...item,
          start: scaleStart(item.start),
          ...exactDurationPatch((item.trimEnd - item.trimStart) / item.speed, clipTimelineDuration(item) * ratio),
        } : item),
        texts: s.texts.map((item) => {
          if (!grouped('text', item.id)) return item
          const start = scaleStart(item.start)
          return { ...item, start, end: start + (item.end - item.start) * ratio }
        }),
      }
    }),

  moveClip: (id, dir) =>
    set((s) => {
      const i = s.clips.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.clips.length) return s
      const clips = s.clips.slice()
      ;[clips[i], clips[j]] = [clips[j], clips[i]]
      return { clips }
    }),

  reorderClip: (id, toIndex) =>
    set((s) => {
      const from = s.clips.findIndex((c) => c.id === id)
      if (from < 0) return s
      const clips = s.clips.slice()
      const [item] = clips.splice(from, 1)
      const idx = Math.max(0, Math.min(toIndex, clips.length))
      if (idx === from) return s
      clips.splice(idx, 0, item)
      return { clips }
    }),

  splitAtPlayhead: () => {
    const { clips, playhead } = get()
    const offsets = clipStartOffsets(clips)
    for (let i = 0; i < clips.length; i++) {
      const start = offsets[i]
      const dur = clipTimelineDuration(clips[i])
      const end = start + dur
      if (playhead > start + 0.05 && playhead < end - 0.05) {
        const c = clips[i]
        const cycleDuration = (c.trimEnd - c.trimStart) / c.speed
        const localTime = playhead - start
        const cycleIndex = Math.min(c.repeat - 1, Math.floor(localTime / cycleDuration))
        const timeInCycle = localTime - cycleIndex * cycleDuration
        const nearStart = timeInCycle <= 0.05
        const nearEnd = cycleDuration - timeInCycle <= 0.05

        if ((nearStart || nearEnd) && c.repeat > 1) {
          const boundary = cycleIndex + (nearEnd ? 1 : 0)
          if (boundary > 0 && boundary < c.repeat) {
            const left: Clip = { ...c, id: uid(), repeat: boundary }
            const right: Clip = { ...c, id: uid(), repeat: c.repeat - boundary }
            const nextClips = [...clips.slice(0, i), left, right, ...clips.slice(i + 1)]
            set({ clips: nextClips, selection: { type: 'clip', id: right.id } })
            return
          }
        }

        const cutSource = Math.min(c.trimEnd, Math.max(c.trimStart, c.trimStart + timeInCycle * c.speed))
        const pieces: Clip[] = []
        if (cycleIndex > 0) pieces.push({ ...c, id: uid(), repeat: cycleIndex })
        const left: Clip = { ...c, id: uid(), trimEnd: cutSource, repeat: 1 }
        const right: Clip = { ...c, id: uid(), trimStart: cutSource, repeat: 1 }
        pieces.push(left, right)
        const remaining = c.repeat - cycleIndex - 1
        if (remaining > 0) pieces.push({ ...c, id: uid(), repeat: remaining })
        const nextClips = [...clips.slice(0, i), ...pieces, ...clips.slice(i + 1)]
        set({ clips: nextClips, selection: { type: 'clip', id: right.id } })
        return
      }
    }
  },

  moveClipToOverlay: (id) => {
    const s = get()
    const i = s.clips.findIndex((c) => c.id === id)
    if (i < 0) return
    const c = s.clips[i]
    if (c.kind === 'color') return
    const start = clipStartOffsets(s.clips)[i]
    const ov: Overlay = {
      ...c, start, x: 0.5, y: 0.5, scale: 0.5, scaleY: undefined, aspectLocked: true, angle: 0,
      opacity: 1, locked: false, hidden: false, positionKeyframes: [],
    }
    set({
      clips: s.clips.filter((x) => x.id !== id),
      overlays: [...s.overlays, ov],
      selection: { type: 'overlay', id: ov.id },
    })
  },

  moveClipToBackground: (id) => {
    const s = get()
    const i = s.clips.findIndex((c) => c.id === id)
    if (i < 0) return
    const start = clipStartOffsets(s.clips)[i]
    const bg: Background = { ...s.clips[i], start, opacity: 1, locked: false, hidden: false }
    set({
      clips: s.clips.filter((x) => x.id !== id),
      backgrounds: [...s.backgrounds, bg],
      selection: { type: 'background', id: bg.id },
    })
  },

  // ---------- background layer ----------
  addBackground: () => {
    const bg: Background = {
      id: uid(), kind: 'color', name: '단색 배경', src: '', file: new File([], 'bg'),
      sourceSize: 0,
      duration: IMAGE_NOMINAL_MAX, trimStart: 0, trimEnd: DEFAULT_IMAGE_DUR,
      speed: 1, volume: 1, muted: false, hasAudio: false, color: '#3a4250',
      ...TRANSFORM_DEFAULTS, repeat: 1, fadeIn: 0, fadeOut: 0, bgColor: '#000000', start: get().playhead,
      opacity: 1, locked: false, hidden: false,
    }
    set((s) => ({ backgrounds: [...s.backgrounds, bg], selection: { type: 'background', id: bg.id } }))
  },

  updateBackground: (id, patch) =>
    set((s) => ({
      backgrounds: s.backgrounds.map((b) => {
        if (b.id !== id) return b
        const next = { ...b, ...patch }
        clampTrim(next)
        next.speed = Math.max(0.1, Math.min(next.speed, 4))
        next.volume = Math.max(0, Math.min(next.volume, 2))
        next.repeat = Math.max(1, Math.min(Math.round(next.repeat), 99))
        next.start = Math.max(0, next.start)
        next.crop = clampCrop(next.crop)
        next.opacity = Math.max(0, Math.min(next.opacity ?? 1, 1))
        normalizeExactDuration(next, patch, (next.trimEnd - next.trimStart) / next.speed)
        clampFades(next, clipTimelineDuration(next))
        return next
      }),
    })),

  removeBackground: (id) => {
    set((s) => ({
      backgrounds: s.backgrounds.filter((b) => b.id !== id),
      selection: s.selection?.type === 'background' && s.selection.id === id ? null : s.selection,
    }))
  },

  raiseBackground: (id, dir) =>
    set((s) => {
      const i = s.backgrounds.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.backgrounds.length) return s
      const backgrounds = s.backgrounds.slice()
      ;[backgrounds[i], backgrounds[j]] = [backgrounds[j], backgrounds[i]]
      return { backgrounds }
    }),

  moveBackgroundToMain: (id) =>
    set((s) => {
      const b = s.backgrounds.find((x) => x.id === id)
      if (!b) return s
      const { start: _s, opacity: _o, locked: _l, hidden: _h, ...clip } = b
      void _s; void _o; void _l; void _h
      const offsets = clipStartOffsets(s.clips)
      const insertAt = offsets.findIndex((offset) => offset >= b.start - 1e-6)
      const index = insertAt < 0 ? s.clips.length : insertAt
      return {
        backgrounds: s.backgrounds.filter((x) => x.id !== id),
        clips: [...s.clips.slice(0, index), clip as Clip, ...s.clips.slice(index)],
        selection: { type: 'clip', id: clip.id },
      }
    }),

  // ---------- overlays ----------
  addOverlayFiles: async (files) => {
    const list = Array.from(files).filter((f) => isVideoFile(f) || isImageFile(f))
    if (!list.length || !allowMediaBatch(list, get())) return
    for (const file of list) {
      try {
        const start = get().playhead
        let ov: Overlay
        const base = {
          id: uid(), name: file.name, file, color: nextClipColor(),
          sourceSize: file.size, nativeMediaId: await registerNativeMedia(file),
          start, x: 0.5, y: 0.5, scale: 0.4, scaleY: undefined, aspectLocked: true, angle: 0, speed: 1, volume: 1, muted: false,
          ...TRANSFORM_DEFAULTS, repeat: 1, opacity: 1, locked: false, hidden: false,
          fadeIn: 0, fadeOut: 0, positionKeyframes: [],
        }
        if (isImageFile(file)) {
          const { src } = await probeImage(file)
          ov = { ...base, kind: 'image', src, duration: IMAGE_NOMINAL_MAX, trimStart: 0, trimEnd: DEFAULT_IMAGE_DUR, hasAudio: false }
        } else {
          const { duration, hasAudio, src } = await probeVideo(file)
          ov = { ...base, kind: 'video', src, duration, trimStart: 0, trimEnd: duration, hasAudio }
        }
        set((s) => ({ overlays: [...s.overlays, ov], selection: { type: 'overlay', id: ov.id } }))
      } catch (e) {
        console.error(e)
        alert((e as Error).message)
      }
    }
  },

  updateOverlay: (id, patch) =>
    set((s) => ({
      overlays: s.overlays.map((o) => {
        if (o.id !== id) return o
        const next = { ...o, ...patch }
        clampTrim(next)
        next.speed = Math.max(0.1, Math.min(next.speed, 4))
        next.volume = Math.max(0, Math.min(next.volume, 2))
        next.x = Math.max(0, Math.min(next.x, 1))
        next.y = Math.max(0, Math.min(next.y, 1))
        next.scale = Math.max(0.1, Math.min(next.scale, 1))
        if (next.scaleY != null) next.scaleY = Math.max(0.05, Math.min(next.scaleY, 1))
        next.aspectLocked = next.aspectLocked ?? true
        next.start = Math.max(0, next.start)
        next.crop = clampCrop(next.crop)
        next.repeat = Math.max(1, Math.min(Math.round(next.repeat), 99))
        normalizeExactDuration(next, patch, (next.trimEnd - next.trimStart) / next.speed)
        next.opacity = Math.max(0, Math.min(next.opacity ?? 1, 1))
        clampFades(next, overlayLength(next))
        next.positionKeyframes = (next.positionKeyframes ?? [])
          .map((frame) => ({ ...frame, time: Math.max(0, Math.min(frame.time, overlayLength(next))) }))
          .sort((a, b) => a.time - b.time)
        return next
      }),
    })),

  removeOverlay: (id) => {
    set((s) => ({
      overlays: s.overlays.filter((o) => o.id !== id),
      selection: s.selection?.type === 'overlay' && s.selection.id === id ? null : s.selection,
    }))
  },

  raiseOverlay: (id, dir) =>
    set((s) => {
      const i = s.overlays.findIndex((o) => o.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.overlays.length) return s
      const overlays = s.overlays.slice()
      ;[overlays[i], overlays[j]] = [overlays[j], overlays[i]]
      return { overlays }
    }),

  moveOverlayToMain: (id) =>
    set((s) => {
      const o = s.overlays.find((x) => x.id === id)
      if (!o) return s
      // Drop the overlay-only fields; the rest is a Clip.
      const {
        start: _s, x: _x, y: _y, scale: _sc, scaleY: _sy, aspectLocked: _al, angle: _a,
        opacity: _o, locked: _l, hidden: _h, positionKeyframes: _pk, ...clip
      } = o
      void _s; void _x; void _y; void _sc; void _sy; void _al; void _a; void _o; void _l; void _h; void _pk
      const offsets = clipStartOffsets(s.clips)
      const insertAt = offsets.findIndex((offset) => offset >= o.start - 1e-6)
      const index = insertAt < 0 ? s.clips.length : insertAt
      return {
        overlays: s.overlays.filter((x) => x.id !== id),
        clips: [...s.clips.slice(0, index), clip as Clip, ...s.clips.slice(index)],
        selection: { type: 'clip', id: clip.id },
      }
    }),

  // ---------- audio ----------
  addAudioFiles: async (files) => {
    const list = Array.from(files).filter((f) => isAudioFile(f))
    if (!list.length || !allowMediaBatch(list, get())) return
    for (const file of list) {
      try {
        const { duration, src } = await probeAudio(file)
        const a: AudioClip = {
          id: uid(), name: file.name, src, file,
          sourceSize: file.size, nativeMediaId: await registerNativeMedia(file),
          duration, trimStart: 0, trimEnd: duration,
          volume: 1, muted: false, color: nextClipColor(), start: get().playhead, repeat: 1,
          fadeIn: 0, fadeOut: 0,
        }
        set((s) => ({ audios: [...s.audios, a], selection: { type: 'audio', id: a.id } }))
      } catch (e) {
        console.error(e)
        alert((e as Error).message)
      }
    }
  },

  updateAudio: (id, patch) =>
    set((s) => ({
      audios: s.audios.map((a) => {
        if (a.id !== id) return a
        const next = { ...a, ...patch }
        clampTrim(next)
        next.volume = Math.max(0, Math.min(next.volume, 2))
        next.start = Math.max(0, next.start)
        next.repeat = Math.max(1, Math.min(Math.round(next.repeat), 99))
        normalizeExactDuration(next, patch, next.trimEnd - next.trimStart)
        clampFades(next, audioLength(next))
        return next
      }),
    })),

  removeAudio: (id) => {
    set((s) => ({
      audios: s.audios.filter((a) => a.id !== id),
      selection: s.selection?.type === 'audio' && s.selection.id === id ? null : s.selection,
    }))
  },

  // ---------- text ----------
  addText: () => {
    const s = get()
    const dur = projectDuration(s.clips, s.overlays, s.audios, s.texts, s.backgrounds)
    const start = Math.min(s.playhead, Math.max(0, dur - 2))
    const text: TextOverlay = {
      id: uid(), text: '텍스트 입력', start, end: Math.min(start + 3, dur || start + 3),
      x: 0.5, y: 0.85, size: 0.07, color: '#ffffff', colorAlpha: 1,
      box: true, boxColor: '#000000', boxAlpha: 0.55,
      font: FONT_OPTIONS[0].value, strokeWidth: 0, strokeColor: '#000000',
      shadow: true, shadowColor: '#000000', shadowBlur: 0.12, shadowDist: 0.04,
      align: 'center', angle: 0,
      opacity: 1, locked: false, hidden: false, fadeIn: 0, fadeOut: 0, positionKeyframes: [],
    }
    set((st) => ({ texts: [...st.texts, text], selection: { type: 'text', id: text.id } }))
  },

  updateText: (id, patch) =>
    set((s) => ({
      texts: s.texts.map((t) => {
        if (t.id !== id) return t
        const n = { ...t, ...patch }
        n.x = Math.max(0, Math.min(n.x, 1))
        n.y = Math.max(0, Math.min(n.y, 1))
        n.size = Math.max(0.02, Math.min(n.size, 0.4))
        n.colorAlpha = Math.max(0, Math.min(n.colorAlpha, 1))
        n.boxAlpha = Math.max(0, Math.min(n.boxAlpha, 1))
        n.opacity = Math.max(0, Math.min(n.opacity ?? 1, 1))
        clampFades(n, Math.max(0, n.end - n.start))
        n.positionKeyframes = (n.positionKeyframes ?? [])
          .map((frame) => ({ ...frame, time: Math.max(0, Math.min(frame.time, Math.max(0, n.end - n.start))) }))
          .sort((a, b) => a.time - b.time)
        return n
      }),
    })),

  removeText: (id) =>
    set((s) => ({
      texts: s.texts.filter((t) => t.id !== id),
      selection: s.selection?.type === 'text' && s.selection.id === id ? null : s.selection,
    })),

  raiseText: (id, dir) =>
    set((s) => {
      const i = s.texts.findIndex((t) => t.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.texts.length) return s
      const texts = s.texts.slice()
      ;[texts[i], texts[j]] = [texts[j], texts[i]]
      return { texts }
    }),

  // ---------- timeline markers ----------
  addMarker: (time) => {
    const marker: TimelineMarker = {
      id: uid(),
      time: Math.max(0, time ?? get().playhead),
      label: `마커 ${get().markers.length + 1}`,
      color: '#f2a65a',
    }
    set((s) => ({ markers: [...s.markers, marker].sort((a, b) => a.time - b.time) }))
  },

  updateMarker: (id, patch) =>
    set((s) => ({
      markers: s.markers
        .map((m) => m.id === id
          ? { ...m, ...patch, time: Math.max(0, patch.time ?? m.time), label: (patch.label ?? m.label).slice(0, 120) }
          : m)
        .sort((a, b) => a.time - b.time),
    })),

  removeMarker: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),

  // ---------- position keyframes ----------
  updateLayerPosition: (type, id, patch) =>
    set((s) => {
      const update = <T extends Overlay | TextOverlay>(item: T): T => {
        if (item.id !== id) return item
        const start = item.start
        const length = type === 'overlay' ? overlayLength(item as Overlay) : (item as TextOverlay).end - start
        const local = Math.max(0, Math.min(s.playhead - start, length))
        const frames = item.positionKeyframes ?? []
        if (!frames.length) {
          return {
            ...item,
            x: Math.max(0, Math.min(patch.x ?? item.x, 1)),
            y: Math.max(0, Math.min(patch.y ?? item.y, 1)),
          }
        }
        const current = positionAt(item, local)
        const existing = keyframeAt(frames, local)
        const frame = {
          id: existing?.id ?? uid(), time: existing?.time ?? local,
          x: Math.max(0, Math.min(patch.x ?? current.x, 1)),
          y: Math.max(0, Math.min(patch.y ?? current.y, 1)),
          easing: existing?.easing ?? 'ease-in-out' as const,
        }
        return {
          ...item,
          positionKeyframes: [...frames.filter((candidate) => candidate.id !== existing?.id), frame].sort((a, b) => a.time - b.time),
        }
      }
      return type === 'overlay'
        ? { overlays: s.overlays.map((item) => update(item)) }
        : { texts: s.texts.map((item) => update(item)) }
    }),

  togglePositionKeyframe: (type, id) =>
    set((s) => {
      const update = <T extends Overlay | TextOverlay>(item: T): T => {
        if (item.id !== id) return item
        const length = type === 'overlay' ? overlayLength(item as Overlay) : (item as TextOverlay).end - item.start
        const local = Math.max(0, Math.min(s.playhead - item.start, length))
        const frames = item.positionKeyframes ?? []
        const existing = keyframeAt(frames, local)
        if (existing) return { ...item, positionKeyframes: frames.filter((frame) => frame.id !== existing.id) }
        const position = positionAt(item, local)
        return {
          ...item,
          positionKeyframes: [...frames, { id: uid(), time: local, ...position, easing: 'ease-in-out' as const }]
            .sort((a, b) => a.time - b.time),
        }
      }
      return type === 'overlay'
        ? { overlays: s.overlays.map((item) => update(item)) }
        : { texts: s.texts.map((item) => update(item)) }
    }),

  clearPositionKeyframes: (type, id) =>
    set((s) => type === 'overlay'
      ? { overlays: s.overlays.map((item) => item.id === id ? { ...item, positionKeyframes: [] } : item) }
      : { texts: s.texts.map((item) => item.id === id ? { ...item, positionKeyframes: [] } : item) }),

  setPositionKeyframeEasing: (type, id, keyframeId, easing) =>
    set((s) => {
      const patch = <T extends Overlay | TextOverlay>(item: T): T => item.id === id
        ? { ...item, positionKeyframes: (item.positionKeyframes ?? []).map((frame) => frame.id === keyframeId ? { ...frame, easing } : frame) }
        : item
      return type === 'overlay'
        ? { overlays: s.overlays.map((item) => patch(item)) }
        : { texts: s.texts.map((item) => patch(item)) }
    }),

  // ---------- misc ----------
  select: (sel, additive = false) => set((s) => {
    if (!sel) return { selection: null, selectedItems: [] }
    if (!additive) return { selection: sel, selectedItems: [sel] }
    const exists = s.selectedItems.some((item) => item.type === sel.type && item.id === sel.id)
    const selectedItems = exists
      ? s.selectedItems.filter((item) => item.type !== sel.type || item.id !== sel.id)
      : [...s.selectedItems, sel]
    return { selection: selectedItems[selectedItems.length - 1] ?? null, selectedItems }
  }),
  groupSelected: () => set((s) => {
    if (s.selectedItems.length < 2) return s
    const chosen = s.selectedItems
    const includesChosen = (group: TimelineGroup) => group.members.some((member) => chosen.some((item) => item.type === member.type && item.id === member.id))
    const groups = s.groups.filter((group) => !includesChosen(group))
    return { groups: [...groups, { id: uid(), name: `그룹 ${groups.length + 1}`, members: chosen }] }
  }),
  ungroupSelected: () => set((s) => ({
    groups: s.groups.filter((group) => !group.members.some((member) => s.selectedItems.some((item) => item.type === member.type && item.id === member.id))),
  })),
  moveTimelineItems: (items, delta) => set((s) => {
    const free = items.filter((item) => item.type !== 'clip')
    if (!free.length || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) return s
    const starts = free.map((item) => item.type === 'overlay' ? s.overlays.find((x) => x.id === item.id)?.start
      : item.type === 'audio' ? s.audios.find((x) => x.id === item.id)?.start
      : item.type === 'background' ? s.backgrounds.find((x) => x.id === item.id)?.start
      : s.texts.find((x) => x.id === item.id)?.start).filter((value): value is number => value != null)
    const applied = Math.max(delta, -(starts.length ? Math.min(...starts) : 0))
    const has = (type: TimelineItemRef['type'], id: string) => free.some((item) => item.type === type && item.id === id)
    return {
      overlays: s.overlays.map((item) => has('overlay', item.id) ? { ...item, start: item.start + applied } : item),
      audios: s.audios.map((item) => has('audio', item.id) ? { ...item, start: item.start + applied } : item),
      backgrounds: s.backgrounds.map((item) => has('background', item.id) ? { ...item, start: item.start + applied } : item),
      texts: s.texts.map((item) => has('text', item.id) ? { ...item, start: item.start + applied, end: item.end + applied } : item),
    }
  }),
  setAspectRatio: (r) => set({ aspectRatio: r }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (p) => set({ isPlaying: p }),
  setLoop: (l) => set({ loop: l }),
  setExportSettings: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),

  deleteSelected: () => {
    const s = get()
    const chosen = s.selectedItems.length ? s.selectedItems : s.selection ? [s.selection] : []
    if (!chosen.length) return
    const has = (type: TimelineItemRef['type'], id: string) => chosen.some((item) => item.type === type && item.id === id)
    const groups = s.groups.map((group) => ({ ...group, members: group.members.filter((member) => !has(member.type, member.id)) }))
      .filter((group) => group.members.length >= 2)
    set({
      clips: s.clips.filter((item) => !has('clip', item.id)),
      overlays: s.overlays.filter((item) => !has('overlay', item.id)),
      audios: s.audios.filter((item) => !has('audio', item.id)),
      texts: s.texts.filter((item) => !has('text', item.id)),
      backgrounds: s.backgrounds.filter((item) => !has('background', item.id)),
      groups, selection: null, selectedItems: [],
    })
  },

  duplicateSelected: () => {
    const s = get()
    const sel = s.selection
    if (!sel) return
    if (sel.type === 'clip') {
      const i = s.clips.findIndex((c) => c.id === sel.id)
      if (i < 0) return
      const copy: Clip = { ...s.clips[i], id: uid() }
      set({ clips: [...s.clips.slice(0, i + 1), copy, ...s.clips.slice(i + 1)], selection: { type: 'clip', id: copy.id } })
    } else if (sel.type === 'overlay') {
      const o = s.overlays.find((x) => x.id === sel.id)
      if (!o) return
      const copy: Overlay = { ...o, id: uid(), start: o.start + overlayLength(o) }
      set({ overlays: [...s.overlays, copy], selection: { type: 'overlay', id: copy.id } })
    } else if (sel.type === 'audio') {
      const a = s.audios.find((x) => x.id === sel.id)
      if (!a) return
      const copy: AudioClip = { ...a, id: uid(), start: a.start + audioLength(a) }
      set({ audios: [...s.audios, copy], selection: { type: 'audio', id: copy.id } })
    } else if (sel.type === 'text') {
      const tx = s.texts.find((x) => x.id === sel.id)
      if (!tx) return
      const len = tx.end - tx.start
      const copy: TextOverlay = { ...tx, id: uid(), start: tx.end, end: tx.end + len }
      set({ texts: [...s.texts, copy], selection: { type: 'text', id: copy.id } })
    } else if (sel.type === 'background') {
      const b = s.backgrounds.find((x) => x.id === sel.id)
      if (!b) return
      const copy: Background = { ...b, id: uid(), start: b.start + clipTimelineDuration(b) }
      set({ backgrounds: [...s.backgrounds, copy], selection: { type: 'background', id: copy.id } })
    }
  },

  replaceProject: (p) => replaceEditorProject(p),
}))

type EditorSnapshot = Pick<EditorState,
  'clips' | 'overlays' | 'audios' | 'texts' | 'backgrounds' | 'markers' | 'groups' | 'aspectRatio' | 'exportSettings'>

const takeSnapshot = (s: EditorState): EditorSnapshot => ({
  clips: s.clips, overlays: s.overlays, audios: s.audios, texts: s.texts,
  backgrounds: s.backgrounds, markers: s.markers, groups: s.groups, aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
})

const past: EditorSnapshot[] = []
let future: EditorSnapshot[] = []
let applyingHistory = false
let lastHistoryKey = ''
let lastHistoryAt = 0

const historyKey = (a: EditorState, b: EditorState) => {
  if (a.clips !== b.clips) return 'clips'
  if (a.overlays !== b.overlays) return 'overlays'
  if (a.audios !== b.audios) return 'audios'
  if (a.texts !== b.texts) return 'texts'
  if (a.backgrounds !== b.backgrounds) return 'backgrounds'
  if (a.markers !== b.markers) return 'markers'
  if (a.groups !== b.groups) return 'groups'
  if (a.aspectRatio !== b.aspectRatio) return 'aspectRatio'
  if (a.exportSettings !== b.exportSettings) return 'exportSettings'
  return ''
}

const releaseSnapshotMedia = (candidate: EditorSnapshot) => {
  const live = new Set<string>()
  const collect = (s: MediaState) => mediaItems(s).forEach((x) => { if (x.src) live.add(x.src) })
  collect(useEditor.getState())
  past.forEach(collect)
  future.forEach(collect)
  for (const item of mediaItems(candidate)) if (item.src && !live.has(item.src)) URL.revokeObjectURL(item.src)
}

function replaceEditorProject(p: ProjectState) {
  const discarded = [takeSnapshot(useEditor.getState()), ...past, ...future]
  past.length = 0
  future = []
  lastHistoryKey = ''
  lastHistoryAt = 0
  applyingHistory = true
  useEditor.setState({
    // Backfill fields added in newer versions so older saves stay valid.
    overlays: p.overlays.map((o) => ({
      ...o, angle: o.angle ?? 0, opacity: o.opacity ?? 1,
      locked: o.locked ?? false, hidden: o.hidden ?? false,
      fadeIn: o.fadeIn ?? 0, fadeOut: o.fadeOut ?? 0, positionKeyframes: o.positionKeyframes ?? [],
    })),
    audios: p.audios.map((a) => ({ ...a, fadeIn: a.fadeIn ?? 0, fadeOut: a.fadeOut ?? 0 })),
    backgrounds: p.backgrounds.map((b) => ({
      ...b, opacity: b.opacity ?? 1, locked: b.locked ?? false, hidden: b.hidden ?? false,
      fadeIn: b.fadeIn ?? 0, fadeOut: b.fadeOut ?? 0,
    })),
    texts: p.texts.map((t) => ({
      ...t, angle: t.angle ?? 0, opacity: t.opacity ?? 1,
      locked: t.locked ?? false, hidden: t.hidden ?? false,
      fadeIn: t.fadeIn ?? 0, fadeOut: t.fadeOut ?? 0, positionKeyframes: t.positionKeyframes ?? [],
    })),
    clips: p.clips.map((c) => ({ ...c, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0 })),
    markers: p.markers ?? [],
    groups: p.groups ?? [],
    aspectRatio: p.aspectRatio, exportSettings: p.exportSettings,
    selection: null, selectedItems: [], playhead: 0, isPlaying: false, canUndo: false, canRedo: false,
  })
  applyingHistory = false
  for (const snapshot of discarded) releaseSnapshotMedia(snapshot)
}

function undoEditor() {
  const target = past.pop()
  if (!target) return
  future.push(takeSnapshot(useEditor.getState()))
  applyingHistory = true
  useEditor.setState({ ...target, selection: null, selectedItems: [], isPlaying: false, canUndo: past.length > 0, canRedo: true })
  applyingHistory = false
}

function redoEditor() {
  const target = future.pop()
  if (!target) return
  past.push(takeSnapshot(useEditor.getState()))
  applyingHistory = true
  useEditor.setState({ ...target, selection: null, selectedItems: [], isPlaying: false, canUndo: true, canRedo: future.length > 0 })
  applyingHistory = false
}

useEditor.subscribe((state, previous) => {
  if (state.selection !== previous.selection && state.selectedItems === previous.selectedItems) {
    useEditor.setState({ selectedItems: state.selection ? [state.selection] : [] })
  }
  if (applyingHistory) return
  const key = historyKey(state, previous)
  if (!key) return
  const now = Date.now()
  if (key !== lastHistoryKey || now - lastHistoryAt > 450) past.push(takeSnapshot(previous))
  lastHistoryKey = key
  lastHistoryAt = now
  const abandonedFuture = future
  future = []
  for (const snapshot of abandonedFuture) releaseSnapshotMedia(snapshot)
  if (past.length > 50) {
    const dropped = past.shift()
    if (dropped) releaseSnapshotMedia(dropped)
  }
  if (!state.canUndo || state.canRedo) useEditor.setState({ canUndo: true, canRedo: false })
})
