import { useRef, useState, useLayoutEffect, useEffect, type ReactNode } from 'react'
import { useEditor } from '../store'
import {
  clipTimelineDuration,
  clipStartOffsets,
  projectDuration,
  overlayLength,
  audioLength,
  packLanes,
  formatTime,
  formatTimeFine,
} from '../utils/time'
import { contrastText } from '../utils/color'
import { packVisualLanes } from '../utils/layers'
import { startPointerDrag as startDrag } from '../utils/pointer'
import type { Clip, Selection, PositionKeyframe } from '../types'
import { AudioWaveform, ClipThumbnailStrip } from './TimelineMedia'

const clipBg = (c: Clip) => (c.kind === 'color' ? c.bgColor ?? '#000000' : c.color)

// The scale is an absolute pixels-per-second held in state, so editing a clip
// (trimming, moving) never rescales the ruler — the time axis stays put.
const MIN_PX_PER_SEC = 0.1
const MAX_PX_PER_SEC = 400
const DEFAULT_PX_PER_SEC = 60
const SNAP_PX = 7
const DRAG_THRESHOLD = 4
const OV_LANE_H = 34
const AUD_LANE_H = 30
const TXT_LANE_H = 26
const LONG_PRESS_MS = 520

type FreeKind = 'overlay' | 'audio' | 'text' | 'background'

const clampPps = (p: number) => Math.max(MIN_PX_PER_SEC, Math.min(p, MAX_PX_PER_SEC))

