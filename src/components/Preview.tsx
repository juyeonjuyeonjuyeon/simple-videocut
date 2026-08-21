import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import type { AspectRatio, Overlay } from '../types'
import {
  resolveTimelineTime,
  totalDuration,
  overlayLength,
  audioLength,
  clipTimelineDuration,
  projectDuration,
  clipStartOffsets,
  fadeLevel,
} from '../utils/time'
import { cssTransform, cssCropFill } from '../utils/transform'
import { hexToRgba } from '../utils/color'
import { normalizeVisualOrder, PREVIEW_Z, visualPreviewZ } from '../utils/layers'
import { startPointerDrag } from '../utils/pointer'
import { positionAt } from '../utils/motion'
import Icon from './Icon'
import { maskClipPath, maskPathData, resolveOverlayStyle } from '../utils/overlay-style'

const RATIO: Record<AspectRatio, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }
const DRIFT = 0.35 // seconds before we hard-seek a media element back in sync
const SNAP_PX = 8

const snapLayerAxis = (center: number, size: number, axisPixels: number) => {
  const candidates = [
    { center: size / 2, guide: 0 },
    { center: 0.5, guide: 0.5 },
    { center: 1 - size / 2, guide: 1 },
  ]
  const match = candidates
    .map((candidate) => ({ ...candidate, distance: Math.abs(center - candidate.center) * axisPixels }))
    .sort((a, b) => a.distance - b.distance)[0]
  return match && match.distance <= SNAP_PX ? match : { center, guide: null }
}

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

function OverlayDecoration({ overlay, frameHeight }: { overlay: Overlay; frameHeight: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 100, height: 100 })
  const style = resolveOverlayStyle(overlay)
  const borderWidth = style.borderWidth * frameHeight
  const enabled = borderWidth >= 0.5

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [enabled])

  if (!enabled) return null
  const path = (inset: number) => maskPathData(style.maskShape, size.width, size.height, inset)
  const common = { fill: 'none', stroke: style.borderColor, strokeLinejoin: 'round' as const }
  return (
    <svg ref={ref} className="preview__overlay-decoration" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
      {style.borderStyle === 'double' ? <>
        <path {...common} d={path(borderWidth / 6)} strokeWidth={Math.max(1, borderWidth / 3)} />
        <path {...common} d={path(borderWidth * 5 / 6)} strokeWidth={Math.max(1, borderWidth / 3)} />
      </> : (
        <path {...common} d={path(borderWidth / 2)} strokeWidth={borderWidth}
          strokeDasharray={style.borderStyle === 'dashed' ? `${borderWidth * 3} ${borderWidth * 2}` : style.borderStyle === 'dotted' ? `0.1 ${borderWidth * 1.9}` : undefined}
          strokeLinecap={style.borderStyle === 'dotted' ? 'round' : 'butt'} />
      )}
    </svg>
  )
}

