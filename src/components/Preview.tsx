import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import type { AspectRatio } from '../types'
import {
  resolveTimelineTime,
  totalDuration,
  overlayLength,
  audioLength,
  clipTimelineDuration,
  projectDuration,
} from '../utils/time'
import { cssTransform, cssCropFill } from '../utils/transform'
import { hexToRgba } from '../utils/color'
import Icon from './Icon'

const RATIO: Record<AspectRatio, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }
const DRIFT = 0.35 // seconds before we hard-seek a media element back in sync

function fitBox(cw: number, ch: number, r: number): { w: number; h: number } {
  if (cw <= 0 || ch <= 0) return { w: 0, h: 0 }
  let w = cw
  let h = w / r
  if (h > ch) {
    h = ch
    w = h * r
  }
  return { w: Math.floor(w), h: Math.floor(h) }
}

export default function Preview() {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const backgrounds = useEditor((s) => s.backgrounds)
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const isPlaying = useEditor((s) => s.isPlaying)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setPlaying = useEditor((s) => s.setPlaying)
  const select = useEditor((s) => s.select)
  const updateOverlay = useEditor((s) => s.updateOverlay)
  const updateText = useEditor((s) => s.updateText)
  const updateClip = useEditor((s) => s.updateClip)

  const areaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const mainVideoRef = useRef<HTMLVideoElement>(null)
  const mainImgRef = useRef<HTMLImageElement>(null)
  const mainColorRef = useRef<HTMLDivElement>(null)
  const overlayEls = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map())
  const wrapEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const bgWrapEls = useRef<Map<string, HTMLDivElement>>(new Map())
  const bgMediaEls = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map())
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map())
  const loadedMainId = useRef<string | null>(null)
  const rafRef = useRef<number>(0)
  // WebAudio graph so volume can exceed 1.0 (the <video>.volume cap).
  const audioCtx = useRef<AudioContext | null>(null)
  const gainNodes = useRef<Map<HTMLMediaElement, GainNode>>(new Map())
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [cropMode, setCropMode] = useState(false)
  const selClip = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : null
  const selOverlayId = selection?.type === 'overlay' ? selection.id : null

  // Leave crop mode when the selection changes.
  const selectionKey = selection ? `${selection.type}:${selection.id}` : ''
  useEffect(() => { setCropMode(false) }, [selectionKey])

  // ---- interactive crop / pan (works for the main clip and PiP overlays) ----
  type CropKind = 'clip' | 'overlay'
  const cropRectOf = (kind: CropKind, id: string): DOMRect | null => {
    const el = kind === 'clip' ? frameRef.current : wrapEls.current.get(id)
    return el ? el.getBoundingClientRect() : null
  }
  const cropItem = (kind: CropKind, id: string) =>
    kind === 'clip'
      ? useEditor.getState().clips.find((c) => c.id === id)
      : useEditor.getState().overlays.find((o) => o.id === id)
  const cropUpdate = (kind: CropKind, id: string, crop: { top: number; right: number; bottom: number; left: number }) =>
    kind === 'clip' ? updateClip(id, { crop }) : updateOverlay(id, { crop })

  const withCropDrag = (onMove: (ev: PointerEvent) => void) => {
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => onMove(ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = prev
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const cropCorner = (kind: CropKind, id: string, corner: 'tl' | 'tr' | 'bl' | 'br') => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const rect = cropRectOf(kind, id)
    if (!rect) return
    withCropDrag((ev) => {
      const fx = Math.max(0, Math.min((ev.clientX - rect.left) / rect.width, 1))
      const fy = Math.max(0, Math.min((ev.clientY - rect.top) / rect.height, 1))
      const cur = cropItem(kind, id)
      if (!cur) return
      const crop = { ...cur.crop }
      if (corner === 'tl' || corner === 'bl') crop.left = fx
      if (corner === 'tr' || corner === 'br') crop.right = 1 - fx
      if (corner === 'tl' || corner === 'tr') crop.top = fy
      if (corner === 'bl' || corner === 'br') crop.bottom = 1 - fy
      cropUpdate(kind, id, crop)
    })
  }

  const cropPan = (kind: CropKind, id: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const rect = cropRectOf(kind, id)
    const c0 = cropItem(kind, id)?.crop
    if (!rect || !c0) return
    const startX = e.clientX
    const startY = e.clientY
    withCropDrag((ev) => {
      const dx = (ev.clientX - startX) / rect.width
      const dy = (ev.clientY - startY) / rect.height
      let left = c0.left + dx, right = c0.right - dx, top = c0.top + dy, bottom = c0.bottom - dy
      if (left < 0) { right += left; left = 0 }
      if (right < 0) { left += right; right = 0 }
      if (top < 0) { bottom += top; top = 0 }
      if (bottom < 0) { top += bottom; bottom = 0 }
      cropUpdate(kind, id, { top, right, bottom, left })
    })
  }

  // Uniformly grow/shrink the kept region about its center (zoom out / in).
  const cropZoom = (kind: CropKind, id: string, factor: number) => {
    const cur = cropItem(kind, id)
    if (!cur) return
    const c = cur.crop
    const cx = (c.left + (1 - c.right)) / 2
    const cy = (c.top + (1 - c.bottom)) / 2
    const kw = Math.max(0.04, Math.min(1, (1 - c.left - c.right) * factor))
    const kh = Math.max(0.04, Math.min(1, (1 - c.top - c.bottom) * factor))
    const clamp = (v: number) => Math.max(0, Math.min(v, 0.49))
    cropUpdate(kind, id, {
      left: clamp(cx - kw / 2), right: clamp(1 - (cx + kw / 2)),
      top: clamp(cy - kh / 2), bottom: clamp(1 - (cy + kh / 2)),
    })
  }

  const cropEditor = (kind: CropKind, id: string, crop: { top: number; right: number; bottom: number; left: number }) => (
    <div className="cropedit" onPointerDown={(e) => e.stopPropagation()}>
      <div
        className="cropedit__rect"
        style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, right: `${crop.right * 100}%`, bottom: `${crop.bottom * 100}%` }}
        onPointerDown={cropPan(kind, id)}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <span key={c} className={`crophandle crophandle--${c}`} onPointerDown={cropCorner(kind, id, c)} />
        ))}
      </div>
      <div className="cropedit__zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" title="축소" onClick={() => cropZoom(kind, id, 1 / 0.9)}>−</button>
        <button type="button" title="확대" onClick={() => cropZoom(kind, id, 0.9)}>＋</button>
      </div>
    </div>
  )

  const ensureAudioGraph = () => {
    if (!audioCtx.current) {
      try {
        audioCtx.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      } catch {
        audioCtx.current = null
      }
    }
    if (audioCtx.current?.state === 'suspended') audioCtx.current.resume().catch(() => {})
    return audioCtx.current
  }

  // Set an element's effective volume. The default path uses the element's own
  // audio (reliable). WebAudio is only introduced when a >1 boost is requested —
  // once an element is routed through a GainNode it stays routed.
  const setGain = (el: HTMLMediaElement, volume: number, muted: boolean) => {
    const node = gainNodes.current.get(el)
    if (node) {
      el.muted = false // the gain node handles muting so the signal path stays alive
      node.gain.value = muted ? 0 : volume
      return
    }
    if (volume <= 1) {
      // Native path — no WebAudio needed, so audio plays even without a user gesture graph.
      el.muted = muted
      el.volume = Math.max(0, Math.min(1, volume))
      return
    }
    // Boost requested → build a GainNode graph for this element now.
    const ctx = ensureAudioGraph()
    if (!ctx) {
      el.muted = muted
      el.volume = 1
      return
    }
    try {
      const src = ctx.createMediaElementSource(el)
      const g = ctx.createGain()
      src.connect(g)
      g.connect(ctx.destination)
      gainNodes.current.set(el, g)
      el.muted = false
      el.volume = 1
      g.gain.value = muted ? 0 : volume
    } catch {
      el.muted = muted
      el.volume = 1
    }
  }

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const recompute = () => setBox(fitBox(el.clientWidth, el.clientHeight, RATIO[aspectRatio]))
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    recompute()
    return () => ro.disconnect()
  }, [aspectRatio])

  // Close the WebAudio context when the preview unmounts.
  useEffect(() => () => { audioCtx.current?.close().catch(() => {}) }, [])

  // ---- compositor sync: drive every media element from a time value ----
  const syncMain = (time: number, playing: boolean) => {
    const cur = useEditor.getState().clips
    const v = mainVideoRef.current
    const img = mainImgRef.current
    const colorEl = mainColorRef.current
    if (!v || !img) return
    if (colorEl) colorEl.style.display = 'none'
    const mainTotal = totalDuration(cur)
    const res = cur.length && time < mainTotal - 1e-4 ? resolveTimelineTime(cur, time) : null
    if (!res) {
      v.style.display = 'none'
      img.style.display = 'none'
      if (!v.paused) v.pause()
      loadedMainId.current = null
      return
    }
    const clip = res.clip
    // While crop-editing this clip we show the FULL frame (so the crop rect can be
    // dragged); otherwise the kept region is scaled up to fill with no margins.
    const editingCrop = cropMode && selection?.type === 'clip' && selection.id === clip.id
    const tf = editingCrop
      ? cssTransform(clip.rotate, clip.flipH, clip.flipV)
      : `${cssCropFill(clip.crop)} ${cssTransform(clip.rotate, clip.flipH, clip.flipV)}`.trim()
    const cp = 'none'
    if (clip.kind === 'color') {
      if (colorEl) {
        colorEl.style.display = ''
        colorEl.style.background = clip.bgColor || '#000000'
      }
      v.style.display = 'none'
      img.style.display = 'none'
      if (!v.paused) v.pause()
      loadedMainId.current = null
      return
    }
    if (clip.kind === 'image') {
      if (img.getAttribute('src') !== clip.src) img.src = clip.src
      img.style.display = ''
      img.style.transform = tf
      img.style.clipPath = cp
      v.style.display = 'none'
      if (!v.paused) v.pause()
      loadedMainId.current = null
      return
    }
    v.style.display = ''
    v.style.transform = tf
    v.style.clipPath = cp
    img.style.display = 'none'
    v.playbackRate = clip.speed
    setGain(v, clip.volume, clip.muted)
    if (loadedMainId.current !== clip.id) {
      loadedMainId.current = clip.id
      v.src = clip.src
      const onReady = () => {
        v.removeEventListener('loadeddata', onReady)
        try { v.currentTime = res.localTime } catch { /* not ready */ }
        if (playing) v.play().catch(() => {})
      }
      v.addEventListener('loadeddata', onReady)
      v.load()
    } else if (playing) {
      if (v.paused) v.play().catch(() => {})
      // Re-seek on drift, or when a repeating clip plays past its trim out-point.
      const overshoot = clip.repeat > 1 && v.currentTime >= clip.trimEnd - 0.05
      if (overshoot || Math.abs(v.currentTime - res.localTime) > DRIFT) {
        try { v.currentTime = res.localTime } catch { /* ignore */ }
      }
    } else {
      if (!v.paused) v.pause()
      try { v.currentTime = res.localTime } catch { /* ignore */ }
    }
  }

  const syncOverlays = (time: number, playing: boolean) => {
    for (const o of useEditor.getState().overlays) {
      const wrap = wrapEls.current.get(o.id)
      const active = time >= o.start - 1e-3 && time < o.start + overlayLength(o)
      if (wrap) {
        wrap.style.visibility = active ? 'visible' : 'hidden'
        wrap.style.transform = `translate(-50%, -50%) rotate(${o.angle || 0}deg)`
      }
      const media = overlayEls.current.get(o.id)
      if (media) {
        const editingCrop = cropMode && selection?.type === 'overlay' && selection.id === o.id
        media.style.transform = editingCrop
          ? cssTransform(o.rotate, o.flipH, o.flipV)
          : `${cssCropFill(o.crop)} ${cssTransform(o.rotate, o.flipH, o.flipV)}`.trim()
        media.style.clipPath = 'none'
      }
      if (o.kind === 'image') continue
      const v = media as HTMLVideoElement | undefined
      if (!v) continue
      if (!active) {
        if (!v.paused) v.pause()
        continue
      }
      v.playbackRate = o.speed
      setGain(v, o.volume, o.muted)
      const oBase = (o.trimEnd - o.trimStart) / o.speed
      const oInto = time - o.start
      const local = o.trimStart + (o.repeat > 1 && oBase > 0 ? oInto % oBase : oInto) * o.speed
      if (playing) {
        if (v.paused) v.play().catch(() => {})
        const overshoot = o.repeat > 1 && v.currentTime >= o.trimEnd - 0.05
        if (overshoot || Math.abs(v.currentTime - local) > DRIFT) {
          try { v.currentTime = local } catch { /* ignore */ }
        }
      } else {
        if (!v.paused) v.pause()
        try { v.currentTime = local } catch { /* ignore */ }
      }
    }
  }

  const syncAudios = (time: number, playing: boolean) => {
    for (const a of useEditor.getState().audios) {
      const el = audioEls.current.get(a.id)
      if (!el) continue
      const active = time >= a.start - 1e-3 && time < a.start + audioLength(a)
      setGain(el, a.volume, a.muted)
      const aBase = a.trimEnd - a.trimStart
      const aInto = time - a.start
      const local = a.trimStart + (a.repeat > 1 && aBase > 0 ? aInto % aBase : aInto)
      if (active && playing) {
        if (el.paused) el.play().catch(() => {})
        const overshoot = a.repeat > 1 && el.currentTime >= a.trimEnd - 0.05
        if (overshoot || Math.abs(el.currentTime - local) > DRIFT) {
          try { el.currentTime = local } catch { /* ignore */ }
        }
      } else {
        if (!el.paused) el.pause()
        if (!playing && active) {
          try { el.currentTime = local } catch { /* ignore */ }
        }
      }
    }
  }

  const syncBackgrounds = (time: number, playing: boolean) => {
    for (const b of useEditor.getState().backgrounds) {
      const wrap = bgWrapEls.current.get(b.id)
      const active = time >= b.start - 1e-3 && time < b.start + clipTimelineDuration(b)
      if (wrap) {
        wrap.style.visibility = active ? 'visible' : 'hidden'
        if (b.kind === 'color') wrap.style.background = b.bgColor || '#000000'
      }
      if (b.kind !== 'video') continue
      const v = bgMediaEls.current.get(b.id) as HTMLVideoElement | undefined
      if (!v) continue
      if (!active) {
        if (!v.paused) v.pause()
        continue
      }
      v.playbackRate = b.speed
      setGain(v, b.volume, b.muted)
      const base = (b.trimEnd - b.trimStart) / b.speed
      const into = time - b.start
      const local = b.trimStart + (b.repeat > 1 && base > 0 ? into % base : into) * b.speed
      if (playing) {
        if (v.paused) v.play().catch(() => {})
        const over = b.repeat > 1 && v.currentTime >= b.trimEnd - 0.05
        if (over || Math.abs(v.currentTime - local) > DRIFT) {
          try { v.currentTime = local } catch { /* ignore */ }
        }
      } else {
        if (!v.paused) v.pause()
        try { v.currentTime = local } catch { /* ignore */ }
      }
    }
  }

  const syncAll = (time: number, playing: boolean) => {
    syncBackgrounds(time, playing)
    syncMain(time, playing)
    syncOverlays(time, playing)
    syncAudios(time, playing)
  }

  const pauseAllMedia = () => {
    mainVideoRef.current?.pause()
    overlayEls.current.forEach((el) => 'pause' in el && (el as HTMLVideoElement).pause())
    bgMediaEls.current.forEach((el) => 'pause' in el && (el as HTMLVideoElement).pause())
    audioEls.current.forEach((el) => el.pause())
  }

  // ---- paused: keep every layer synced to the playhead ----
  useEffect(() => {
    if (isPlaying) return
    syncAll(playhead, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, isPlaying, clips, overlays, audios, backgrounds, aspectRatio, cropMode, selection])

  // ---- playing: a master clock advances the playhead in real time ----
  useEffect(() => {
    if (!isPlaying) return
    ensureAudioGraph() // play was triggered by a user gesture → safe to start audio
    const s = useEditor.getState()
    const total = projectDuration(s.clips, s.overlays, s.audios, s.texts, s.backgrounds)
    if (total <= 0) {
      setPlaying(false)
      return
    }
    let cancelled = false
    let startHead = playhead >= total - 0.02 ? 0 : playhead
    let startWall = performance.now()
    const tick = () => {
      if (cancelled) return
      const t = Math.min(startHead + (performance.now() - startWall) / 1000, total)
      setPlayhead(t)
      syncAll(t, true)
      if (t >= total) {
        if (useEditor.getState().loop) {
          // Restart from the beginning for infinite playback.
          startHead = 0
          startWall = performance.now()
          setPlayhead(0)
        } else {
          cancelled = true
          setPlaying(false)
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    syncAll(startHead, true)
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      pauseAllMedia()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // ---- drag a PiP overlay around the frame (keeps the grab point fixed) ----
  const onOverlayDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'overlay', id })
    setPlaying(false)
    const frame = frameRef.current
    const o = useEditor.getState().overlays.find((x) => x.id === id)
    if (!frame || !o) return
    const rect = frame.getBoundingClientRect()
    // Offset from the cursor to the overlay center, kept constant while dragging.
    const grabDx = e.clientX - (rect.left + o.x * rect.width)
    const grabDy = e.clientY - (rect.top + o.y * rect.height)
    const prevSel = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      updateOverlay(id, {
        x: (ev.clientX - grabDx - rect.left) / rect.width,
        y: (ev.clientY - grabDy - rect.top) / rect.height,
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = prevSel
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- drag the corner handle to resize a PiP overlay ----
  const onResizeDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'overlay', id })
    setPlaying(false)
    const frame = frameRef.current
    const o = useEditor.getState().overlays.find((x) => x.id === id)
    if (!frame || !o) return
    const rect = frame.getBoundingClientRect()
    const centerX = rect.left + o.x * rect.width
    const centerY = rect.top + o.y * rect.height
    // Radial resize: distance from the overlay center drives the scale, so dragging
    // a corner outward in *any* direction grows it and inward shrinks it.
    const d0 = Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1
    const s0 = o.scale
    const prevSel = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      const d = Math.hypot(ev.clientX - centerX, ev.clientY - centerY)
      updateOverlay(id, { scale: Math.max(0.05, Math.min((s0 * d) / d0, 3)) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = prevSel
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- drag the rotation handle to spin a layer freely (overlay or text) ----
  const onRotateDown = (kind: 'overlay' | 'text', id: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: kind, id })
    setPlaying(false)
    const frame = frameRef.current
    const item = kind === 'overlay'
      ? useEditor.getState().overlays.find((o) => o.id === id)
      : useEditor.getState().texts.find((t) => t.id === id)
    if (!frame || !item) return
    const rect = frame.getBoundingClientRect()
    const cx = rect.left + item.x * rect.width
    const cy = rect.top + item.y * rect.height
    const base = (item.angle || 0) - (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
    const prevSel = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      let deg = base + (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      deg = Math.round(((deg + 540) % 360) - 180) // normalize to -180..180
      if (!ev.shiftKey && Math.abs(deg % 90) <= 4) deg = Math.round(deg / 90) * 90 // snap near right angles
      if (kind === 'overlay') updateOverlay(id, { angle: deg })
      else updateText(id, { angle: deg })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = prevSel
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- drag a text overlay around the frame (mouse + touch via pointer events) ----
  const onTextDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'text', id })
    setPlaying(false)
    const frame = frameRef.current
    const t = useEditor.getState().texts.find((x) => x.id === id)
    if (!frame || !t) return
    const rect = frame.getBoundingClientRect()
    const grabDx = e.clientX - (rect.left + t.x * rect.width)
    const grabDy = e.clientY - (rect.top + t.y * rect.height)
    const prevSel = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      updateText(id, {
        x: (ev.clientX - grabDx - rect.left) / rect.width,
        y: (ev.clientY - grabDy - rect.top) / rect.height,
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = prevSel
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- drag the corner handle to resize text (distance-from-center based) ----
  const onTextResize = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'text', id })
    setPlaying(false)
    const frame = frameRef.current
    const t = useEditor.getState().texts.find((x) => x.id === id)
    if (!frame || !t) return
    const rect = frame.getBoundingClientRect()
    const cx = rect.left + t.x * rect.width
    const cy = rect.top + t.y * rect.height
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1
    const startSize = t.size
    const prevSel = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy)
      updateText(id, { size: (startSize * d) / startDist })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = prevSel
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const visibleTexts = texts.filter((t) => playhead >= t.start && playhead <= t.end)
  const hasContent = clips.length > 0 || overlays.length > 0 || audios.length > 0 || backgrounds.length > 0

  return (
    <div className="preview" ref={areaRef}>
      <div
        className="preview__frame"
        ref={frameRef}
        style={{ width: box.w, height: box.h }}
        onDoubleClick={() => { if (selClip) setCropMode((m) => !m) }}
      >
        {backgrounds.map((b) => (
          <div
            key={b.id}
            ref={(el) => { if (el) bgWrapEls.current.set(b.id, el); else bgWrapEls.current.delete(b.id) }}
            className="preview__bg"
            style={{ visibility: 'hidden' }}
          >
            {b.kind === 'video' && (
              <video ref={(el) => { if (el) bgMediaEls.current.set(b.id, el); else bgMediaEls.current.delete(b.id) }}
                className="preview__bg-media" src={b.src} playsInline />
            )}
            {b.kind === 'image' && (
              <img ref={(el) => { if (el) bgMediaEls.current.set(b.id, el); else bgMediaEls.current.delete(b.id) }}
                className="preview__bg-media" src={b.src} alt="" />
            )}
          </div>
        ))}
        <video
          ref={mainVideoRef}
          className="preview__video"
          playsInline
          onClick={() => hasContent && setPlaying(!isPlaying)}
        />
        <img ref={mainImgRef} className="preview__video" alt="" style={{ display: 'none' }} />
        <div ref={mainColorRef} className="preview__video" style={{ display: 'none' }} />

        {overlays.map((o) => {
          const sel = selection?.type === 'overlay' && selection.id === o.id
          return (
            <div
              key={o.id}
              ref={(el) => { if (el) wrapEls.current.set(o.id, el); else wrapEls.current.delete(o.id) }}
              className={`preview__overlay${sel ? ' preview__overlay--selected' : ''}`}
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.scale * 100}%`, visibility: 'hidden' }}
              onPointerDown={(e) => onOverlayDown(e, o.id)}
              onDoubleClick={(e) => { e.stopPropagation(); if (sel) setCropMode((m) => !m) }}
            >
              <div className="preview__overlay-clip">
                {o.kind === 'video' ? (
                  <video
                    ref={(el) => { if (el) overlayEls.current.set(o.id, el); else overlayEls.current.delete(o.id) }}
                    className="preview__overlay-media"
                    src={o.src}
                    playsInline
                  />
                ) : (
                  <img
                    ref={(el) => { if (el) overlayEls.current.set(o.id, el); else overlayEls.current.delete(o.id) }}
                    className="preview__overlay-media"
                    src={o.src}
                    alt=""
                  />
                )}
              </div>
              {sel && !cropMode && (['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                <span key={corner} className={`preview__resize preview__resize--${corner}`} onPointerDown={(e) => onResizeDown(e, o.id)} />
              ))}
              {sel && !cropMode && (
                <span className="preview__rotate" title="끌어서 회전" onPointerDown={onRotateDown('overlay', o.id)} />
              )}
              {sel && cropMode && selOverlayId === o.id && cropEditor('overlay', o.id, o.crop)}
            </div>
          )
        })}

        {!hasContent && (
          <div className="preview__empty">
            <span><Icon name="video" /></span>
            <p>동영상·사진을 추가해 편집을 시작하세요</p>
          </div>
        )}

        {visibleTexts.map((t) => {
          const fontPx = t.size * box.h
          const sel = selection?.type === 'text' && selection.id === t.id
          return (
            <div
              key={t.id}
              className={`preview__text${sel ? ' preview__text--selected' : ''}`}
              style={{
                left: `${t.x * 100}%`,
                top: `${t.y * 100}%`,
                fontSize: `${fontPx}px`,
                fontFamily: t.font,
                color: hexToRgba(t.color, t.colorAlpha),
                textAlign: t.align,
                background: t.box ? hexToRgba(t.boxColor, t.boxAlpha) : 'transparent',
                padding: t.box ? '0.15em 0.5em' : 0,
                WebkitTextStrokeWidth: t.strokeWidth > 0 ? `${t.strokeWidth * fontPx}px` : undefined,
                WebkitTextStrokeColor: t.strokeWidth > 0 ? t.strokeColor : undefined,
                paintOrder: 'stroke fill',
                textShadow: t.shadow ? `0 ${t.shadowDist * fontPx}px ${t.shadowBlur * fontPx}px ${t.shadowColor}` : 'none',
                transform: `translate(-50%, -50%) rotate(${t.angle || 0}deg)`,
              }}
              onPointerDown={(e) => onTextDown(e, t.id)}
            >
              {t.text}
              {sel && <span className="preview__resize preview__resize--text" onPointerDown={(e) => onTextResize(e, t.id)} />}
              {sel && <span className="preview__rotate preview__rotate--text" title="끌어서 회전" onPointerDown={onRotateDown('text', t.id)} />}
            </div>
          )
        })}

        {cropMode && selClip && (
          <>
            {cropEditor('clip', selClip.id, selClip.crop)}
            <div className="cropedit__hint">모서리를 끌어 자르고, 안쪽을 끌어 이동 · 더블클릭으로 종료</div>
          </>
        )}
        {cropMode && selOverlayId && (
          <div className="cropedit__hint">오버레이 모서리를 끌어 자르고, 안쪽을 끌어 이동 · 더블클릭으로 종료</div>
        )}
      </div>

      {audios.map((a) => (
        <audio
          key={a.id}
          ref={(el) => { if (el) audioEls.current.set(a.id, el); else audioEls.current.delete(a.id) }}
          src={a.src}
          preload="auto"
        />
      ))}
    </div>
  )
}
