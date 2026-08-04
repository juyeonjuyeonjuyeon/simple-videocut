import { create } from 'zustand'
import type { Clip, Overlay, AudioClip, TextOverlay, Background, Selection, AspectRatio, ExportSettings, Crop } from './types'
import { NO_CROP, FONT_OPTIONS } from './types'
import type { ProjectState } from './utils/project'
import { assertMediaCapacity, probeVideo, probeImage, probeAudio, nextClipColor, isVideoFile, isImageFile, isAudioFile } from './utils/media'
import { clipTimelineDuration, clipStartOffsets, projectDuration, overlayLength, audioLength } from './utils/time'

const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)

const IMAGE_NOMINAL_MAX = 3600 // images can be stretched up to this length (s)
const DEFAULT_IMAGE_DUR = 5

interface EditorState {
  clips: Clip[]
  overlays: Overlay[]
  audios: AudioClip[]
  texts: TextOverlay[]
  backgrounds: Background[]
  selection: Selection
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

  // ---- misc ----
  select: (sel: Selection) => void
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
const existingMediaFiles = (s: MediaState) => [...new Set(mediaItems(s).map((item) => item.file).filter((file) => file.size > 0))]
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

const TRANSFORM_DEFAULTS = { rotate: 0 as const, flipH: false, flipV: false, crop: NO_CROP }

export const useEditor = create<EditorState>((set, get) => ({
  clips: [],
  overlays: [],
  audios: [],
  texts: [],
  backgrounds: [],
  selection: null,
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
            duration: IMAGE_NOMINAL_MAX, trimStart: 0, trimEnd: DEFAULT_IMAGE_DUR,
            speed: 1, volume: 1, muted: false, hasAudio: false, color: nextClipColor(),
            ...TRANSFORM_DEFAULTS, repeat: 1,
          }
        } else {
          const { duration, hasAudio, src } = await probeVideo(file)
          clip = {
            id: uid(), kind: 'video', name: file.name, src, file,
            duration, trimStart: 0, trimEnd: duration,
            speed: 1, volume: 1, muted: false, hasAudio, color: nextClipColor(),
            ...TRANSFORM_DEFAULTS, repeat: 1,
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
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c
        const next = { ...c, ...patch }
        clampTrim(next)
        next.speed = Math.max(0.1, Math.min(next.speed, 4))
        next.volume = Math.max(0, Math.min(next.volume, 2))
        next.crop = clampCrop(next.crop)
        next.repeat = Math.max(1, Math.min(Math.round(next.repeat), 99))
        return next
      }),
    })),

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
        const cutSource = c.trimStart + (playhead - start) * c.speed
        const left: Clip = { ...c, id: uid(), trimEnd: cutSource }
        const right: Clip = { ...c, id: uid(), trimStart: cutSource }
        const nextClips = [...clips.slice(0, i), left, right, ...clips.slice(i + 1)]
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
    const ov: Overlay = { ...c, start, x: 0.5, y: 0.5, scale: 0.5, angle: 0 }
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
    const bg: Background = { ...s.clips[i], start }
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
      duration: IMAGE_NOMINAL_MAX, trimStart: 0, trimEnd: DEFAULT_IMAGE_DUR,
      speed: 1, volume: 1, muted: false, hasAudio: false, color: '#3a4250',
      ...TRANSFORM_DEFAULTS, repeat: 1, bgColor: '#000000', start: get().playhead,
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
      const { start: _s, ...clip } = b
      void _s
      return {
        backgrounds: s.backgrounds.filter((x) => x.id !== id),
        clips: [...s.clips, clip as Clip],
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
          start, x: 0.5, y: 0.5, scale: 0.4, angle: 0, speed: 1, volume: 1, muted: false,
          ...TRANSFORM_DEFAULTS, repeat: 1,
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
        next.start = Math.max(0, next.start)
        next.crop = clampCrop(next.crop)
        next.repeat = Math.max(1, Math.min(Math.round(next.repeat), 99))
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
      const { start: _s, x: _x, y: _y, scale: _sc, ...clip } = o
      void _s; void _x; void _y; void _sc
      return {
        overlays: s.overlays.filter((x) => x.id !== id),
        clips: [...s.clips, clip as Clip],
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
          duration, trimStart: 0, trimEnd: duration,
          volume: 1, muted: false, color: nextClipColor(), start: get().playhead, repeat: 1,
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

  // ---------- misc ----------
  select: (sel) => set({ selection: sel }),
  setAspectRatio: (r) => set({ aspectRatio: r }),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (p) => set({ isPlaying: p }),
  setLoop: (l) => set({ loop: l }),
  setExportSettings: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),

  deleteSelected: () => {
    const { selection } = get()
    if (!selection) return
    if (selection.type === 'clip') get().removeClip(selection.id)
    else if (selection.type === 'overlay') get().removeOverlay(selection.id)
    else if (selection.type === 'audio') get().removeAudio(selection.id)
    else if (selection.type === 'text') get().removeText(selection.id)
    else if (selection.type === 'background') get().removeBackground(selection.id)
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

  replaceProject: (p) => {
    set({
      clips: p.clips,
      // Backfill fields added in newer versions so older saves stay valid.
      overlays: p.overlays.map((o) => ({ ...o, angle: o.angle ?? 0 })),
      audios: p.audios, backgrounds: p.backgrounds,
      texts: p.texts.map((t) => ({ ...t, angle: t.angle ?? 0 })),
      aspectRatio: p.aspectRatio, exportSettings: p.exportSettings,
      selection: null, playhead: 0, isPlaying: false,
    })
  },
}))

type EditorSnapshot = Pick<EditorState,
  'clips' | 'overlays' | 'audios' | 'texts' | 'backgrounds' | 'aspectRatio' | 'exportSettings'>

const takeSnapshot = (s: EditorState): EditorSnapshot => ({
  clips: s.clips, overlays: s.overlays, audios: s.audios, texts: s.texts,
  backgrounds: s.backgrounds, aspectRatio: s.aspectRatio, exportSettings: s.exportSettings,
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

function undoEditor() {
  const target = past.pop()
  if (!target) return
  future.push(takeSnapshot(useEditor.getState()))
  applyingHistory = true
  useEditor.setState({ ...target, selection: null, isPlaying: false, canUndo: past.length > 0, canRedo: true })
  applyingHistory = false
}

function redoEditor() {
  const target = future.pop()
  if (!target) return
  past.push(takeSnapshot(useEditor.getState()))
  applyingHistory = true
  useEditor.setState({ ...target, selection: null, isPlaying: false, canUndo: true, canRedo: future.length > 0 })
  applyingHistory = false
}

useEditor.subscribe((state, previous) => {
  if (applyingHistory) return
  const key = historyKey(state, previous)
  if (!key) return
  const now = Date.now()
  if (key !== lastHistoryKey || now - lastHistoryAt > 450) past.push(takeSnapshot(previous))
  lastHistoryKey = key
  lastHistoryAt = now
  future = []
  if (past.length > 50) {
    const dropped = past.shift()
    if (dropped) releaseSnapshotMedia(dropped)
  }
  if (!state.canUndo || state.canRedo) useEditor.setState({ canUndo: true, canRedo: false })
})
