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
  formatClock,
  parseClock,
  totalDuration,
  exactDurationPatch,
} from '../utils/time'
import { contrastText } from '../utils/color'
import { normalizeVisualOrder, packVisualLanes } from '../utils/layers'
import { startPointerDrag as startDrag } from '../utils/pointer'
import type { Clip, Selection, PositionKeyframe, TimelineItemRef } from '../types'
import { AudioWaveform, ClipThumbnailStrip } from './TimelineMedia'
import Icon from './Icon'

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
const LONG_PRESS_MS = 520
const TRACK_HEADER_W = 116

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
  const selectedItems = useEditor((s) => s.selectedItems)
  const groups = useEditor((s) => s.groups)
  const storedVisualOrder = useEditor((s) => s.visualOrder)
  const playhead = useEditor((s) => s.playhead)
  const isPlaying = useEditor((s) => s.isPlaying)
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
  const groupSelected = useEditor((s) => s.groupSelected)
  const ungroupSelected = useEditor((s) => s.ungroupSelected)
  const moveTimelineItems = useEditor((s) => s.moveTimelineItems)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [trackW, setTrackW] = useState(0)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  const [fitMode, setFitMode] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [timeDraft, setTimeDraft] = useState<string | null>(null)
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
    if (!selectedItems.some((item) => item.type === target.type && item.id === target.id)) select(target)
    setMenu({
      target,
      x: Math.max(12, Math.min(x, window.innerWidth - 242)),
      y: Math.max(12, Math.min(y, window.innerHeight - 452)),
    })
  }

  const isSelected = (target: TimelineItemRef) => selectedItems.some((item) => item.type === target.type && item.id === target.id)
  const groupFor = (target: TimelineItemRef) => groups.find((group) => group.members.some((item) => item.type === target.type && item.id === target.id))

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
  const usableTrackW = Math.max(1, trackW - TRACK_HEADER_W)
  // Scale that would fit all current content to the viewport (for the 전체보기 button & zoom %).
  const fitPps = trackW > 0 ? clampPps(usableTrackW / Math.max(total, 1)) : DEFAULT_PX_PER_SEC
  // The time axis always extends well past the content so it reads as (nearly) endless.
  const viewSec = pxPerSec > 0 ? usableTrackW / pxPerSec : 0
  const spanSec = fitMode ? Math.max(total, viewSec) : Math.max(total, viewSec) + Math.max(viewSec, 30)
  const contentW = fitMode ? trackW : Math.max(trackW, TRACK_HEADER_W + spanSec * pxPerSec)
  const atFit = fitMode && Math.abs(pxPerSec - fitPps) < 0.5
  const atMin = pxPerSec <= MIN_PX_PER_SEC * 1.001
  const atMax = pxPerSec >= MAX_PX_PER_SEC * 0.999

  // Fit once when content first appears; after that the scale stays put across edits.
  useEffect(() => {
    if (!fittedRef.current && total > 0 && trackW > 0) {
      fittedRef.current = true
      setFitMode(true)
      setPxPerSec(clampPps(usableTrackW / Math.max(total, 1)))
    }
  }, [total, trackW, usableTrackW])

  // 전체보기 is a persistent viewport mode, not a one-time zoom value. Keep
  // fitting when a trim/edit changes the project length and never add overflow.
  useEffect(() => {
    if (!fitMode || trackW <= 0) return
    setPxPerSec(fitPps)
    const el = scrollRef.current
    if (el) el.scrollLeft = 0
  }, [fitMode, fitPps, trackW])

  // Lane packing for the free tracks.
  const audioLanes = packLanes(audios.map((a) => ({ start: a.start, end: a.start + audioLength(a) })))
  const bgLanes = packVisualLanes(backgrounds.map((b) => ({ start: b.start, end: b.start + clipTimelineDuration(b) })))
  const nAudioLanes = audioLanes.length ? Math.max(...audioLanes) + 1 : 0
  const nBgLanes = bgLanes.length ? Math.max(...bgLanes) + 1 : 0
  const visualOrder = normalizeVisualOrder(overlays, texts, storedVisualOrder)
  const visualFrontToBack = [...visualOrder].reverse()
  const timelineX = (time: number) => TRACK_HEADER_W + time * pxPerSec

  // Keep the playhead in view only during playback. Manual keyframe/playhead
  // edits must not unexpectedly move a fitted or manually positioned viewport.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isPlaying || fitMode) return
    const x = TRACK_HEADER_W + playhead * pxPerSec
    const margin = 80
    if (x < el.scrollLeft + margin) el.scrollLeft = Math.max(0, x - margin)
    else if (x > el.scrollLeft + el.clientWidth - margin) el.scrollLeft = x - el.clientWidth + margin
  }, [fitMode, isPlaying, playhead, pxPerSec])

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
      setFitMode(false)
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const anchorTime = Math.max(0, (cursorX + el.scrollLeft - TRACK_HEADER_W) / pxPerSec)
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setPxPerSec((p) => {
        const np = clampPps(p * factor)
        requestAnimationFrame(() => {
          const e2 = scrollRef.current
          if (!e2) return
          e2.scrollLeft = TRACK_HEADER_W + anchorTime * np - cursorX
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
    return Math.max(0, Math.min((clientX - rect.left + el.scrollLeft - TRACK_HEADER_W) / pxPerSec, total))
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

  // Playhead scrubbing is deliberately continuous. Snapping belongs to clip
  // edits; forcing it here made precise seeking feel sticky and tiring.
  const scrub = (clientX: number) => setPlayhead(timeAt(clientX))

  // Which visual track is the pointer over (for cross-track drag-and-drop)?
  const trackAt = (clientY: number): 'overlay' | 'main' | 'bg' | null => {
    const el = scrollRef.current
    if (!el) return null
    const hit = (sel: string) => Array.from(el.querySelectorAll(sel)).some((track) => {
      const r = track.getBoundingClientRect()
      return clientY >= r.top && clientY <= r.bottom
    })
    if (hit('.timeline__lane--visual')) return 'overlay'
    if (hit('.timeline__lane--bg')) return 'bg'
    if (hit('.timeline__track')) return 'main'
    return null
  }

  const onRulerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setPlaying(false)
    setScrubbing(true)
    scrub(e.clientX)
    startDrag((ev) => scrub(ev.clientX), () => setScrubbing(false))
  }

  const onPlayheadDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setPlaying(false)
    setScrubbing(true)
    const startX = e.clientX
    const startTime = useEditor.getState().playhead
    document.body.style.cursor = 'ew-resize'
    startDrag((event) => {
      const next = startTime + (event.clientX - startX) / pxPerSec
      setPlayhead(Math.max(0, Math.min(total, next)))
    }, () => {
      document.body.style.cursor = ''
      setScrubbing(false)
    })
  }

  const onTimelineBackgroundDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return
    select(null)
    onRulerDown(e)
  }

  const stepPlayhead = (delta: number) => {
    setPlaying(false)
    setPlayhead(Math.max(0, Math.min(total, playhead + delta)))
  }

  const commitTimeDraft = () => {
    if (timeDraft == null) return
    const parsed = parseClock(timeDraft)
    if (Number.isFinite(parsed)) {
      setPlaying(false)
      setPlayhead(Math.max(0, Math.min(total, parsed)))
    }
    setTimeDraft(null)
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
        setDragLeft(Math.max(TRACK_HEADER_W, cursorContentX - grabOffset))
        const cur = useEditor.getState().clips
        const offs = clipStartOffsets(cur)
        const dragged = cur.find((x) => x.id === id)
        const draggedW = dragged ? clipTimelineDuration(dragged) * pxPerSec : 0
        const centerTime = (cursorContentX - grabOffset + draggedW / 2 - TRACK_HEADER_W) / pxPerSec
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
          else select({ type: 'clip', id }, e.metaKey || e.ctrlKey)
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
    const s0 = item.start
    const startX = e.clientX
    const startY = e.clientY
    const onName = (e.target as HTMLElement).classList?.contains('tlclip__body') ?? false
    const wasSelected = selection?.type === kind && selection.id === id
    const target = { type: kind, id } as TimelineItemRef
    const selectedAtStart = isSelected(target)
    const grouped = groupFor(target)
    const dragItems = selectedAtStart && selectedItems.length > 1 ? selectedItems : grouped?.members ?? [target]
    let lastDelta = 0
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
        const desiredDelta = ns - s0
        moveTimelineItems(dragItems, desiredDelta - lastDelta)
        lastDelta = desiredDelta
      },
      (ev, cancelled) => {
        window.clearTimeout(longPress)
        if (cancelled) return
        if (menuOpened) return
        if (!moved) {
          if (onName && wasSelected) startEdit(kind, id)
          else select({ type: kind, id }, e.metaKey || e.ctrlKey)
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
    const anchorTime = el ? Math.max(0, (el.scrollLeft + el.clientWidth / 2 - TRACK_HEADER_W) / pxPerSec) : 0
    setFitMode(false)
    setPxPerSec((p) => {
      const np = clampPps(p * factor)
      requestAnimationFrame(() => {
        const e2 = scrollRef.current
        if (!e2) return
        e2.scrollLeft = TRACK_HEADER_W + anchorTime * np - e2.clientWidth / 2
      })
      return np
    })
  }

  const fitView = () => {
    setFitMode(true)
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
        left: timelineX(start),
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

  const zoomValue = Math.round((Math.log(pxPerSec / MIN_PX_PER_SEC) / Math.log(MAX_PX_PER_SEC / MIN_PX_PER_SEC)) * 1000)
  const setZoomValue = (value: number) => {
    setFitMode(false)
    setPxPerSec(clampPps(MIN_PX_PER_SEC * ((MAX_PX_PER_SEC / MIN_PX_PER_SEC) ** (value / 1000))))
  }

  const trackHeader = (
    label: string,
    target?: TimelineItemRef,
    state?: { locked?: boolean; hidden?: boolean; muted?: boolean },
  ) => (
    <div className="timeline__track-header" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" className="timeline__track-name" title={label} onClick={() => target && select(target)}>{label}</button>
      {target && (target.type === 'overlay' || target.type === 'text' || target.type === 'background') && (
        <button type="button" className="timeline__track-action" title={state?.hidden ? '레이어 표시' : '레이어 숨기기'} onClick={() => {
          if (target.type === 'overlay') updateOverlay(target.id, { hidden: !state?.hidden })
          else if (target.type === 'text') updateText(target.id, { hidden: !state?.hidden })
          else updateBackground(target.id, { hidden: !state?.hidden })
        }}><Icon name={state?.hidden ? 'eyeOff' : 'eye'} /></button>
      )}
      {target && target.type !== 'clip' && target.type !== 'audio' && (
        <button type="button" className="timeline__track-action" title={state?.locked ? '잠금 해제' : '레이어 잠금'} onClick={() => {
          if (target.type === 'overlay') updateOverlay(target.id, { locked: !state?.locked })
          else if (target.type === 'text') updateText(target.id, { locked: !state?.locked })
          else updateBackground(target.id, { locked: !state?.locked })
        }}><Icon name={state?.locked ? 'lock' : 'unlock'} /></button>
      )}
    </div>
  )

  return (
    <div className="timeline">
      <div className="timeline__bar">
        <button className="iconbtn iconbtn--xs" onClick={() => addMarker(playhead)} title="현재 위치에 마커 추가 (M)" aria-label="마커 추가"><Icon name="marker" /></button>
        {selectedItems.length > 1 && <button className="btn btn--sm" onClick={groupSelected}>그룹 만들기 ({selectedItems.length})</button>}
        {selectedItems.some((item) => Boolean(groupFor(item))) && <button className="btn btn--sm" onClick={ungroupSelected}>그룹 해제</button>}
        <span className="timeline__hint">스크롤=확대 · Shift+스크롤=이동</span>
        <div className="timeline__bar-spacer" />
        <div className="timeline__seek-control" aria-label="재생 헤드 위치">
          <button type="button" onClick={() => stepPlayhead(-1 / 30)} disabled={playhead <= 0} aria-label="이전 프레임" title="이전 프레임">−1f</button>
          <input value={timeDraft ?? formatClock(playhead)} aria-label="재생 헤드 시간" spellCheck={false}
            onChange={(event) => setTimeDraft(event.target.value)} onFocus={(event) => event.currentTarget.select()}
            onBlur={commitTimeDraft} onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              else if (event.key === 'Escape') setTimeDraft(null)
            }} />
          <span>/ {formatTime(total)}</span>
          <button type="button" onClick={() => stepPlayhead(1 / 30)} disabled={playhead >= total} aria-label="다음 프레임" title="다음 프레임">+1f</button>
        </div>
        <div className="timeline__zoom-control" aria-label="타임라인 확대 및 축소">
          <button className="iconbtn iconbtn--xs" onClick={() => zoomBy(1 / 1.35)} disabled={atMin} title="축소"><Icon name="zoomOut" /></button>
          <input type="range" min={0} max={1000} step={1} value={zoomValue} onChange={(event) => setZoomValue(Number(event.target.value))} aria-label="타임라인 확대 비율" />
          <button className="iconbtn iconbtn--xs" onClick={() => zoomBy(1.35)} disabled={atMax} title="확대"><Icon name="zoomIn" /></button>
          <button className={`iconbtn iconbtn--xs${atFit ? ' iconbtn--on' : ''}`} onClick={fitView} title="전체 타임라인 맞춤" aria-label="전체 타임라인 맞춤"><Icon name="fit" /></button>
        </div>
      </div>

      <div className={`timeline__scroll${fitMode ? ' timeline__scroll--fit' : ''}`} ref={scrollRef}>
        <div className="timeline__content" style={{ width: contentW }}>
          <div className="timeline__ruler" onPointerDown={onRulerDown} onDoubleClick={(event) => addMarker(timeAt(event.clientX))}>
            {ticks.map((t) => (
              <span key={t} className="timeline__tick" style={{ left: timelineX(t) }}>
                {tickLabel(t)}
              </span>
            ))}
          </div>

          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className="timeline-marker"
              style={{ left: timelineX(marker.time), ['--marker-color' as string]: marker.color }}
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

          {/* One visible row per composited layer. Top row is always frontmost. */}
          {visualFrontToBack.map((ref) => {
            if (ref.type === 'overlay') {
              const o = overlays.find((item) => item.id === ref.id)
              if (!o) return null
              return (
                <div key={`visual:${ref.type}:${ref.id}`} className="timeline__lane timeline__lane--visual timeline__lane--overlay" style={{ height: OV_LANE_H }}
                  onPointerDown={onTimelineBackgroundDown}>
                  {trackHeader(o.name, ref, { hidden: o.hidden, locked: o.locked })}
                  {freeChip('overlay', o.id, o.start, overlayLength(o), 0, OV_LANE_H, o.color,
                    `${o.kind === 'image' ? '이미지' : '영상'} · ${o.name}${o.repeat > 1 ? ` · 반복 ${o.repeat}회` : ''}${o.kind === 'video' && o.muted ? ' · 음소거' : ''}`,
                    isSelected(ref),
                    <>{fadeVisual(o.fadeIn, o.fadeOut, overlayLength(o))}{keyframeVisual(o.positionKeyframes, overlayLength(o))}</>,
                    { hidden: o.hidden, locked: o.locked })}
                </div>
              )
            }
            const t = texts.find((item) => item.id === ref.id)
            if (!t) return null
            return (
              <div key={`visual:${ref.type}:${ref.id}`} className="timeline__lane timeline__lane--visual timeline__lane--text" style={{ height: OV_LANE_H }}
                onPointerDown={onTimelineBackgroundDown}>
                {trackHeader(t.text || '텍스트', ref, { hidden: t.hidden, locked: t.locked })}
                {freeChip('text', t.id, t.start, t.end - t.start, 0, OV_LANE_H, '#3a4250',
                  `텍스트 · ${t.text}`,
                  isSelected(ref),
                  <>{fadeVisual(t.fadeIn, t.fadeOut, t.end - t.start)}{keyframeVisual(t.positionKeyframes, t.end - t.start)}</>,
                  { hidden: t.hidden, locked: t.locked })}
              </div>
            )
          })}

          {/* Main video track */}
          <div
            className={`timeline__track${dragId ? ' timeline__track--reordering' : ''}`}
            onPointerDown={onTimelineBackgroundDown}
          >
            {trackHeader('메인 트랙')}
            {clips.length === 0 && <div className="timeline__placeholder">＋ 동영상·사진을 추가하세요</div>}
            {clips.map((c, i) => {
              const isSel = isSelected({ type: 'clip', id: c.id })
              const isDragging = dragId === c.id
              const clipWidth = Math.max(2, clipTimelineDuration(c) * pxPerSec)
              return (
                <div
                  key={c.id}
                  className={`clip${isSel ? ' clip--selected' : ''}${isDragging ? ' clip--dragging' : ''}`}
                  style={{
                    left: isDragging ? dragLeft : timelineX(offsets[i]),
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
                  style={{ left: timelineX(boundary) }}
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
              onPointerDown={onTimelineBackgroundDown}
            >
              {trackHeader('오디오')}
              {audios.map((a, i) =>
                freeChip('audio', a.id, a.start, audioLength(a), audioLanes[i], AUD_LANE_H, a.color,
                  `음악 · ${a.name}${a.repeat > 1 ? ` · 반복 ${a.repeat}회` : ''}${a.muted ? ' · 음소거' : ''}`,
                  isSelected({ type: 'audio', id: a.id }),
                  <><AudioWaveform media={a} />{fadeVisual(a.fadeIn, a.fadeOut, audioLength(a))}</>),
              )}
            </div>
          )}

          {/* Background lanes (bottom = lowest layer) */}
          {nBgLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--bg"
              style={{ height: nBgLanes * AUD_LANE_H }}
              onPointerDown={onTimelineBackgroundDown}
            >
              {trackHeader('배경')}
              {backgrounds.map((b, i) =>
                freeChip('background', b.id, b.start, clipTimelineDuration(b), bgLanes[i], AUD_LANE_H, clipBg(b),
                  `배경 · ${b.name}${b.kind === 'video' && b.muted ? ' · 음소거' : ''}`,
                  isSelected({ type: 'background', id: b.id }),
                  fadeVisual(b.fadeIn, b.fadeOut, clipTimelineDuration(b)),
                  { hidden: b.hidden, locked: b.locked }),
              )}
            </div>
          )}

          <div className={`timeline__playhead${scrubbing ? ' timeline__playhead--dragging' : ''}`} style={{ left: timelineX(playhead) }}
            onPointerDown={onPlayheadDown} onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') { event.preventDefault(); stepPlayhead(event.shiftKey ? -1 : -1 / 30) }
              else if (event.key === 'ArrowRight') { event.preventDefault(); stepPlayhead(event.shiftKey ? 1 : 1 / 30) }
              else if (event.key === 'Home') { event.preventDefault(); setPlayhead(0) }
              else if (event.key === 'End') { event.preventDefault(); setPlayhead(total) }
            }}
            role="slider" tabIndex={0} aria-label="타임라인 재생 헤드" aria-valuemin={0} aria-valuemax={total} aria-valuenow={playhead} aria-valuetext={formatClock(playhead)}
            title={`${formatTimeFine(playhead)} · 넓은 영역을 끌어서 이동`}>
            <span className="timeline__playhead-time">{formatTimeFine(playhead)}</span>
            <span className="timeline__playhead-grab" />
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
        const menuVisualOrder = normalizeVisualOrder(st.overlays, st.texts, st.visualOrder)
        const sharedVisualLayer = target.type === 'overlay' || target.type === 'text'
        const layerIndex = sharedVisualLayer
          ? menuVisualOrder.findIndex((entry) => entry.type === target.type && entry.id === target.id)
          : target.type === 'background' ? st.backgrounds.findIndex((entry) => entry.id === target.id) : -1
        const layerCount = sharedVisualLayer ? menuVisualOrder.length : target.type === 'background' ? st.backgrounds.length : 0
        const mainLength = totalDuration(st.clips)
        const itemStart = item?.start ?? visualItem?.start ?? 0
        const targetGroup = groupFor(target)
        const fitSpan = (start: number, length: number) => {
          const safeLength = Math.max(0.1, length)
          if (target.type === 'text') updateText(target.id, { start, end: start + safeLength })
          else if (target.type === 'overlay' && item && 'speed' in item) {
            const media = item as { trimStart: number; trimEnd: number; speed: number }
            updateOverlay(target.id, { start, ...exactDurationPatch((media.trimEnd - media.trimStart) / media.speed, safeLength) })
          } else if (target.type === 'background' && item && 'speed' in item) {
            const media = item as { trimStart: number; trimEnd: number; speed: number }
            updateBackground(target.id, { start, ...exactDurationPatch((media.trimEnd - media.trimStart) / media.speed, safeLength) })
          } else if (target.type === 'audio' && item) {
            updateAudio(target.id, { start, ...exactDurationPatch(item.trimEnd - item.trimStart, safeLength) })
          }
        }
        const playheadClipSpan = () => {
          const offsets = clipStartOffsets(st.clips)
          const index = st.clips.findIndex((clip, i) => st.playhead >= offsets[i] && st.playhead <= offsets[i] + clipTimelineDuration(clip))
          if (index < 0) return null
          return { start: offsets[index], length: clipTimelineDuration(st.clips[index]) }
        }
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
            {selectedItems.length > 1 && <button role="menuitem" onClick={() => { groupSelected(); setMenu(null) }}>선택 항목 그룹 만들기 ({selectedItems.length})</button>}
            {targetGroup && <button role="menuitem" onClick={() => withTarget(target, ungroupSelected)}>그룹 해제</button>}
            {target.type !== 'clip' && <button role="menuitem" onClick={() => withTarget(target, moveToPlayhead)}>재생 헤드 위치로 이동</button>}
            {target.type !== 'clip' && mainLength > 0 && <>
              <button role="menuitem" onClick={() => withTarget(target, () => fitSpan(0, mainLength))}>메인 트랙 전체 길이에 맞춤</button>
              <button role="menuitem" disabled={!playheadClipSpan()} onClick={() => withTarget(target, () => {
                const span = playheadClipSpan()
                if (span) fitSpan(span.start, span.length)
              })}>재생 헤드의 클립 구간에 맞춤</button>
              <button role="menuitem" disabled={itemStart >= mainLength} onClick={() => withTarget(target, () => fitSpan(itemStart, mainLength - itemStart))}>현재 위치부터 메인 끝까지</button>
            </>}
            {(target.type === 'overlay' || target.type === 'background' || target.type === 'text') && <>
              <button role="menuitem" disabled={layerIndex < 0 || layerIndex >= layerCount - 1} onClick={() => withTarget(target, () => target.type === 'overlay' ? raiseOverlay(target.id, 1) : target.type === 'background' ? raiseBackground(target.id, 1) : raiseText(target.id, 1))}>레이어 한 단계 위로</button>
              <button role="menuitem" disabled={layerIndex <= 0} onClick={() => withTarget(target, () => target.type === 'overlay' ? raiseOverlay(target.id, -1) : target.type === 'background' ? raiseBackground(target.id, -1) : raiseText(target.id, -1))}>레이어 한 단계 아래로</button>
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