export default function Timeline() {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const backgrounds = useEditor((s) => s.backgrounds)
  const markers = useEditor((s) => s.markers)
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const select = useEditor((s) => s.select)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setPlaying = useEditor((s) => s.setPlaying)
  const updateClip = useEditor((s) => s.updateClip)
  const updateText = useEditor((s) => s.updateText)
  const updateOverlay = useEditor((s) => s.updateOverlay)
  const updateAudio = useEditor((s) => s.updateAudio)
  const updateBackground = useEditor((s) => s.updateBackground)
  const reorderClip = useEditor((s) => s.reorderClip)
  const moveClipToOverlay = useEditor((s) => s.moveClipToOverlay)
  const moveClipToBackground = useEditor((s) => s.moveClipToBackground)
  const moveOverlayToMain = useEditor((s) => s.moveOverlayToMain)
  const moveBackgroundToMain = useEditor((s) => s.moveBackgroundToMain)
  const moveClip = useEditor((s) => s.moveClip)
  const raiseOverlay = useEditor((s) => s.raiseOverlay)
  const raiseBackground = useEditor((s) => s.raiseBackground)
  const raiseText = useEditor((s) => s.raiseText)
  const deleteSelected = useEditor((s) => s.deleteSelected)
  const duplicateSelected = useEditor((s) => s.duplicateSelected)
  const addMarker = useEditor((s) => s.addMarker)
  const updateMarker = useEditor((s) => s.updateMarker)
  const removeMarker = useEditor((s) => s.removeMarker)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [trackW, setTrackW] = useState(0)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  const fittedRef = useRef(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragLeft, setDragLeft] = useState(0)
  // Inline rename (double-click a clip/chip).
  const [editing, setEditing] = useState<{ type: 'clip' | FreeKind; id: string } | null>(null)
  const [editVal, setEditVal] = useState('')
  const [menu, setMenu] = useState<{ target: NonNullable<Selection>; x: number; y: number } | null>(null)
  const [markerMenu, setMarkerMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [transitionMenu, setTransitionMenu] = useState<{ index: number; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu && !markerMenu && !transitionMenu) return
    const close = () => { setMenu(null); setMarkerMenu(null); setTransitionMenu(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [markerMenu, menu, transitionMenu])

  const openMenu = (target: NonNullable<Selection>, x: number, y: number) => {
    setPlaying(false)
    setMarkerMenu(null)
    setTransitionMenu(null)
    select(target)
    setMenu({
      target,
      x: Math.max(12, Math.min(x, window.innerWidth - 242)),
      y: Math.max(12, Math.min(y, window.innerHeight - 452)),
    })
  }

  const openMarkerMenu = (id: string, x: number, y: number) => {
    setPlaying(false)
    setMenu(null)
    setTransitionMenu(null)
    setMarkerMenu({
      id,
      x: Math.max(12, Math.min(x, window.innerWidth - 260)),
      y: Math.max(12, Math.min(y, window.innerHeight - 220)),
    })
  }

  const openTransitionMenu = (index: number, x: number, y: number) => {
    setPlaying(false)
    setMenu(null)
    setMarkerMenu(null)
    setTransitionMenu({
      index,
      x: Math.max(12, Math.min(x, window.innerWidth - 250)),
      y: Math.max(12, Math.min(y, window.innerHeight - 230)),
    })
  }

  const onItemContextMenu = (e: React.MouseEvent, target: NonNullable<Selection>) => {
    e.preventDefault()
    e.stopPropagation()
    openMenu(target, e.clientX, e.clientY)
  }

  const withTarget = (target: NonNullable<Selection>, action: () => void) => {
    useEditor.getState().select(target)
    action()
    setMenu(null)
  }

  const startEdit = (type: 'clip' | FreeKind, id: string) => {
    const st = useEditor.getState()
    const init =
      type === 'clip' ? st.clips.find((c) => c.id === id)?.name
      : type === 'overlay' ? st.overlays.find((o) => o.id === id)?.name
      : type === 'audio' ? st.audios.find((a) => a.id === id)?.name
      : type === 'background' ? st.backgrounds.find((b) => b.id === id)?.name
      : st.texts.find((t) => t.id === id)?.text
    setEditVal(init ?? '')
    setEditing({ type, id })
  }
  const commitEdit = () => {
    if (!editing) return
    const v = editVal.trim() || (editing.type === 'text' ? '텍스트' : '이름 없음')
    if (editing.type === 'clip') updateClip(editing.id, { name: v })
    else if (editing.type === 'overlay') updateOverlay(editing.id, { name: v })
    else if (editing.type === 'audio') updateAudio(editing.id, { name: v })
    else if (editing.type === 'background') updateBackground(editing.id, { name: v })
    else updateText(editing.id, { text: v })
    setEditing(null)
  }
  const renameInput = (
    <input
      className="tlrename"
      autoFocus
      value={editVal}
      spellCheck={false}
      onChange={(e) => setEditVal(e.target.value)}
      onBlur={commitEdit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitEdit()
        else if (e.key === 'Escape') setEditing(null)
      }}
    />
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth))
    ro.observe(el)
    setTrackW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const total = projectDuration(clips, overlays, audios, texts, backgrounds)
  const offsets = clipStartOffsets(clips)
  // Scale that would fit all current content to the viewport (for the 전체보기 button & zoom %).
  const fitPps = trackW > 0 ? clampPps(trackW / Math.max(total, 1)) : DEFAULT_PX_PER_SEC
  // The time axis always extends well past the content so it reads as (nearly) endless.
  const viewSec = pxPerSec > 0 ? trackW / pxPerSec : 0
  const spanSec = Math.max(total, viewSec) + Math.max(viewSec, 30)
  const contentW = Math.max(trackW, spanSec * pxPerSec)
  const atFit = Math.abs(pxPerSec - fitPps) < 0.5
  const atMin = pxPerSec <= MIN_PX_PER_SEC * 1.001
  const atMax = pxPerSec >= MAX_PX_PER_SEC * 0.999

  // Fit once when content first appears; after that the scale stays put across edits.
  useEffect(() => {
    if (!fittedRef.current && total > 0 && trackW > 0) {
      fittedRef.current = true
      setPxPerSec(clampPps(trackW / Math.max(total, 1)))
    }
  }, [total, trackW])

  // Lane packing for the free tracks.
  const overlayLanes = packVisualLanes(overlays.map((o) => ({ start: o.start, end: o.start + overlayLength(o) })))
  const audioLanes = packLanes(audios.map((a) => ({ start: a.start, end: a.start + audioLength(a) })))
  const textLanes = packVisualLanes(texts.map((t) => ({ start: t.start, end: t.end })))
  const bgLanes = packVisualLanes(backgrounds.map((b) => ({ start: b.start, end: b.start + clipTimelineDuration(b) })))
  const nOverlayLanes = overlayLanes.length ? Math.max(...overlayLanes) + 1 : 0
  const nAudioLanes = audioLanes.length ? Math.max(...audioLanes) + 1 : 0
  const nTextLanes = textLanes.length ? Math.max(...textLanes) + 1 : 0
  const nBgLanes = bgLanes.length ? Math.max(...bgLanes) + 1 : 0

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const x = playhead * pxPerSec
    const margin = 80
    if (x < el.scrollLeft + margin) el.scrollLeft = Math.max(0, x - margin)
    else if (x > el.scrollLeft + el.clientWidth - margin) el.scrollLeft = x - el.clientWidth + margin
  }, [playhead, pxPerSec])

  // Scroll / trackpad to zoom (toward cursor); horizontal to pan.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        el.scrollLeft += e.deltaX || e.deltaY
        return
      }
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const anchorTime = (cursorX + el.scrollLeft) / pxPerSec
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setPxPerSec((p) => {
        const np = clampPps(p * factor)
        requestAnimationFrame(() => {
          const e2 = scrollRef.current
          if (!e2) return
          e2.scrollLeft = anchorTime * np - cursorX
        })
        return np
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pxPerSec])

  // ---- helpers ----
  const timeAt = (clientX: number) => {
    const el = scrollRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min((clientX - rect.left + el.scrollLeft) / pxPerSec, total))
  }

  // Snap a time to nearby edges of *other* items (and 0 / playhead) — the magnet effect.
  const snap = (t: number, excludeId?: string) => {
    const st = useEditor.getState()
    const offs = clipStartOffsets(st.clips)
    const targets = [0, st.playhead]
    st.clips.forEach((c, i) => { if (c.id !== excludeId) targets.push(offs[i], offs[i] + clipTimelineDuration(c)) })
    st.overlays.forEach((o) => { if (o.id !== excludeId) targets.push(o.start, o.start + overlayLength(o)) })
    st.audios.forEach((a) => { if (a.id !== excludeId) targets.push(a.start, a.start + audioLength(a)) })
    st.texts.forEach((x) => { if (x.id !== excludeId) targets.push(x.start, x.end) })
    st.backgrounds.forEach((b) => { if (b.id !== excludeId) targets.push(b.start, b.start + clipTimelineDuration(b)) })
    st.markers.forEach((marker) => { if (marker.id !== excludeId) targets.push(marker.time) })
    const thresh = SNAP_PX / pxPerSec
    let best = t
    let bd = thresh
    for (const tg of targets) {
      const d = Math.abs(tg - t)
      if (d < bd) {
        bd = d
        best = tg
      }
    }
    return best
  }

  const scrub = (clientX: number) => setPlayhead(snap(timeAt(clientX)))

  // Which visual track is the pointer over (for cross-track drag-and-drop)?
  const trackAt = (clientY: number): 'overlay' | 'main' | 'bg' | null => {
    const el = scrollRef.current
    if (!el) return null
    const hit = (sel: string) => {
      const t = el.querySelector(sel)
      if (!t) return false
      const r = t.getBoundingClientRect()
      return clientY >= r.top && clientY <= r.bottom
    }
    if (hit('.timeline__lane--overlay')) return 'overlay'
    if (hit('.timeline__lane--bg')) return 'bg'
    if (hit('.timeline__track')) return 'main'
    return null
  }

  const onRulerDown = (e: React.PointerEvent) => {
    setPlaying(false)
    scrub(e.clientX)
    startDrag((ev) => scrub(ev.clientX))
  }

  const onMarkerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    setPlaying(false)
    const marker = useEditor.getState().markers.find((item) => item.id === id)
    if (!marker) return
    setPlayhead(marker.time)
    const startX = e.clientX
    const startTime = marker.time
    let moved = false
    startDrag((event) => {
      if (Math.abs(event.clientX - startX) > DRAG_THRESHOLD) moved = true
      if (!moved) return
      updateMarker(id, { time: Math.max(0, snap(startTime + (event.clientX - startX) / pxPerSec, id)) })
    }, (_, cancelled) => {
      if (!cancelled) {
        const current = useEditor.getState().markers.find((item) => item.id === id)
        if (current) setPlayhead(current.time)
      }
    })
  }

  // ---- main clip: drag to reorder, right edge to trim ----
  const onClipDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    const clipRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const grabOffset = e.clientX - clipRect.left
    // Click the name of an already-selected clip → rename it.
    const onName = (e.target as HTMLElement).classList?.contains('clip__label') ?? false
    const wasSelected = selection?.type === 'clip' && selection.id === id
    let moved = false
    let menuOpened = false
    const longPress = e.pointerType === 'touch'
      ? window.setTimeout(() => { menuOpened = true; openMenu({ type: 'clip', id }, startX, startY); navigator.vibrate?.(10) }, LONG_PRESS_MS)
      : 0
    setPlaying(false)
    startDrag(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD) {
          window.clearTimeout(longPress)
          moved = true
          setDragId(id)
        }
        if (!moved) return
        const el = scrollRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const cursorContentX = ev.clientX - rect.left + el.scrollLeft
        setDragLeft(cursorContentX - grabOffset)
        const cur = useEditor.getState().clips
        const offs = clipStartOffsets(cur)
        const dragged = cur.find((x) => x.id === id)
        const draggedW = dragged ? clipTimelineDuration(dragged) * pxPerSec : 0
        const centerTime = (cursorContentX - grabOffset + draggedW / 2) / pxPerSec
        let target = 0
        for (let i = 0; i < cur.length; i++) {
          if (cur[i].id === id) continue
          if (offs[i] + clipTimelineDuration(cur[i]) / 2 < centerTime) target++
        }
        reorderClip(id, target)
      },
      (ev, cancelled) => {
        window.clearTimeout(longPress)
        setDragId(null)
        if (cancelled) return
        if (menuOpened) return
        if (!moved) {
          if (onName && wasSelected) startEdit('clip', id)
          else select({ type: 'clip', id })
          return
        }
        // Dropped on another track → move this clip to that layer.
        const track = trackAt(ev.clientY)
        if (track === 'overlay') moveClipToOverlay(id)
        else if (track === 'bg') moveClipToBackground(id)
      },
    )
  }

  const onClipTrim = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    setPlaying(false)
    select({ type: 'clip', id })
    const st = useEditor.getState()
    const i = st.clips.findIndex((c) => c.id === id)
    const clip = st.clips[i]
    if (!clip) return
    const offI = clipStartOffsets(st.clips)[i]
    const startEndTime = offI + clipTimelineDuration(clip)
    const startX = e.clientX
    startDrag((ev) => {
      const desired = startEndTime + (ev.clientX - startX) / pxPerSec
      const snapped = snap(desired, id)
      const newDur = Math.max(0.1, snapped - offI)
      const baseLen = newDur / Math.max(1, clip.repeat)
      const trimEnd = Math.min(clip.duration, clip.trimStart + baseLen * clip.speed)
      updateClip(id, { trimEnd })
    })
  }

  const onClipTrimStart = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    setPlaying(false)
    select({ type: 'clip', id })
    const clip = useEditor.getState().clips.find((c) => c.id === id)
    if (!clip) return
    const startX = e.clientX
    const startTrim = clip.trimStart
    startDrag((ev) => updateClip(id, { trimStart: startTrim + ((ev.clientX - startX) / pxPerSec) * clip.speed }))
  }

  // ---- generic free item (overlay/audio/text): drag body to move ----
  const onFreeDown = (e: React.PointerEvent, kind: FreeKind, id: string) => {
    if (e.button !== 0) return
    setPlaying(false)
    const st = useEditor.getState()
    const item =
      kind === 'overlay' ? st.overlays.find((o) => o.id === id)
      : kind === 'audio' ? st.audios.find((a) => a.id === id)
      : kind === 'background' ? st.backgrounds.find((b) => b.id === id)
      : st.texts.find((t) => t.id === id)
    if (!item) return
    const locked = 'locked' in item && Boolean(item.locked)
    const len =
      kind === 'overlay' ? overlayLength(item as never)
      : kind === 'audio' ? audioLength(item as never)
      : kind === 'background' ? clipTimelineDuration(item as never)
      : (item as { end: number; start: number }).end - (item as { start: number }).start
    const s0 = item.start
    const startX = e.clientX
    const startY = e.clientY
    const onName = (e.target as HTMLElement).classList?.contains('tlclip__body') ?? false
    const wasSelected = selection?.type === kind && selection.id === id
    let moved = false
    let menuOpened = false
    const longPress = e.pointerType === 'touch'
      ? window.setTimeout(() => { menuOpened = true; openMenu({ type: kind, id }, startX, startY); navigator.vibrate?.(10) }, LONG_PRESS_MS)
      : 0
    startDrag(
      (ev) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD) {
          window.clearTimeout(longPress)
          moved = true
        }
        if (!moved) return
        if (locked) return
        // Move freely from 0; the project just grows if dragged past the end.
        const ns = Math.max(0, snap(s0 + (ev.clientX - startX) / pxPerSec, id))
        if (kind === 'overlay') updateOverlay(id, { start: ns })
        else if (kind === 'audio') updateAudio(id, { start: ns })
        else if (kind === 'background') updateBackground(id, { start: ns })
        else updateText(id, { start: ns, end: ns + len })
      },
      (ev, cancelled) => {
        window.clearTimeout(longPress)
        if (cancelled) return
        if (menuOpened) return
        if (!moved) {
          if (onName && wasSelected) startEdit(kind, id)
          else select({ type: kind, id })
          return
        }
        if (locked) return
        // Overlay / background dropped on the main track → move it there.
        if ((kind === 'overlay' || kind === 'background') && trackAt(ev.clientY) === 'main') {
          if (kind === 'overlay') moveOverlayToMain(id)
          else moveBackgroundToMain(id)
        }
      },
    )
  }

  const onFreeTrim = (e: React.PointerEvent, kind: FreeKind, id: string, edge: 'start' | 'end') => {
    e.stopPropagation()
    if (e.button !== 0) return
    setPlaying(false)
    select({ type: kind, id })
    const st = useEditor.getState()
    const startX = e.clientX
    if (kind === 'text') {
      const t = st.texts.find((x) => x.id === id)
      if (!t) return
      const s0 = t.start, e0 = t.end
      startDrag((ev) => {
        const dt = (ev.clientX - startX) / pxPerSec
        if (edge === 'start') updateText(id, { start: Math.max(0, Math.min(snap(s0 + dt, id), e0 - 0.2)) })
        else updateText(id, { end: Math.max(s0 + 0.2, snap(e0 + dt, id)) })
      })
    } else if (kind === 'overlay') {
      const o = st.overlays.find((x) => x.id === id)
      if (!o) return
      const s0 = o.start, ts0 = o.trimStart, end0 = o.start + overlayLength(o)
      startDrag((ev) => {
        const dx = (ev.clientX - startX) / pxPerSec
        if (edge === 'start') {
          const ns = Math.max(0, snap(s0 + dx, id))
          const d = ns - s0
          updateOverlay(id, { start: ns, trimStart: Math.max(0, Math.min(ts0 + d * o.speed, o.trimEnd - 0.1)) })
        } else {
          const newLen = Math.max(0.1, snap(end0 + dx, id) - s0)
          const baseLen = newLen / Math.max(1, o.repeat)
          updateOverlay(id, { trimEnd: Math.min(o.duration, ts0 + baseLen * o.speed) })
        }
      })
    } else if (kind === 'background') {
      const b = st.backgrounds.find((x) => x.id === id)
      if (!b) return
      const s0 = b.start, ts0 = b.trimStart, end0 = b.start + clipTimelineDuration(b)
      startDrag((ev) => {
        const dx = (ev.clientX - startX) / pxPerSec
        if (edge === 'start') {
          const ns = Math.max(0, snap(s0 + dx, id))
          const d = ns - s0
          updateBackground(id, { start: ns, trimStart: Math.max(0, Math.min(ts0 + d * b.speed, b.trimEnd - 0.1)) })
        } else {
          const newLen = Math.max(0.1, snap(end0 + dx, id) - s0)
          const baseLen = newLen / Math.max(1, b.repeat)
          updateBackground(id, { trimEnd: Math.min(b.duration, ts0 + baseLen * b.speed) })
        }
      })
    } else {
      const a = st.audios.find((x) => x.id === id)
      if (!a) return
      const s0 = a.start, ts0 = a.trimStart, end0 = a.start + audioLength(a)
      startDrag((ev) => {
        const dx = (ev.clientX - startX) / pxPerSec
        if (edge === 'start') {
          const ns = Math.max(0, snap(s0 + dx, id))
          const d = ns - s0
          updateAudio(id, { start: ns, trimStart: Math.max(0, Math.min(ts0 + d, a.trimEnd - 0.1)) })
        } else {
          const newLen = Math.max(0.1, snap(end0 + dx, id) - s0)
          const baseLen = newLen / Math.max(1, a.repeat)
          updateAudio(id, { trimEnd: Math.min(a.duration, ts0 + baseLen) })
        }
      })
    }
  }

  const zoomBy = (factor: number) => {
    const el = scrollRef.current
    const anchorTime = el ? (el.scrollLeft + el.clientWidth / 2) / pxPerSec : 0
    setPxPerSec((p) => {
      const np = clampPps(p * factor)
      requestAnimationFrame(() => {
        const e2 = scrollRef.current
        if (!e2) return
        e2.scrollLeft = anchorTime * np - e2.clientWidth / 2
      })
      return np
    })
  }

  const fitView = () => {
    setPxPerSec(fitPps)
    const el = scrollRef.current
    if (el) { el.scrollLeft = 0; el.scrollTop = 0 }
  }

  const NICE_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200]
  const tickStep = NICE_STEPS.find((s) => s * pxPerSec >= 56) ?? NICE_STEPS[NICE_STEPS.length - 1]
  const tickLabel = (t: number) => (tickStep < 1 ? formatTimeFine(t) : formatTime(t))
  const ticks: number[] = []
  for (let t = 0; t <= spanSec + 0.001; t += tickStep) ticks.push(Number(t.toFixed(3)))

  const fadeVisual = (fadeIn = 0, fadeOut = 0, len = 0) => {
    if (len <= 0 || (!fadeIn && !fadeOut)) return null
    return <>
      {fadeIn > 0 && <span className="timeline-fade timeline-fade--in" style={{ width: `${Math.min(50, (fadeIn / len) * 100)}%` }} />}
      {fadeOut > 0 && <span className="timeline-fade timeline-fade--out" style={{ width: `${Math.min(50, (fadeOut / len) * 100)}%` }} />}
    </>
  }
  const keyframeVisual = (frames: PositionKeyframe[] | undefined, len: number) => frames?.map((frame) => (
    <span key={frame.id} className="timeline-keyframe" style={{ left: `${Math.max(0, Math.min(100, (frame.time / Math.max(0.001, len)) * 100))}%` }} />
  ))

  // Render one free item (overlay/audio/text) as a positioned chip.
  const freeChip = (
    kind: FreeKind, id: string, start: number, len: number, lane: number,
    laneH: number, color: string, label: string, selected: boolean,
    visual?: ReactNode, flags?: { hidden?: boolean; locked?: boolean },
  ) => (
    <div
      key={id}
      className={`tlclip${selected ? ' tlclip--selected' : ''}${flags?.hidden ? ' tlclip--hidden' : ''}${flags?.locked ? ' tlclip--locked' : ''}`}
      style={{
        left: start * pxPerSec,
        width: Math.max(10, len * pxPerSec),
        top: lane * laneH + 2,
        height: laneH - 6,
        background: color,
        color: contrastText(color),
      }}
      onPointerDown={(e) => onFreeDown(e, kind, id)}
      onContextMenu={(e) => onItemContextMenu(e, { type: kind, id })}
      onDoubleClick={() => startEdit(kind, id)}
      title={`${label} · 끌어서 이동${selected ? ', 끝을 끌어서 길이 조절' : ''} · 선택 후 이름 클릭으로 이름변경`}
    >
      {selected && !flags?.locked && <span className="tlclip__handle tlclip__handle--l" onPointerDown={(e) => onFreeTrim(e, kind, id, 'start')} />}
      {visual}
      {editing?.id === id ? renameInput : <span className="tlclip__body">{label}</span>}
      {selected && !flags?.locked && <span className="tlclip__handle tlclip__handle--r" onPointerDown={(e) => onFreeTrim(e, kind, id, 'end')} />}
    </div>
  )

  return (
    <div className="timeline">
      <div className="timeline__bar">
        <button className="iconbtn iconbtn--xs" onClick={() => zoomBy(1 / 1.5)} disabled={atMin} title="축소">−</button>
        <button className="btn btn--sm" onClick={fitView} disabled={atFit} title="전체를 한 화면에">전체보기</button>
        <button className="iconbtn iconbtn--xs" onClick={() => zoomBy(1.5)} disabled={atMax} title="확대">＋</button>
        <button className="btn btn--sm timeline__marker-add" onClick={() => addMarker(playhead)} title="현재 위치에 마커 추가 (M)">마커 추가</button>
        <span className="timeline__zoom">{Math.round((pxPerSec / fitPps) * 100)}%</span>
        <span className="timeline__hint">스크롤=확대 · Shift+스크롤=이동</span>
        <div className="timeline__bar-spacer" />
        <span className="timeline__total">{formatTime(playhead)} / {formatTime(total)}</span>
      </div>

      <div className="timeline__scroll" ref={scrollRef}>
        <div className="timeline__content" style={{ width: contentW }}>
          <div className="timeline__ruler" onPointerDown={onRulerDown} onDoubleClick={(event) => addMarker(timeAt(event.clientX))}>
            {ticks.map((t) => (
              <span key={t} className="timeline__tick" style={{ left: t * pxPerSec }}>
                {tickLabel(t)}
              </span>
            ))}
          </div>

          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className="timeline-marker"
              style={{ left: marker.time * pxPerSec, ['--marker-color' as string]: marker.color }}
              onPointerDown={(event) => onMarkerDown(event, marker.id)}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMarkerMenu(marker.id, event.clientX, event.clientY) }}
              onDoubleClick={(event) => { event.stopPropagation(); openMarkerMenu(marker.id, event.clientX, event.clientY) }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openMarkerMenu(marker.id, 24, 80) }}
              aria-label={`${marker.label}, ${formatTimeFine(marker.time)}`}
              title={`${marker.label} · ${formatTimeFine(marker.time)} · 끌어서 이동`}
            >
              <span>{marker.label}</span>
            </button>
          ))}

          {/* Text is always composited above media overlays. */}
          {nTextLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--text"
              style={{ height: nTextLanes * TXT_LANE_H }}
              onPointerDown={(e) => e.target === e.currentTarget && select(null)}
            >
              {texts.map((t, i) =>
                freeChip('text', t.id, t.start, t.end - t.start, textLanes[i], TXT_LANE_H, '#3a4250',
                  `T ${t.text}`,
                  selection?.type === 'text' && selection.id === t.id,
                  <>{fadeVisual(t.fadeIn, t.fadeOut, t.end - t.start)}{keyframeVisual(t.positionKeyframes, t.end - t.start)}</>,
                  { hidden: t.hidden, locked: t.locked }),
              )}
            </div>
          )}

          {/* Overlay lanes (PiP), frontmost overlapping layer on the top row. */}
          {nOverlayLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--overlay"
              style={{ height: nOverlayLanes * OV_LANE_H }}
              onPointerDown={(e) => e.target === e.currentTarget && select(null)}
            >
              {overlays.map((o, i) =>
                freeChip('overlay', o.id, o.start, overlayLength(o), overlayLanes[i], OV_LANE_H, o.color,
                  `${o.kind === 'image' ? '이미지' : '오버레이'} · ${o.name}${o.repeat > 1 ? ` · 반복 ${o.repeat}회` : ''}${o.kind === 'video' && o.muted ? ' · 음소거' : ''}`,
                  selection?.type === 'overlay' && selection.id === o.id,
                  <>{fadeVisual(o.fadeIn, o.fadeOut, overlayLength(o))}{keyframeVisual(o.positionKeyframes, overlayLength(o))}</>,
                  { hidden: o.hidden, locked: o.locked }),
              )}
            </div>
          )}

          {/* Main video track */}
          <div
            className={`timeline__track${dragId ? ' timeline__track--reordering' : ''}`}
            onPointerDown={(e) => e.target === e.currentTarget && select(null)}
          >
            {clips.length === 0 && <div className="timeline__placeholder">＋ 동영상·사진을 추가하세요</div>}
            {clips.map((c, i) => {
              const isSel = selection?.type === 'clip' && selection.id === c.id
              const isDragging = dragId === c.id
              const clipWidth = Math.max(2, clipTimelineDuration(c) * pxPerSec)
              return (
                <div
                  key={c.id}
                  className={`clip${isSel ? ' clip--selected' : ''}${isDragging ? ' clip--dragging' : ''}`}
                  style={{
                    left: isDragging ? dragLeft : offsets[i] * pxPerSec,
                    width: clipWidth,
                    background: clipBg(c),
                    color: contrastText(clipBg(c)),
                  }}
                  onPointerDown={(e) => onClipDown(e, c.id)}
                  onContextMenu={(e) => onItemContextMenu(e, { type: 'clip', id: c.id })}
                  onDoubleClick={() => startEdit('clip', c.id)}
                  title={`${c.name} · 끌어서 순서 변경, 오른쪽 끝을 끌어서 트림 · 선택 후 이름 클릭으로 이름변경`}
                >
                  <ClipThumbnailStrip clip={c} width={clipWidth} />
                  {c.kind === 'video' && c.hasAudio && <AudioWaveform media={c} className="timeline-waveform--clip" />}
                  {fadeVisual(c.fadeIn, c.fadeOut, clipTimelineDuration(c))}
                  {editing?.id === c.id
                    ? renameInput
                    : <span className="clip__label">{c.kind === 'image' ? '이미지 · ' : c.kind === 'color' ? '색상 · ' : '영상 · '}{c.name}</span>}
                  <span className="clip__meta">
                    {c.speed !== 1 && `${c.speed}× `}
                    {c.repeat > 1 && `⟳${c.repeat} `}
                    {c.muted && <span className="clip__muted">음소거</span>}
                  </span>
                  {isSel && c.kind !== 'color' && <span className="clip__handle clip__handle--l" onPointerDown={(e) => onClipTrimStart(e, c.id)} />}
                  {isSel && <span className="clip__handle clip__handle--r" onPointerDown={(e) => onClipTrim(e, c.id)} />}
                </div>
              )
            })}
            {clips.slice(0, -1).map((clip, index) => {
              const next = clips[index + 1]
              const active = (clip.fadeOut ?? 0) > 0 || (next.fadeIn ?? 0) > 0
              const boundary = offsets[index] + clipTimelineDuration(clip)
              return (
                <button
                  key={`transition-${clip.id}-${next.id}`}
                  type="button"
                  className={`timeline-transition${active ? ' timeline-transition--active' : ''}`}
                  style={{ left: boundary * pxPerSec }}
                  aria-label={`${clip.name}과 ${next.name} 사이 전환`}
                  title={active ? '검정 페이드 전환 편집' : '클립 사이 전환 추가'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    const rect = event.currentTarget.getBoundingClientRect()
                    openTransitionMenu(index, rect.left + rect.width / 2, rect.bottom + 8)
                  }}
                />
              )
            })}
          </div>

          {/* Audio / music lanes */}
          {nAudioLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--audio"
              style={{ height: nAudioLanes * AUD_LANE_H }}
              onPointerDown={(e) => e.target === e.currentTarget && select(null)}
            >
              {audios.map((a, i) =>
                freeChip('audio', a.id, a.start, audioLength(a), audioLanes[i], AUD_LANE_H, a.color,
                  `음악 · ${a.name}${a.repeat > 1 ? ` · 반복 ${a.repeat}회` : ''}${a.muted ? ' · 음소거' : ''}`,
                  selection?.type === 'audio' && selection.id === a.id,
                  <><AudioWaveform media={a} />{fadeVisual(a.fadeIn, a.fadeOut, audioLength(a))}</>),
              )}
            </div>
          )}

          {/* Background lanes (bottom = lowest layer) */}
          {nBgLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--bg"
              style={{ height: nBgLanes * AUD_LANE_H }}
              onPointerDown={(e) => e.target === e.currentTarget && select(null)}
            >
              {backgrounds.map((b, i) =>
                freeChip('background', b.id, b.start, clipTimelineDuration(b), bgLanes[i], AUD_LANE_H, clipBg(b),
                  `배경 · ${b.name}${b.kind === 'video' && b.muted ? ' · 음소거' : ''}`,
                  selection?.type === 'background' && selection.id === b.id,
                  fadeVisual(b.fadeIn, b.fadeOut, clipTimelineDuration(b)),
                  { hidden: b.hidden, locked: b.locked }),
              )}
            </div>
          )}

          <div className="timeline__playhead" style={{ left: playhead * pxPerSec }}>
            <span className="timeline__playhead-grab" onPointerDown={onRulerDown} />
          </div>
        </div>
      </div>
      {menu && (() => {
        const target = menu.target
        const st = useEditor.getState()
        const item = target.type === 'overlay' ? st.overlays.find((x) => x.id === target.id)
          : target.type === 'audio' ? st.audios.find((x) => x.id === target.id)
          : target.type === 'background' ? st.backgrounds.find((x) => x.id === target.id)
          : null
        const visualItem = target.type === 'overlay' ? st.overlays.find((x) => x.id === target.id)
          : target.type === 'background' ? st.backgrounds.find((x) => x.id === target.id)
          : target.type === 'text' ? st.texts.find((x) => x.id === target.id)
          : null
        const canMute = target.type === 'audio'
          || (target.type === 'overlay' && st.overlays.find((x) => x.id === target.id)?.kind === 'video')
          || (target.type === 'background' && st.backgrounds.find((x) => x.id === target.id)?.kind === 'video')
        const moveToPlayhead = () => {
          const p = useEditor.getState().playhead
          if (target.type === 'overlay') updateOverlay(target.id, { start: p })
          else if (target.type === 'audio') updateAudio(target.id, { start: p })
          else if (target.type === 'background') updateBackground(target.id, { start: p })
          else if (target.type === 'text') {
            const t = useEditor.getState().texts.find((x) => x.id === target.id)
            if (t) updateText(target.id, { start: p, end: p + (t.end - t.start) })
          }
        }
        return (
          <div className="timeline-menu" role="menu" style={{ left: menu.x, top: menu.y }}
            onPointerDown={(e) => e.stopPropagation()}>
            {target.type === 'clip' && <>
              <button role="menuitem" onClick={() => withTarget(target, () => moveClip(target.id, -1))}>← 왼쪽으로 이동</button>
              <button role="menuitem" onClick={() => withTarget(target, () => moveClip(target.id, 1))}>오른쪽으로 이동 →</button>
            </>}
            {target.type !== 'clip' && <button role="menuitem" onClick={() => withTarget(target, moveToPlayhead)}>재생 헤드 위치로 이동</button>}
            {(target.type === 'overlay' || target.type === 'background' || target.type === 'text') && <>
              <button role="menuitem" onClick={() => withTarget(target, () => target.type === 'overlay' ? raiseOverlay(target.id, 1) : target.type === 'background' ? raiseBackground(target.id, 1) : raiseText(target.id, 1))}>앞으로 가져오기</button>
              <button role="menuitem" onClick={() => withTarget(target, () => target.type === 'overlay' ? raiseOverlay(target.id, -1) : target.type === 'background' ? raiseBackground(target.id, -1) : raiseText(target.id, -1))}>뒤로 보내기</button>
            </>}
            {target.type === 'clip' && <>
              <button role="menuitem" onClick={() => withTarget(target, () => moveClipToOverlay(target.id))}>오버레이로 이동</button>
              <button role="menuitem" onClick={() => withTarget(target, () => moveClipToBackground(target.id))}>배경으로 이동</button>
            </>}
            {target.type === 'overlay' && <button role="menuitem" onClick={() => withTarget(target, () => moveOverlayToMain(target.id))}>메인 트랙으로 이동</button>}
            {target.type === 'background' && <button role="menuitem" onClick={() => withTarget(target, () => moveBackgroundToMain(target.id))}>메인 트랙으로 이동</button>}
            {canMute &&
              <button role="menuitem" onClick={() => withTarget(target, () => target.type === 'audio' ? updateAudio(target.id, { muted: !item?.muted }) : target.type === 'overlay' ? updateOverlay(target.id, { muted: !item?.muted }) : updateBackground(target.id, { muted: !item?.muted }))}>{item?.muted ? '음소거 해제' : '음소거'}</button>}
            {visualItem && <>
              <button role="menuitem" onClick={() => withTarget(target, () => target.type === 'overlay'
                ? updateOverlay(target.id, { hidden: !visualItem.hidden })
                : target.type === 'background'
                  ? updateBackground(target.id, { hidden: !visualItem.hidden })
                  : updateText(target.id, { hidden: !visualItem.hidden }))}>{visualItem.hidden ? '레이어 표시' : '레이어 숨기기'}</button>
              <button role="menuitem" onClick={() => withTarget(target, () => target.type === 'overlay'
                ? updateOverlay(target.id, { locked: !visualItem.locked })
                : target.type === 'background'
                  ? updateBackground(target.id, { locked: !visualItem.locked })
                  : updateText(target.id, { locked: !visualItem.locked }))}>{visualItem.locked ? '레이어 잠금 해제' : '레이어 잠그기'}</button>
            </>}
            <button role="menuitem" onClick={() => withTarget(target, duplicateSelected)}>복제</button>
            <div className="timeline-menu__separator" />
            <button role="menuitem" className="timeline-menu__danger" onClick={() => withTarget(target, deleteSelected)}>삭제</button>
          </div>
        )
      })()}
      {markerMenu && (() => {
        const marker = markers.find((item) => item.id === markerMenu.id)
        if (!marker) return null
        return (
          <div className="timeline-menu timeline-marker-menu" style={{ left: markerMenu.x, top: markerMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}>
            <label className="timeline-marker-menu__field">
              <span>마커 이름</span>
              <input value={marker.label} autoFocus onChange={(event) => updateMarker(marker.id, { label: event.target.value })} />
            </label>
            <label className="timeline-marker-menu__field timeline-marker-menu__color">
              <span>색상</span>
              <input type="color" value={marker.color} onChange={(event) => updateMarker(marker.id, { color: event.target.value })} />
              <b>{formatTimeFine(marker.time)}</b>
            </label>
            <button onClick={() => { updateMarker(marker.id, { time: playhead }); setMarkerMenu(null) }}>재생 헤드 위치로 이동</button>
            <div className="timeline-menu__separator" />
            <button className="timeline-menu__danger" onClick={() => { removeMarker(marker.id); setMarkerMenu(null) }}>마커 삭제</button>
          </div>
        )
      })()}
      {transitionMenu && (() => {
        const before = clips[transitionMenu.index]
        const after = clips[transitionMenu.index + 1]
        if (!before || !after) return null
        const current = Math.max(before.fadeOut ?? 0, after.fadeIn ?? 0)
        const setDuration = (duration: number) => {
          updateClip(before.id, { fadeOut: duration })
          updateClip(after.id, { fadeIn: duration })
          setTransitionMenu(null)
        }
        return (
          <div className="timeline-menu timeline-transition-menu" style={{ left: transitionMenu.x, top: transitionMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}>
            <div className="timeline-transition-menu__title">클립 사이 검정 페이드</div>
            <div className="timeline-transition-menu__hint">앞 장면은 어두워지고 다음 장면은 자연스럽게 나타납니다.</div>
            <div className="timeline-transition-menu__choices">
              {[0, 0.3, 0.5, 1, 2].map((duration) => (
                <button key={duration} className={Math.abs(current - duration) < 0.01 ? 'timeline-transition-menu__on' : ''}
                  onClick={() => setDuration(duration)}>{duration === 0 ? '없음' : `${duration}초`}</button>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
