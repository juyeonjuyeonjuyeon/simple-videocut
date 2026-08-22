import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import type { AspectRatio, Overlay, VisualFilterSettings } from '../types'
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
import { resolveShapeStyle, shapePathData } from '../utils/shape'
import StickerGraphic from './StickerGraphic'
import { useLanguage } from '../i18n'
import { resolveMainPlacement } from '../utils/main-placement'
import BackgroundRemovedImage from './BackgroundRemovedImage'
import { colorFilterCss, colorFilterDomId, resolveVisualFilter, svgColorMatrixValues } from '../utils/color-filter'
import { resolveTwoPointerGesture, type GesturePoint } from '../utils/preview-gesture'

const RATIO: Record<AspectRatio, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1 }
const DRIFT = 0.35 // seconds before we hard-seek a media element back in sync
const SNAP_PX = 8

type PreviewTouchTarget = { type: 'clip' | 'overlay' | 'text'; id: string }
type PreviewTouchBase = {
  x: number
  y: number
  scale: number
  scaleY?: number
  angle: number
  aspectLocked: boolean
}
type PreviewTouchSession = {
  target: PreviewTouchTarget
  pointers: Map<number, GesturePoint>
  startPoints: GesturePoint[]
  base?: PreviewTouchBase
}

const sameTouchTarget = (a: PreviewTouchTarget, b: PreviewTouchTarget) => a.type === b.type && a.id === b.id
const normalizeAngle = (value: number) => {
  let angle = value
  while (angle > 180) angle -= 360
  while (angle < -180) angle += 360
  const snapped = Math.round(angle / 45) * 45
  return Math.abs(angle - snapped) <= 3 ? snapped : angle
}

function ColorFilterDefs({ items }: { items: Array<{ id: string } & VisualFilterSettings> }) {
  const filtered = items.filter((item) => {
    const resolved = resolveVisualFilter(item)
    return resolved.filterPreset !== 'none' && resolved.filterAmount > 0
  })
  if (!filtered.length) return null
  return (
    <svg className="preview__filter-defs" width="0" height="0" aria-hidden="true">
      <defs>
        {filtered.map((item) => (
          <filter key={item.id} id={colorFilterDomId(item.id)} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={svgColorMatrixValues(item)} />
          </filter>
        ))}
      </defs>
    </svg>
  )
}

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

function ShapeOverlayGraphic({ overlay, frameHeight }: { overlay: Overlay; frameHeight: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 100, height: 100 })
  const shape = resolveShapeStyle(overlay.shape)
  const style = resolveOverlayStyle(overlay)
  const borderWidth = style.borderWidth * frameHeight
  const path = shapePathData(shape.kind, size.width, size.height, borderWidth / 2 + 1, shape.cornerRadius)
  const common = { fill: hexToRgba(shape.fillColor, shape.fillOpacity), stroke: style.borderColor, strokeLinejoin: 'round' as const }

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  return (
    <svg ref={ref} className={`preview__shape${overlay.scaleY != null && !(overlay.aspectLocked ?? true) ? ' preview__shape--free' : ''}`}
      viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true"
      style={{ transform: cssTransform(overlay.rotate, overlay.flipH, overlay.flipV) }}>
      {style.borderStyle === 'double' && borderWidth >= .5 ? <>
        <path {...common} d={path} strokeWidth={Math.max(1, borderWidth / 3)} />
        <path {...common} fill="none" d={shapePathData(shape.kind, size.width, size.height, borderWidth * .85 + 1, shape.cornerRadius)} strokeWidth={Math.max(1, borderWidth / 3)} />
      </> : (
        <path {...common} d={path} strokeWidth={borderWidth}
          strokeDasharray={style.borderStyle === 'dashed' ? `${borderWidth * 3} ${borderWidth * 2}` : style.borderStyle === 'dotted' ? `0.1 ${borderWidth * 1.9}` : undefined}
          strokeLinecap={style.borderStyle === 'dotted' ? 'round' : 'butt'} />
      )}
    </svg>
  )
}

