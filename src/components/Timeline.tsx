import { useRef, useState, useLayoutEffect, useEffect } from 'react'
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
import type { Clip, Selection } from '../types'

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

function startDrag(onMove: (e: PointerEvent) => void, onEnd?: (e: PointerEvent) => void) {
  const prevUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'
  const move = (e: PointerEvent) => onMove(e)
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.userSelect = prevUserSelect
    onEnd?.(e)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

export default function Timeline() {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const backgrounds = useEditor((s) => s.backgrounds)
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

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  const openMenu = (target: NonNullable<Selection>, x: number, y: number) => {
    setPlaying(false)
    select(target)
    setMenu({
      target,
      x: Math.max(12, Math.min(x, window.innerWidth - 242)),
      y: Math.max(12, Math.min(y, window.innerHeight - 452)),
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
  const overlayLanes = packLanes(overlays.map((o) => ({ start: o.start, end: o.start + overlayLength(o) })))
  const audioLanes = packLanes(audios.map((a) => ({ start: a.start, end: a.start + audioLength(a) })))
  const textLanes = packLanes(texts.map((t) => ({ start: t.start, end: t.end })))
  const bgLanes = packLanes(backgrounds.map((b) => ({ start: b.start, end: b.start + clipTimelineDuration(b) })))
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
      (ev) => {
        window.clearTimeout(longPress)
        setDragId(null)
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
        // Move freely from 0; the project just grows if dragged past the end.
        const ns = Math.max(0, snap(s0 + (ev.clientX - startX) / pxPerSec, id))
        if (kind === 'overlay') updateOverlay(id, { start: ns })
        else if (kind === 'audio') updateAudio(id, { start: ns })
        else if (kind === 'background') updateBackground(id, { start: ns })
        else updateText(id, { start: ns, end: ns + len })
      },
      (ev) => {
        window.clearTimeout(longPress)
        if (menuOpened) return
        if (!moved) {
          if (onName && wasSelected) startEdit(kind, id)
          else select({ type: kind, id })
          return
        }
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

  // Render one free item (overlay/audio/text) as a positioned chip.
  const freeChip = (
    kind: FreeKind, id: string, start: number, len: number, lane: number,
    laneH: number, color: string, label: string, selected: boolean,
  ) => (
    <div
      key={id}
      className={`tlclip${selected ? ' tlclip--selected' : ''}`}
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
      {selected && <span className="tlclip__handle tlclip__handle--l" onPointerDown={(e) => onFreeTrim(e, kind, id, 'start')} />}
      {editing?.id === id ? renameInput : <span className="tlclip__body">{label}</span>}
      {selected && <span className="tlclip__handle tlclip__handle--r" onPointerDown={(e) => onFreeTrim(e, kind, id, 'end')} />}
    </div>
  )

  return (
    <div className="timeline">
      <div className="timeline__bar">
        <button className="iconbtn iconbtn--xs" onClick={() => zoomBy(1 / 1.5)} disabled={atMin} title="축소">−</button>
        <button className="btn btn--sm" onClick={fitView} disabled={atFit} title="전체를 한 화면에">전체보기</button>
        <button className="iconbtn iconbtn--xs" onClick={() => zoomBy(1.5)} disabled={atMax} title="확대">＋</button>
        <span className="timeline__zoom">{Math.round((pxPerSec / fitPps) * 100)}%</span>
        <span className="timeline__hint">스크롤=확대 · Shift+스크롤=이동</span>
        <div className="timeline__bar-spacer" />
        <span className="timeline__total">{formatTime(playhead)} / {formatTime(total)}</span>
      </div>

      <div className="timeline__scroll" ref={scrollRef}>
        <div className="timeline__content" style={{ width: contentW }}>
          <div className="timeline__ruler" onPointerDown={onRulerDown}>
            {ticks.map((t) => (
              <span key={t} className="timeline__tick" style={{ left: t * pxPerSec }}>
                {tickLabel(t)}
              </span>
            ))}
          </div>

          {/* Overlay lanes (PiP) */}
          {nOverlayLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--overlay"
              style={{ height: nOverlayLanes * OV_LANE_H }}
              onPointerDown={(e) => e.target === e.currentTarget && select(null)}
            >
              {overlays.map((o, i) =>
                freeChip('overlay', o.id, o.start, overlayLength(o), overlayLanes[i], OV_LANE_H, o.color,
                  `${o.kind === 'image' ? '이미지' : '오버레이'} · ${o.name}${o.repeat > 1 ? ` · 반복 ${o.repeat}회` : ''}${o.kind === 'video' && o.muted ? ' · 음소거' : ''}`,
                  selection?.type === 'overlay' && selection.id === o.id),
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
              return (
                <div
                  key={c.id}
                  className={`clip${isSel ? ' clip--selected' : ''}${isDragging ? ' clip--dragging' : ''}`}
                  style={{
                    left: isDragging ? dragLeft : offsets[i] * pxPerSec,
                    width: Math.max(2, clipTimelineDuration(c) * pxPerSec),
                    background: clipBg(c),
                    color: contrastText(clipBg(c)),
                  }}
                  onPointerDown={(e) => onClipDown(e, c.id)}
                  onContextMenu={(e) => onItemContextMenu(e, { type: 'clip', id: c.id })}
                  onDoubleClick={() => startEdit('clip', c.id)}
                  title={`${c.name} · 끌어서 순서 변경, 오른쪽 끝을 끌어서 트림 · 선택 후 이름 클릭으로 이름변경`}
                >
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
                  selection?.type === 'audio' && selection.id === a.id),
              )}
            </div>
          )}

          {/* Text lanes */}
          {nTextLanes > 0 && (
            <div
              className="timeline__lane timeline__lane--text"
              style={{ height: nTextLanes * TXT_LANE_H }}
              onPointerDown={(e) => e.target === e.currentTarget && select(null)}
            >
              {texts.map((t, i) =>
                freeChip('text', t.id, t.start, t.end - t.start, textLanes[i], TXT_LANE_H, '#3a4250',
                  `T ${t.text}`,
                  selection?.type === 'text' && selection.id === t.id),
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
                  selection?.type === 'background' && selection.id === b.id),
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
            <button role="menuitem" onClick={() => withTarget(target, duplicateSelected)}>복제</button>
            <div className="timeline-menu__separator" />
            <button role="menuitem" className="timeline-menu__danger" onClick={() => withTarget(target, deleteSelected)}>삭제</button>
          </div>
        )
      })()}
    </div>
  )
}
