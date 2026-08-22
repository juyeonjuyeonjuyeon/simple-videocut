import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import { NO_CROP, type Crop } from '../types'
import { clipStartOffsets, clipTimelineDuration, overlayLength } from '../utils/time'
import { cropForAspect, cropSize, moveCrop, resizeCrop, sanitizeCrop, zoomCrop, type CropHandle } from '../utils/crop'
import { startPointerDrag } from '../utils/pointer'
import Icon from './Icon'
import { useLanguage } from '../i18n'

interface Props {
  onClose: () => void
}

const fitBox = (width: number, height: number, ratio: number) => {
  const safeRatio = Math.max(0.05, ratio)
  let w = Math.max(0, width)
  let h = w / safeRatio
  if (h > height) {
    h = Math.max(0, height)
    w = h * safeRatio
  }
  return { width: Math.floor(w), height: Math.floor(h) }
}

const sourceAspectCache = new Map<string, number>()
const rememberSourceAspect = (src: string, aspect: number) => {
  if (!Number.isFinite(aspect) || aspect <= 0) return
  if (sourceAspectCache.size >= 100 && !sourceAspectCache.has(src)) {
    const oldest = sourceAspectCache.keys().next().value
    if (oldest) sourceAspectCache.delete(oldest)
  }
  sourceAspectCache.set(src, aspect)
}