export default function Preview({ onOpenCrop, presentation = false }: { onOpenCrop: () => void; presentation?: boolean }) {
  const { t: tr } = useLanguage()
  const clips = useEditor((s) => s.clips)
  const overlays = useEditor((s) => s.overlays)
  const audios = useEditor((s) => s.audios)
  const texts = useEditor((s) => s.texts)
  const backgrounds = useEditor((s) => s.backgrounds)
  const storedVisualOrder = useEditor((s) => s.visualOrder)
  const storedSelection = useEditor((s) => s.selection)
  const selection = presentation ? null : storedSelection
  const playhead = useEditor((s) => s.playhead)
  const isPlaying = useEditor((s) => s.isPlaying)
  const aspectRatio = useEditor((s) => s.aspectRatio)
  const setPlayhead = useEditor((s) => s.setPlayhead)
  const setPlaying = useEditor((s) => s.setPlaying)
  const select = useEditor((s) => s.select)
  const updateClip = useEditor((s) => s.updateClip)
  const updateOverlay = useEditor((s) => s.updateOverlay)
  const updateLayerPosition = useEditor((s) => s.updateLayerPosition)
  const updateText = useEditor((s) => s.updateText)

  const areaRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const mainWrapRef = useRef<HTMLDivElement>(null)
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
  const [mainNaturalSize, setMainNaturalSize] = useState<{ id: string; width: number; height: number } | null>(null)
  const [overlayControlHeight, setOverlayControlHeight] = useState(0)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [rotationReadout, setRotationReadout] = useState<{ type: 'clip' | 'overlay' | 'text'; id: string; angle: number } | null>(null)
  const touchSessionRef = useRef<PreviewTouchSession | null>(null)
  const selClip = selection?.type === 'clip' ? clips.find((c) => c.id === selection.id) : null
  const selOverlayId = selection?.type === 'overlay' ? selection.id : null
  const selOverlay = selOverlayId ? overlays.find((o) => o.id === selOverlayId) : null
  const selOverlayPosition = selOverlay ? positionAt(selOverlay, playhead - selOverlay.start) : null
  const visualOrder = normalizeVisualOrder(overlays, texts, storedVisualOrder)
  const mainTotal = totalDuration(clips)
  const activeMainResult = clips.length && playhead < mainTotal - 1e-4 ? resolveTimelineTime(clips, playhead) : null
  const activeMain = activeMainResult?.clip ?? null
  const activeMainSize = activeMain && mainNaturalSize?.id === activeMain.id
    ? mainNaturalSize
    : { width: Math.max(1, box.w), height: Math.max(1, box.h) }
  const mainPlacement = activeMain && activeMain.kind !== 'color'
    ? resolveMainPlacement(activeMain, activeMainSize.width, activeMainSize.height, box.w, box.h)
    : null
  const mainCrop = activeMain?.crop
  const mainKeptWidth = Math.max(0.01, 1 - (mainCrop?.left ?? 0) - (mainCrop?.right ?? 0))
  const mainKeptHeight = Math.max(0.01, 1 - (mainCrop?.top ?? 0) - (mainCrop?.bottom ?? 0))
  const mainQuarterTurn = activeMain?.rotate === 90 || activeMain?.rotate === 270

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

  const rebaseTouchSession = () => {
    const session = touchSessionRef.current
    if (!session) return false
    const st = useEditor.getState()
    let base: PreviewTouchBase
    if (session.target.type === 'clip') {
      const item = st.clips.find((clip) => clip.id === session.target.id)
      if (!item || item.kind === 'color') return false
      const scale = item.canvasScale ?? 1
      base = {
        x: item.canvasX ?? 0.5,
        y: item.canvasY ?? 0.5,
        scale,
        scaleY: item.canvasScaleY ?? scale,
        angle: item.canvasAngle ?? 0,
        aspectLocked: item.canvasAspectLocked ?? true,
      }
    } else if (session.target.type === 'overlay') {
      const item = st.overlays.find((overlay) => overlay.id === session.target.id)
      if (!item || item.locked) return false
      const position = positionAt(item, st.playhead - item.start)
      base = {
        x: position.x,
        y: position.y,
        scale: item.scale,
        scaleY: item.scaleY ?? item.scale,
        angle: item.angle ?? 0,
        aspectLocked: item.aspectLocked ?? true,
      }
    } else {
      const item = st.texts.find((text) => text.id === session.target.id)
      if (!item || item.locked) return false
      const position = positionAt(item, st.playhead - item.start)
      base = {
        x: position.x,
        y: position.y,
        scale: item.size,
        angle: item.angle ?? 0,
        aspectLocked: true,
      }
    }
    session.startPoints = Array.from(session.pointers.values()).slice(0, 2)
    session.base = base
    return true
  }

  const beginPreviewTouch = (event: React.PointerEvent, target: PreviewTouchTarget) => {
    if (event.pointerType !== 'touch') return false
    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)
    select(target)
    let session = touchSessionRef.current
    if (!session || !sameTouchTarget(session.target, target)) {
      session = { target, pointers: new Map(), startPoints: [] }
      touchSessionRef.current = session
    }
    if (!session.pointers.has(event.pointerId) && session.pointers.size >= 2) return true
    session.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (!rebaseTouchSession()) touchSessionRef.current = null
    return true
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const session = touchSessionRef.current
      const frame = frameRef.current
      if (!session || !frame || event.pointerType !== 'touch' || !session.pointers.has(event.pointerId) || !session.base) return
      event.preventDefault()
      session.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const current = Array.from(session.pointers.values()).slice(0, 2)
      const start = session.startPoints
      if (!current.length || current.length !== start.length) return

      let deltaX = current[0].x - start[0].x
      let deltaY = current[0].y - start[0].y
      let scaleFactor = 1
      let rotation = 0
      if (current.length === 2) {
        const gesture = resolveTwoPointerGesture(start[0], start[1], current[0], current[1])
        deltaX = gesture.deltaX
        deltaY = gesture.deltaY
        scaleFactor = gesture.scale
        rotation = gesture.rotation
      }

      const rect = frame.getBoundingClientRect()
      const rawX = session.base.x + deltaX / Math.max(1, rect.width)
      const rawY = session.base.y + deltaY / Math.max(1, rect.height)
      const snapX = Math.abs(rawX - 0.5) * rect.width <= SNAP_PX
      const snapY = Math.abs(rawY - 0.5) * rect.height <= SNAP_PX
      const x = snapX ? 0.5 : rawX
      const y = snapY ? 0.5 : rawY
      setGuides({ x: snapX ? 0.5 : null, y: snapY ? 0.5 : null })
      const nextAngle = normalizeAngle(session.base.angle + rotation)
      const state = useEditor.getState()

      if (session.target.type === 'clip') {
        state.updateClip(session.target.id, {
          canvasX: x,
          canvasY: y,
          canvasScale: session.base.scale * scaleFactor,
          canvasScaleY: session.base.aspectLocked ? undefined : (session.base.scaleY ?? session.base.scale) * scaleFactor,
          canvasAngle: nextAngle,
        })
      } else if (session.target.type === 'overlay') {
        state.updateLayerPosition('overlay', session.target.id, { x, y })
        state.updateOverlay(session.target.id, {
          scale: session.base.scale * scaleFactor,
          scaleY: session.base.aspectLocked ? undefined : (session.base.scaleY ?? session.base.scale) * scaleFactor,
          angle: nextAngle,
        })
      } else {
        state.updateLayerPosition('text', session.target.id, { x, y })
        state.updateText(session.target.id, { size: session.base.scale * scaleFactor, angle: nextAngle })
      }
      setRotationReadout(current.length === 2 ? { ...session.target, angle: Math.round(nextAngle) } : null)
    }
    const finish = (event: PointerEvent) => {
      const session = touchSessionRef.current
      if (!session || event.pointerType !== 'touch' || !session.pointers.has(event.pointerId)) return
      session.pointers.delete(event.pointerId)
      if (!session.pointers.size) {
        touchSessionRef.current = null
        setGuides({ x: null, y: null })
        setRotationReadout(null)
        return
      }
      rebaseTouchSession()
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [])

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
    const wrap = mainWrapRef.current
    const v = mainVideoRef.current
    const img = mainImgRef.current
    const colorEl = mainColorRef.current
    if (!v || !img) return
    if (colorEl) colorEl.style.display = 'none'
    const mainTotal = totalDuration(cur)
    const res = cur.length && time < mainTotal - 1e-4 ? resolveTimelineTime(cur, time) : null
    if (!res) {
      if (wrap) wrap.style.visibility = 'hidden'
      v.style.display = 'none'
      img.style.display = 'none'
      if (!v.paused) v.pause()
      loadedMainId.current = null
      return
    }
    const clip = res.clip
    const localTimeline = Math.max(0, time - clipStartOffsets(cur)[res.index])
    const clipOpacity = fadeLevel(localTimeline, clipTimelineDuration(clip), clip.fadeIn, clip.fadeOut)
    if (clip.kind === 'color') {
      if (wrap) wrap.style.visibility = 'hidden'
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
    if (wrap) {
      wrap.style.visibility = 'visible'
      wrap.style.opacity = String(clipOpacity)
    }
    if (clip.kind === 'image') {
      loadedMainId.current = clip.id
      img.style.display = ''
      img.style.opacity = '1'
      v.style.display = 'none'
      if (!v.paused) v.pause()
      return
    }
    v.style.display = ''
    v.style.opacity = '1'
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
      if (clip && wrap) clip.style.clipPath = o.shape || o.sticker ? 'none' : maskClipPath(resolveOverlayStyle(o).maskShape, wrap.offsetWidth, wrap.offsetHeight)
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

  type ResizeHandle = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l'

  const mainGeometry = (id: string) => {
    const frame = frameRef.current
    const clip = useEditor.getState().clips.find((item) => item.id === id)
    if (!frame || !clip || clip.kind === 'color') return null
    const rect = frame.getBoundingClientRect()
    const video = mainVideoRef.current
    const image = mainImgRef.current
    const measured = mainNaturalSize?.id === id ? mainNaturalSize : null
    const sourceWidth = measured?.width || (clip.kind === 'video' ? video?.videoWidth : image?.naturalWidth) || rect.width
    const sourceHeight = measured?.height || (clip.kind === 'video' ? video?.videoHeight : image?.naturalHeight) || rect.height
    return { frame, clip, rect, placement: resolveMainPlacement(clip, sourceWidth, sourceHeight, rect.width, rect.height) }
  }

  // ---- move a selected main clip while keeping its point under the cursor ----
  const onMainDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'clip', id })
    setPlaying(false)
    const geometry = mainGeometry(id)
    if (!geometry) return
    const { rect, placement } = geometry
    const grabDx = e.clientX - (rect.left + placement.x)
    const grabDy = e.clientY - (rect.top + placement.y)
    const width = placement.width / rect.width
    const height = placement.height / rect.height
    startPointerDrag((ev) => {
      const rawX = (ev.clientX - grabDx - rect.left) / rect.width
      const rawY = (ev.clientY - grabDy - rect.top) / rect.height
      const snapX = snapLayerAxis(rawX, width, rect.width)
      const snapY = snapLayerAxis(rawY, height, rect.height)
      setGuides({ x: snapX.guide, y: snapY.guide })
      updateClip(id, { canvasX: snapX.center, canvasY: snapY.center })
    }, () => setGuides({ x: null, y: null }))
  }

  // ---- resize a main clip from every edge/corner, using its contained size as 100% ----
  const onMainResizeDown = (e: React.PointerEvent, id: string, handle: ResizeHandle) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: 'clip', id })
    setPlaying(false)
    const geometry = mainGeometry(id)
    if (!geometry) return
    const { clip, rect, placement } = geometry
    const centerX = rect.left + placement.x
    const centerY = rect.top + placement.y
    const width = placement.width
    const height = placement.height
    const aspect = width / Math.max(1, height)
    const movesX = handle.includes('l') || handle.includes('r')
    const movesY = handle.includes('t') || handle.includes('b')
    const signX = handle.includes('r') ? 1 : -1
    const signY = handle.includes('b') ? 1 : -1
    const radians = ((clip.canvasAngle || 0) * Math.PI) / 180
    const ux = Math.cos(radians), uy = Math.sin(radians)
    const vx = -Math.sin(radians), vy = Math.cos(radians)
    const anchorX = centerX - (movesX ? signX * ux * width / 2 : 0) - (movesY ? signY * vx * height / 2 : 0)
    const anchorY = centerY - (movesX ? signX * uy * width / 2 : 0) - (movesY ? signY * vy * height / 2 : 0)
    const minWidth = placement.baseWidth * 0.05
    const maxWidth = placement.baseWidth * 3
    const minHeight = placement.baseHeight * 0.05
    const maxHeight = placement.baseHeight * 3
    const aspectLocked = clip.canvasAspectLocked ?? true

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
      updateClip(id, {
        canvasX: (nextCenterX - rect.left) / rect.width,
        canvasY: (nextCenterY - rect.top) / rect.height,
        canvasScale: nextWidth / placement.baseWidth,
        canvasScaleY: aspectLocked ? undefined : nextHeight / placement.baseHeight,
      })
    })
  }

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

  // ---- drag the rotation handle to spin a main clip, overlay, or text freely ----
  const onRotateDown = (kind: 'clip' | 'overlay' | 'text', id: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ type: kind, id })
    setPlaying(false)
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    let position: { x: number; y: number }
    let currentAngle: number
    if (kind === 'clip') {
      const item = useEditor.getState().clips.find((clip) => clip.id === id)
      if (!item) return
      position = { x: item.canvasX ?? 0.5, y: item.canvasY ?? 0.5 }
      currentAngle = item.canvasAngle || 0
    } else if (kind === 'overlay') {
      const item = useEditor.getState().overlays.find((overlay) => overlay.id === id)
      if (!item) return
      position = positionAt(item, useEditor.getState().playhead - item.start)
      currentAngle = item.angle || 0
    } else {
      const item = useEditor.getState().texts.find((text) => text.id === id)
      if (!item) return
      position = positionAt(item, useEditor.getState().playhead - item.start)
      currentAngle = item.angle || 0
    }
    const cx = rect.left + position.x * rect.width
    const cy = rect.top + position.y * rect.height
    const base = currentAngle - (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
    setRotationReadout({ type: kind, id, angle: currentAngle })
    startPointerDrag((ev) => {
      let deg = base + (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI
      deg = Math.round(((deg + 540) % 360) - 180) // normalize to -180..180
      const snapped = Math.round(deg / 45) * 45
      if (!ev.shiftKey && Math.abs(deg - snapped) <= 3) deg = snapped
      setRotationReadout({ type: kind, id, angle: deg })
      if (kind === 'clip') updateClip(id, { canvasAngle: deg })
      else if (kind === 'overlay') updateOverlay(id, { angle: deg })
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
    <div className={`preview${presentation ? ' preview--presentation' : ''}`} ref={areaRef}
      aria-label={presentation ? tr('완제품 미리보기 화면', 'Final preview canvas') : undefined}>
      <div
        className="preview__frame"
        ref={frameRef}
        style={{ width: box.w, height: box.h }}
        onDoubleClick={() => { if (selClip && selClip.kind !== 'color') onOpenCrop() }}
      >
        <ColorFilterDefs items={[...clips, ...backgrounds, ...overlays]} />
        {backgrounds.map((b) => (
          <div
            key={b.id}
            ref={(el) => { if (el) bgWrapEls.current.set(b.id, el); else bgWrapEls.current.delete(b.id) }}
            className="preview__bg"
            style={{ visibility: 'hidden', filter: colorFilterCss(b.id, b) }}
          >
            {b.kind === 'video' && (
              <video ref={(el) => { if (el) bgMediaEls.current.set(b.id, el); else bgMediaEls.current.delete(b.id) }}
                className="preview__bg-media" src={b.src} playsInline />
            )}
            {b.kind === 'image' && (
              <BackgroundRemovedImage source={b} ref={(el) => { if (el) bgMediaEls.current.set(b.id, el); else bgMediaEls.current.delete(b.id) }}
                className="preview__bg-media" alt="" />
            )}
          </div>
        ))}
        <div
          ref={mainWrapRef}
          className="preview__main"
          data-main-clip={activeMain?.id}
          style={mainPlacement ? {
            left: mainPlacement.x,
            top: mainPlacement.y,
            width: mainPlacement.width,
            height: mainPlacement.height,
            transform: `translate(-50%, -50%) rotate(${mainPlacement.angle}deg)`,
          } : undefined}
          onPointerDown={(event) => {
            if (activeMain && activeMain.kind !== 'color' && !beginPreviewTouch(event, { type: 'clip', id: activeMain.id })) onMainDown(event, activeMain.id)
          }}
          onDoubleClick={(event) => { event.stopPropagation(); if (activeMain && activeMain.kind !== 'color') onOpenCrop() }}
        >
          <div className="preview__main-clip">
            <div className="preview__main-orient" style={mainPlacement && activeMain ? {
              width: mainQuarterTurn ? mainPlacement.height : mainPlacement.width,
              height: mainQuarterTurn ? mainPlacement.width : mainPlacement.height,
              transform: `translate(-50%, -50%) ${cssTransform(activeMain.rotate, activeMain.flipH, activeMain.flipV)}`,
            } : undefined}>
              <video
                ref={mainVideoRef}
                className="preview__main-media"
                style={{
                  left: `${-((mainCrop?.left ?? 0) / mainKeptWidth) * 100}%`,
                  top: `${-((mainCrop?.top ?? 0) / mainKeptHeight) * 100}%`,
                  width: `${100 / mainKeptWidth}%`,
                  height: `${100 / mainKeptHeight}%`,
                  filter: activeMain ? colorFilterCss(activeMain.id, activeMain) : 'none',
                }}
                playsInline
                onLoadedMetadata={(event) => {
                  if (activeMain?.kind === 'video') setMainNaturalSize({ id: activeMain.id, width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })
                }}
              />
              <BackgroundRemovedImage source={activeMain?.kind === 'image' ? activeMain : null} ref={mainImgRef} className="preview__main-media" alt="" style={{
                display: 'none',
                left: `${-((mainCrop?.left ?? 0) / mainKeptWidth) * 100}%`,
                top: `${-((mainCrop?.top ?? 0) / mainKeptHeight) * 100}%`,
                width: `${100 / mainKeptWidth}%`,
                height: `${100 / mainKeptHeight}%`,
                filter: activeMain ? colorFilterCss(activeMain.id, activeMain) : 'none',
              }} onLoad={(event) => {
                if (activeMain?.kind === 'image') setMainNaturalSize({ id: activeMain.id, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              }} />
            </div>
          </div>
        </div>
        <div ref={mainColorRef} className="preview__main-color" style={{ display: 'none' }} />

        {overlays.map((o) => {
          const sel = selection?.type === 'overlay' && selection.id === o.id
          const position = positionAt(o, playhead - o.start)
          const visualStyle = resolveOverlayStyle(o)
          const shadow = visualStyle.shadowEnabled
            ? `drop-shadow(${visualStyle.shadowX * box.h}px ${visualStyle.shadowY * box.h}px ${visualStyle.shadowBlur * box.h}px ${hexToRgba(visualStyle.shadowColor, visualStyle.shadowOpacity)})`
            : 'none'
          const colorFilter = colorFilterCss(o.id, o)
          const combinedFilter = [colorFilter, shadow].filter((value) => value !== 'none').join(' ') || 'none'
          return (
            <div
              key={o.id}
              data-layer-name={o.name}
              aria-label={tr(`오버레이 ${o.name}`, `Overlay ${o.name}`)}
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
              onPointerDown={(event) => {
                if (!beginPreviewTouch(event, { type: 'overlay', id: o.id })) onOverlayDown(event, o.id)
              }}
              onDoubleClick={(e) => { e.stopPropagation(); if (sel && !o.shape && !o.sticker) onOpenCrop() }}
            >
              <div className="preview__overlay-clip" style={{ clipPath: o.shape || o.sticker ? 'none' : maskClipPath(visualStyle.maskShape), filter: combinedFilter }}>
                {o.shape ? (
                  <ShapeOverlayGraphic overlay={o} frameHeight={box.h} />
                ) : o.sticker ? (
                  <StickerGraphic kind={o.sticker.kind} className="preview__sticker" style={{ transform: cssTransform(o.rotate, o.flipH, o.flipV) }} />
                ) : o.kind === 'video' ? (
                  <video
                    ref={(el) => { if (el) overlayEls.current.set(o.id, el); else overlayEls.current.delete(o.id) }}
                    className={`preview__overlay-media${o.scaleY != null && !(o.aspectLocked ?? true) ? ' preview__overlay-media--free' : ''}`}
                    src={o.src}
                    playsInline
                  />
                ) : (
                  <BackgroundRemovedImage
                    source={o}
                    ref={(el) => { if (el) overlayEls.current.set(o.id, el); else overlayEls.current.delete(o.id) }}
                    className={`preview__overlay-media${o.scaleY != null && !(o.aspectLocked ?? true) ? ' preview__overlay-media--free' : ''}`}
                    alt=""
                  />
                )}
              </div>
              {!o.shape && !o.sticker && <OverlayDecoration overlay={o} frameHeight={box.h} />}
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
            onPointerDown={(event) => {
              if (!beginPreviewTouch(event, { type: 'overlay', id: selOverlay.id })) onOverlayDown(event, selOverlay.id)
            }}
            onDoubleClick={(event) => { event.stopPropagation(); if (!selOverlay.shape && !selOverlay.sticker) onOpenCrop() }}
          >
            {!selOverlay.locked && (['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const).map((handle) => (
              <span key={handle} className={`preview__resize preview__resize--${handle}`} onPointerDown={(event) => onResizeDown(event, selOverlay.id, handle)} />
            ))}
            {!selOverlay.locked && (
              <span className="preview__rotate" title={tr('끌어서 회전', 'Drag to rotate')} onPointerDown={onRotateDown('overlay', selOverlay.id)}><Icon name="rotate" /></span>
            )}
          </div>
        )}

        {selClip && activeMain?.id === selClip.id && mainPlacement && (
          <div
            className="preview__overlay-controls preview__main-controls"
            style={{
              left: mainPlacement.x,
              top: mainPlacement.y,
              width: mainPlacement.width,
              height: mainPlacement.height,
              transform: `translate(-50%, -50%) rotate(${mainPlacement.angle}deg)`,
              zIndex: PREVIEW_Z.editor,
            }}
            onPointerDown={(event) => {
              if (!beginPreviewTouch(event, { type: 'clip', id: selClip.id })) onMainDown(event, selClip.id)
            }}
            onDoubleClick={(event) => { event.stopPropagation(); onOpenCrop() }}
          >
            {(['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const).map((handle) => (
              <span key={handle} className={`preview__resize preview__resize--${handle}`} onPointerDown={(event) => onMainResizeDown(event, selClip.id, handle)} />
            ))}
            <span className="preview__rotate" title={tr('끌어서 회전', 'Drag to rotate')} onPointerDown={onRotateDown('clip', selClip.id)}><Icon name="rotate" /></span>
          </div>
        )}

        {!hasContent && (
          <div className="preview__empty">
            <span><Icon name="video" /></span>
            <p>{tr('동영상·사진을 추가해 편집을 시작하세요', 'Add a video or photo to start editing')}</p>
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
              onPointerDown={(event) => {
                if (!beginPreviewTouch(event, { type: 'text', id: t.id })) onTextDown(event, t.id)
              }}
            >
              {t.text}
              {sel && !t.locked && <span className="preview__resize preview__resize--text" onPointerDown={(e) => onTextResize(e, t.id)} />}
              {sel && !t.locked && <span className="preview__rotate preview__rotate--text" title={tr('끌어서 회전', 'Drag to rotate')} onPointerDown={onRotateDown('text', t.id)}><Icon name="rotate" /></span>}
            </div>
          )
        })}

        {guides.x != null && <div className="preview-guide preview-guide--x" style={{ left: `${guides.x * 100}%` }} />}
        {guides.y != null && <div className="preview-guide preview-guide--y" style={{ top: `${guides.y * 100}%` }} />}
        {rotationReadout && <div className="preview__rotation-readout">{rotationReadout.angle}°</div>}

        {((selClip && selClip.kind !== 'color') || (selOverlay && !selOverlay.shape && !selOverlay.sticker)) && !(selOverlay?.locked) && (
          <div className="preview__selection-tools" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" onClick={onOpenCrop}><Icon name="crop" />{tr('자르기', 'Crop')}</button>
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