export default function Preview({ onOpenCrop }: { onOpenCrop: () => void }) {
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const backgrounds = useEditor((s) => s.backgrounds)
  const storedVisualOrder = useEditor((s) => s.visualOrder)
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const isPlaying = useEditor((s) => s.isPlaying)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setPlaying = useEditor((s) => s.setPlaying)
  const select = useEditor((s) => s.select)
  const updateOverlay = useEditor((s) => s.updateOverlay)
  const updateLayerPosition = useEditor((s) => s.updateLayerPosition)
  const updateText = useEditor((s) => s.updateText)

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
  const [overlayControlHeight, setOverlayControlHeight] = useState(0)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [rotationReadout, setRotationReadout] = useState<{ type: 'overlay' | 'text'; id: string; angle: number } | null>(null)
  const selClip = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : null
  const selOverlayId = selection?.type === 'overlay' ? selection.id : null
  const selOverlay = selOverlayId ? overlays.find((o) => o.id === selOverlayId) : null
  const selOverlayPosition = selOverlay ? positionAt(selOverlay, playhead - selOverlay.start) : null
  const visualOrder = normalizeVisualOrder(overlays, texts, storedVisualOrder)

  // Keep editing controls above the content stack without changing the
  // selected overlay's actual compositing order.
  useLayoutEffect(() => {
    if (!selOverlayId) {
      setOverlayControlHeight(0)
      return
    }
    const element = wrapEls.current.get(selOverlayId)
    if (!element) return
    const measure = () => setOverlayControlHeight(element.offsetHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [selOverlayId, box.w, box.h])

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
    const localTimeline = Math.max(0, time - clipStartOffsets(cur)[res.index])
    const clipOpacity = fadeLevel(localTimeline, clipTimelineDuration(clip), clip.fadeIn, clip.fadeOut)
    const tf = `${cssCropFill(clip.crop)} ${cssTransform(clip.rotate, clip.flipH, clip.flipV)}`.trim()
    const cp = 'none'
    if (clip.kind === 'color') {
      if (colorEl) {
        colorEl.style.display = ''
        colorEl.style.background = clip.bgColor || '#000000'
        colorEl.style.opacity = String(clipOpacity)
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
      img.style.opacity = String(clipOpacity)
      v.style.display = 'none'
      if (!v.paused) v.pause()
      loadedMainId.current = null
      return
    }
    v.style.display = ''
    v.style.transform = tf
    v.style.clipPath = cp
    v.style.opacity = String(clipOpacity)
    img.style.display = 'none'
    v.playbackRate = clip.speed
    setGain(v, clip.volume * clipOpacity, clip.muted)
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
      const len = overlayLength(o)
      const active = !o.hidden && time >= o.start - 1e-3 && time < o.start + len
      const layerOpacity = (o.opacity ?? 1) * fadeLevel(time - o.start, len, o.fadeIn, o.fadeOut)
      const position = positionAt(o, time - o.start)
      if (wrap) {
        wrap.style.visibility = active ? 'visible' : 'hidden'
        wrap.style.transform = `translate(-50%, -50%) rotate(${o.angle || 0}deg)`
        wrap.style.opacity = String(layerOpacity)
        wrap.style.left = `${position.x * 100}%`
        wrap.style.top = `${position.y * 100}%`
      }
      const media = overlayEls.current.get(o.id)
      const clip = wrap?.querySelector<HTMLElement>('.preview__overlay-clip')
      if (clip && wrap) clip.style.clipPath = maskClipPath(resolveOverlayStyle(o).maskShape, wrap.offsetWidth, wrap.offsetHeight)
      if (media) {
        media.style.transform = `${cssCropFill(o.crop)} ${cssTransform(o.rotate, o.flipH, o.flipV)}`.trim()
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
      setGain(v, o.volume * fadeLevel(time - o.start, len, o.fadeIn, o.fadeOut), o.muted)
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
      setGain(el, a.volume * fadeLevel(time - a.start, audioLength(a), a.fadeIn, a.fadeOut), a.muted)
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
      const len = clipTimelineDuration(b)
      const active = !b.hidden && time >= b.start - 1e-3 && time < b.start + len
      const layerOpacity = (b.opacity ?? 1) * fadeLevel(time - b.start, len, b.fadeIn, b.fadeOut)
      if (wrap) {
        wrap.style.visibility = active ? 'visible' : 'hidden'
        wrap.style.opacity = String(layerOpacity)
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
      setGain(v, b.volume * fadeLevel(time - b.start, len, b.fadeIn, b.fadeOut), b.muted)
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
  }, [playhead, isPlaying, clips, overlays, audios, backgrounds, aspectRatio, selection])

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
    if (o.locked) return
    const rect = frame.getBoundingClientRect()
    const position = positionAt(o, useEditor.getState().playhead - o.start)
    // Offset from the cursor to the overlay center, kept constant while dragging.
    const grabDx = e.clientX - (rect.left + position.x * rect.width)
    const grabDy = e.clientY - (rect.top + position.y * rect.height)
    const width = Math.max(0.01, o.scale)
    const height = Math.max(0.01, o.scaleY != null && !(o.aspectLocked ?? true)
      ? o.scaleY
      : (wrapEls.current.get(id)?.offsetHeight || rect.height * 0.2) / rect.height)
    startPointerDrag((ev) => {
      const rawX = (ev.clientX - grabDx - rect.left) / rect.width
      const rawY = (ev.clientY - grabDy - rect.top) / rect.height
      const snapX = snapLayerAxis(rawX, width, rect.width)
      const snapY = snapLayerAxis(rawY, height, rect.height)
      setGuides({ x: snapX.guide, y: snapY.guide })
      updateLayerPosition('overlay', id, { x: snapX.center, y: snapY.center })
    }, () => setGuides({ x: null, y: null }))
  }

  // ---- resize a PiP overlay while its opposite edge/corner stays anchored ----
  type ResizeHandle = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l'
  const onResizeDown = (e: React.PointerEvent, id: string, handle: ResizeHandle) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'overlay', id })
    setPlaying(false)
    const frame = frameRef.current
    const o = useEditor.getState().overlays.find((x) => x.id === id)
    if (!frame || !o) return
    const rect = frame.getBoundingClientRect()
    const position = positionAt(o, useEditor.getState().playhead - o.start)
    const centerX = rect.left + position.x * rect.width
    const centerY = rect.top + position.y * rect.height
    const width = o.scale * rect.width
    const height = wrapEls.current.get(id)?.offsetHeight || width / (16 / 9)
    const aspect = width / Math.max(1, height)
    const movesX = handle.includes('l') || handle.includes('r')
    const movesY = handle.includes('t') || handle.includes('b')
    const signX = handle.includes('r') ? 1 : -1
    const signY = handle.includes('b') ? 1 : -1
    const radians = ((o.angle || 0) * Math.PI) / 180
    const ux = Math.cos(radians), uy = Math.sin(radians)
    const vx = -Math.sin(radians), vy = Math.cos(radians)
    const anchorX = centerX - (movesX ? signX * ux * width / 2 : 0) - (movesY ? signY * vx * height / 2 : 0)
    const anchorY = centerY - (movesX ? signX * uy * width / 2 : 0) - (movesY ? signY * vy * height / 2 : 0)
    const minWidth = rect.width * 0.1
    const maxWidth = rect.width
    const minHeight = rect.height * 0.05
    const maxHeight = rect.height
    const aspectLocked = o.aspectLocked ?? true

    startPointerDrag((ev) => {
      const dx = ev.clientX - anchorX
      const dy = ev.clientY - anchorY
      const localWidth = movesX ? signX * (dx * ux + dy * uy) : width
      const localHeight = movesY ? signY * (dx * vx + dy * vy) : height
      let nextWidth = width
      let nextHeight = height
      if (movesX && movesY) {
        const projectedWidth = (localWidth + localHeight / aspect) / (1 + 1 / (aspect * aspect))
        nextWidth = Math.max(minWidth, Math.min(aspectLocked ? projectedWidth : localWidth, maxWidth))
        nextHeight = aspectLocked ? nextWidth / aspect : Math.max(minHeight, Math.min(localHeight, maxHeight))
      } else if (movesX) {
        nextWidth = Math.max(minWidth, Math.min(localWidth, maxWidth))
        if (aspectLocked) nextHeight = nextWidth / aspect
      } else {
        nextHeight = Math.max(minHeight, Math.min(localHeight, maxHeight))
        if (aspectLocked) nextWidth = nextHeight * aspect
      }
      const nextCenterX = anchorX + (movesX ? signX * ux * nextWidth / 2 : 0) + (movesY ? signY * vx * nextHeight / 2 : 0)
      const nextCenterY = anchorY + (movesX ? signX * uy * nextWidth / 2 : 0) + (movesY ? signY * vy * nextHeight / 2 : 0)
      updateLayerPosition('overlay', id, {
        x: (nextCenterX - rect.left) / rect.width,
        y: (nextCenterY - rect.top) / rect.height,
      })
      updateOverlay(id, {
        scale: nextWidth / rect.width,
        scaleY: aspectLocked ? undefined : nextHeight / rect.height,
      })
    })
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
    const position = positionAt(item, useEditor.getState().playhead - item.start)
    const cx = rect.left + position.x * rect.width
    const cy = rect.top + position.y * rect.height
    const base = (item.angle || 0) - (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
    setRotationReadout({ type: kind, id, angle: item.angle || 0 })
    startPointerDrag((ev) => {
      let deg = base + (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      deg = Math.round(((deg + 540) % 360) - 180) // normalize to -180..180
      const snapped = Math.round(deg / 45) * 45
      if (!ev.shiftKey && Math.abs(deg - snapped) <= 3) deg = snapped
      setRotationReadout({ type: kind, id, angle: deg })
      if (kind === 'overlay') updateOverlay(id, { angle: deg })
      else updateText(id, { angle: deg })
    }, () => setRotationReadout(null))
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
    if (t.locked) return
    const rect = frame.getBoundingClientRect()
    const position = positionAt(t, useEditor.getState().playhead - t.start)
    const grabDx = e.clientX - (rect.left + position.x * rect.width)
    const grabDy = e.clientY - (rect.top + position.y * rect.height)
    startPointerDrag((ev) => {
      const rawX = (ev.clientX - grabDx - rect.left) / rect.width
      const rawY = (ev.clientY - grabDy - rect.top) / rect.height
      const snapX = Math.abs(rawX - 0.5) * rect.width <= SNAP_PX
      const snapY = Math.abs(rawY - 0.5) * rect.height <= SNAP_PX
      setGuides({ x: snapX ? 0.5 : null, y: snapY ? 0.5 : null })
      updateLayerPosition('text', id, { x: snapX ? 0.5 : rawX, y: snapY ? 0.5 : rawY })
    }, () => setGuides({ x: null, y: null }))
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
    const position = positionAt(t, useEditor.getState().playhead - t.start)
    const cx = rect.left + position.x * rect.width
    const cy = rect.top + position.y * rect.height
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1
    const startSize = t.size
    startPointerDrag((ev) => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy)
      updateText(id, { size: (startSize * d) / startDist })
    })
  }

  const visibleTexts = texts.filter((t) => !t.hidden && playhead >= t.start && playhead <= t.end)
  const hasContent = clips.length > 0 || overlays.length > 0 || audios.length > 0 || backgrounds.length > 0

  return (
    <div className="preview" ref={areaRef}>
      <div
        className="preview__frame"
        ref={frameRef}
        style={{ width: box.w, height: box.h }}
        onDoubleClick={() => { if (selClip && selClip.kind !== 'color') onOpenCrop() }}
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
          const position = positionAt(o, playhead - o.start)
          const visualStyle = resolveOverlayStyle(o)
          const shadow = visualStyle.shadowEnabled
            ? `drop-shadow(${visualStyle.shadowX * box.h}px ${visualStyle.shadowY * box.h}px ${visualStyle.shadowBlur * box.h}px ${hexToRgba(visualStyle.shadowColor, visualStyle.shadowOpacity)})`
            : 'none'
          return (
            <div
              key={o.id}
              data-layer-name={o.name}
              aria-label={`오버레이 ${o.name}`}
              ref={(el) => { if (el) wrapEls.current.set(o.id, el); else wrapEls.current.delete(o.id) }}
              className="preview__overlay"
              style={{
                left: `${position.x * 100}%`,
                top: `${position.y * 100}%`,
                width: `${o.scale * 100}%`,
                height: o.scaleY != null && !(o.aspectLocked ?? true) ? `${o.scaleY * 100}%` : undefined,
                visibility: 'hidden',
                zIndex: visualPreviewZ(visualOrder, { type: 'overlay', id: o.id }),
              }}
              onPointerDown={(e) => onOverlayDown(e, o.id)}
              onDoubleClick={(e) => { e.stopPropagation(); if (sel) onOpenCrop() }}
            >
              <div className="preview__overlay-clip" style={{ clipPath: maskClipPath(visualStyle.maskShape), filter: shadow }}>
                {o.kind === 'video' ? (
                  <video
                    ref={(el) => { if (el) overlayEls.current.set(o.id, el); else overlayEls.current.delete(o.id) }}
                    className={`preview__overlay-media${o.scaleY != null && !(o.aspectLocked ?? true) ? ' preview__overlay-media--free' : ''}`}
                    src={o.src}
                    playsInline
                  />
                ) : (
                  <img
                    ref={(el) => { if (el) overlayEls.current.set(o.id, el); else overlayEls.current.delete(o.id) }}
                    className={`preview__overlay-media${o.scaleY != null && !(o.aspectLocked ?? true) ? ' preview__overlay-media--free' : ''}`}
                    src={o.src}
                    alt=""
                  />
                )}
              </div>
              <OverlayDecoration overlay={o} frameHeight={box.h} />
            </div>
          )
        })}

        {selOverlay && selOverlayPosition && !selOverlay.hidden && overlayControlHeight > 0 && (
          <div
            className="preview__overlay-controls"
            style={{
              left: `${selOverlayPosition.x * 100}%`,
              top: `${selOverlayPosition.y * 100}%`,
              width: `${selOverlay.scale * 100}%`,
              height: selOverlay.scaleY != null && !(selOverlay.aspectLocked ?? true) ? `${selOverlay.scaleY * box.h}px` : overlayControlHeight,
              transform: `translate(-50%, -50%) rotate(${selOverlay.angle || 0}deg)`,
              zIndex: PREVIEW_Z.editor,
            }}
            onPointerDown={(event) => onOverlayDown(event, selOverlay.id)}
            onDoubleClick={(event) => { event.stopPropagation(); onOpenCrop() }}
          >
            {!selOverlay.locked && (['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const).map((handle) => (
              <span key={handle} className={`preview__resize preview__resize--${handle}`} onPointerDown={(event) => onResizeDown(event, selOverlay.id, handle)} />
            ))}
            {!selOverlay.locked && (
              <span className="preview__rotate" title="끌어서 회전" onPointerDown={onRotateDown('overlay', selOverlay.id)}><Icon name="rotate" /></span>
            )}
          </div>
        )}

        {!hasContent && (
          <div className="preview__empty">
            <span><Icon name="video" /></span>
            <p>동영상·사진을 추가해 편집을 시작하세요</p>
          </div>
        )}

        {visibleTexts.map((t) => {
          const fontPx = t.size * box.h
          const sel = selection?.type === 'text' && selection.id === t.id
          const position = positionAt(t, playhead - t.start)
          return (
            <div
              key={t.id}
              className={`preview__text${sel ? ' preview__text--selected' : ''}`}
              style={{
                left: `${position.x * 100}%`,
                top: `${position.y * 100}%`,
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
                opacity: (t.opacity ?? 1) * fadeLevel(playhead - t.start, t.end - t.start, t.fadeIn, t.fadeOut),
                zIndex: visualPreviewZ(visualOrder, { type: 'text', id: t.id }),
              }}
              onPointerDown={(e) => onTextDown(e, t.id)}
            >
              {t.text}
              {sel && !t.locked && <span className="preview__resize preview__resize--text" onPointerDown={(e) => onTextResize(e, t.id)} />}
              {sel && !t.locked && <span className="preview__rotate preview__rotate--text" title="끌어서 회전" onPointerDown={onRotateDown('text', t.id)}><Icon name="rotate" /></span>}
            </div>
          )
        })}

        {guides.x != null && <div className="preview-guide preview-guide--x" style={{ left: `${guides.x * 100}%` }} />}
        {guides.y != null && <div className="preview-guide preview-guide--y" style={{ top: `${guides.y * 100}%` }} />}
        {rotationReadout && <div className="preview__rotation-readout">{rotationReadout.angle}°</div>}

        {((selClip && selClip.kind !== 'color') || selOverlay) && !(selOverlay?.locked) && (
          <div className="preview__selection-tools" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" onClick={onOpenCrop}><Icon name="crop" />자르기</button>
          </div>
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