export default function CropDialog({ onClose }: Props) {
  const { t } = useLanguage()
  const selection = useEditor((state) => state.selection)
  const clips = useEditor((state) => state.clips)
  const overlays = useEditor((state) => state.overlays)
  const playhead = useEditor((state) => state.playhead)
  const updateClip = useEditor((state) => state.updateClip)
  const updateOverlay = useEditor((state) => state.updateOverlay)

  const clip = selection?.type === 'clip' ? clips.find((item) => item.id === selection.id) : undefined
  const overlay = selection?.type === 'overlay' ? overlays.find((item) => item.id === selection.id) : undefined
  const item = clip ?? overlay
  const [draft, setDraft] = useState<Crop>(() => ({ ...(item?.crop ?? NO_CROP) }))
  const [cropAspect, setCropAspect] = useState<number | null>(null)
  const [sourceAspect, setSourceAspect] = useState<number | null>(() => item ? sourceAspectCache.get(item.src) ?? null : null)
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 })
  const workspaceRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    if (sourceAspect == null) {
      setStageBox({ width: 0, height: 0 })
      return
    }
    const measure = () => {
      const rect = workspace.getBoundingClientRect()
      setStageBox(fitBox(Math.max(0, rect.width - 40), Math.max(0, rect.height - 40), sourceAspect))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(workspace)
    measure()
    return () => observer.disconnect()
  }, [sourceAspect])

  if (!item || item.kind === 'color') return null

  const setMeasuredSourceAspect = (aspect: number) => {
    rememberSourceAspect(item.src, aspect)
    setSourceAspect(aspect)
  }

  const geometry = () => {
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
    return bounds
  }

  const handleDown = (handle: CropHandle) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.button !== 0) return
    if (sourceAspect == null) return
    const bounds = geometry()
    if (!bounds) return
    const initial = draft
    startPointerDrag((pointer) => {
      const x = Math.max(0, Math.min((pointer.clientX - bounds.left) / bounds.width, 1))
      const y = Math.max(0, Math.min((pointer.clientY - bounds.top) / bounds.height, 1))
      setDraft(resizeCrop(initial, handle, x, y, sourceAspect, cropAspect))
    })
  }

  const panDown = (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.button !== 0) return
    const bounds = geometry()
    if (!bounds) return
    const startX = event.clientX
    const startY = event.clientY
    const initial = draft
    startPointerDrag((pointer) => {
      setDraft(moveCrop(initial, (pointer.clientX - startX) / bounds.width, (pointer.clientY - startY) / bounds.height))
    })
  }

  const selectRatio = (ratio: number | null) => {
    if (sourceAspect == null) return
    setCropAspect(ratio)
    if (ratio != null) setDraft((current) => cropForAspect(current, sourceAspect, ratio))
  }

  const setZoom = (value: number) => {
    setDraft((current) => {
      const size = cropSize(current)
      const currentKept = Math.max(0.04, Math.min(size.width, size.height))
      const wantedKept = Math.max(0.1, 1 - value / 100)
      return zoomCrop(current, wantedKept / currentKept)
    })
  }

  const apply = () => {
    const crop = sanitizeCrop(draft)
    if (clip) updateClip(clip.id, { crop })
    else if (overlay) updateOverlay(overlay.id, { crop })
    onClose()
  }

  const sourceTime = (() => {
    if (clip) {
      const index = clips.findIndex((candidate) => candidate.id === clip.id)
      const offset = clipStartOffsets(clips)[index] ?? 0
      const elapsed = Math.max(0, Math.min(playhead - offset, clipTimelineDuration(clip)))
      const base = Math.max(0.001, (clip.trimEnd - clip.trimStart) / clip.speed)
      return clip.trimStart + (clip.repeat > 1 ? elapsed % base : Math.min(elapsed, base)) * clip.speed
    }
    if (overlay) {
      const elapsed = Math.max(0, Math.min(playhead - overlay.start, overlayLength(overlay)))
      const base = Math.max(0.001, (overlay.trimEnd - overlay.trimStart) / overlay.speed)
      return overlay.trimStart + (overlay.repeat > 1 ? elapsed % base : Math.min(elapsed, base)) * overlay.speed
    }
    return 0
  })()
  const size = cropSize(draft)
  const zoomValue = Math.round((1 - Math.min(size.width, size.height)) * 100)
  const ratios = [
    { label: t('원본', 'Original'), value: sourceAspect ?? 1 },
    { label: '16:9', value: 16 / 9 },
    { label: '4:3', value: 4 / 3 },
    { label: '1:1', value: 1 },
    { label: '9:16', value: 9 / 16 },
  ]

  return (
    <div className="crop-dialog" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="crop-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="crop-dialog-title">
        <header className="crop-dialog__head">
          <div>
            <h2 id="crop-dialog-title">{t('자르기', 'Crop')}</h2>
            <p>{item.name} · {t('테두리로 영역 조절, 안쪽 드래그로 위치 이동', 'Drag edges to resize the area and drag inside to reposition it')}</p>
          </div>
          <button ref={closeRef} className="iconbtn" onClick={onClose} aria-label={t('자르기 취소하고 닫기', 'Cancel crop and close')}><Icon name="close" /></button>
        </header>

        <div className="crop-dialog__workspace" ref={workspaceRef}>
          <div className="crop-dialog__stage" ref={stageRef} style={{ width: stageBox.width, height: stageBox.height }}
            onWheel={(event) => { event.preventDefault(); setZoom(Math.max(0, Math.min(90, zoomValue + (event.deltaY > 0 ? 2 : -2)))) }}>
            {item.kind === 'image' ? (
              <img src={item.src} alt={t('자르기 원본', 'Crop source')} draggable={false} onLoad={(event) => {
                const image = event.currentTarget
                if (image.naturalWidth && image.naturalHeight) setMeasuredSourceAspect(image.naturalWidth / image.naturalHeight)
              }} />
            ) : (
              <video src={item.src} muted playsInline preload="auto" onLoadedMetadata={(event) => {
                const video = event.currentTarget
                if (video.videoWidth && video.videoHeight) setMeasuredSourceAspect(video.videoWidth / video.videoHeight)
                try { video.currentTime = Math.max(0, Math.min(sourceTime, video.duration || sourceTime)) } catch { /* media may still be seeking */ }
              }} />
            )}
            <div className="cropedit__rect" style={{ left: `${draft.left * 100}%`, top: `${draft.top * 100}%`, right: `${draft.right * 100}%`, bottom: `${draft.bottom * 100}%` }} onPointerDown={panDown}>
              <span className="cropedit__grid"><i /><i /><i /><i /></span>
              {(['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const).map((handle) => (
                <span key={handle} className={`crophandle crophandle--${handle}`} onPointerDown={handleDown(handle)} />
              ))}
            </div>
          </div>
        </div>

        <div className="crop-dialog__controls">
          <div className="crop-dialog__ratios" role="group" aria-label={t('자르기 비율', 'Crop ratio')}>
            <button type="button" disabled={sourceAspect == null} className={cropAspect == null ? 'is-active' : ''} onClick={() => selectRatio(null)}>{t('자유', 'Free')}</button>
            {ratios.map((ratio) => (
              <button type="button" disabled={sourceAspect == null} key={ratio.label} className={cropAspect === ratio.value ? 'is-active' : ''} onClick={() => selectRatio(ratio.value)}>{ratio.label}</button>
            ))}
          </div>
          <label className="crop-dialog__zoom">
            <Icon name="zoomOut" />
            <span>{t('확대', 'Zoom')}</span>
            <input type="range" min="0" max="90" step="1" value={zoomValue} onChange={(event) => setZoom(Number(event.target.value))} aria-label={t('자르기 확대', 'Crop zoom')} />
            <b>{zoomValue}%</b>
            <Icon name="zoomIn" />
          </label>
          <button type="button" className="btn btn--sm" onClick={() => { setCropAspect(null); setDraft({ ...NO_CROP }) }}>{t('초기화', 'Reset')}</button>
        </div>

        <footer className="crop-dialog__actions">
          <span>{t('원본 파일은 변경되지 않습니다.', 'The original file will not be changed.')}</span>
          <button type="button" className="btn" onClick={onClose}>{t('취소', 'Cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={apply}>{t('적용', 'Apply')}</button>
        </footer>
      </section>
    </div>
  )
}
