import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEditor } from '../store'
import type { MosaicRegion } from '../types'
import { clipStartOffsets, clipTimelineDuration, overlayLength } from '../utils/time'
import { DEFAULT_MOSAIC_REGION, moveMosaicRegion, resizeMosaicRegion, sanitizeMosaicRegions, type MosaicHandle } from '../utils/mosaic'
import { startPointerDrag } from '../utils/pointer'
import Icon from './Icon'
import { useLanguage } from '../i18n'
import MosaicLayer from './MosaicLayer'

const fitBox = (width: number, height: number, ratio: number) => {
  let w = Math.max(0, width)
  let h = w / Math.max(0.05, ratio)
  if (h > height) { h = Math.max(0, height); w = h * ratio }
  return { width: Math.floor(w), height: Math.floor(h) }
}

export default function MosaicDialog({ onClose }: { onClose: () => void }) {
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
  const initial = sanitizeMosaicRegions(item?.mosaicRegions)
  const [regions, setRegions] = useState<MosaicRegion[]>(() => initial.length ? initial : [{ ...DEFAULT_MOSAIC_REGION, id: crypto.randomUUID() }])
  const [selectedId, setSelectedId] = useState(() => regions[0]?.id ?? '')
  const [sourceAspect, setSourceAspect] = useState<number | null>(null)
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 })
  const workspaceRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const selected = regions.find((region) => region.id === selectedId) ?? regions[0]

  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose])
  useLayoutEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || sourceAspect == null) return
    const measure = () => {
      const rect = workspace.getBoundingClientRect()
      setStageBox(fitBox(Math.max(0, rect.width - 40), Math.max(0, rect.height - 40), sourceAspect))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(workspace)
    measure()
    return () => observer.disconnect()
  }, [sourceAspect])

  if (!item || item.kind === 'color' || ('shape' in item && (item.shape || item.sticker))) return null

  const sourceTime = (() => {
    if (clip) {
      const index = clips.findIndex((candidate) => candidate.id === clip.id)
      const elapsed = Math.max(0, Math.min(playhead - (clipStartOffsets(clips)[index] ?? 0), clipTimelineDuration(clip)))
      const base = Math.max(0.001, (clip.trimEnd - clip.trimStart) / clip.speed)
      return clip.trimStart + (clip.repeat > 1 ? elapsed % base : Math.min(elapsed, base)) * clip.speed
    }
    const elapsed = Math.max(0, Math.min(playhead - overlay!.start, overlayLength(overlay!)))
    const base = Math.max(0.001, (overlay!.trimEnd - overlay!.trimStart) / overlay!.speed)
    return overlay!.trimStart + (overlay!.repeat > 1 ? elapsed % base : Math.min(elapsed, base)) * overlay!.speed
  })()

  const updateSelected = (patch: Partial<MosaicRegion>) => {
    setRegions((current) => sanitizeMosaicRegions(current.map((region) => region.id === selectedId ? { ...region, ...patch } : region)))
  }
  const bounds = () => stageRef.current?.getBoundingClientRect()
  const panDown = (event: React.PointerEvent, region: MosaicRegion) => {
    event.preventDefault(); event.stopPropagation(); setSelectedId(region.id)
    if (event.button !== 0) return
    const box = bounds(); if (!box) return
    const startX = event.clientX; const startY = event.clientY
    startPointerDrag((pointer) => {
      const next = moveMosaicRegion(region, (pointer.clientX - startX) / box.width, (pointer.clientY - startY) / box.height)
      setRegions((current) => current.map((candidate) => candidate.id === region.id ? next : candidate))
    }, undefined, event.pointerId)
  }
  const handleDown = (handle: MosaicHandle, region: MosaicRegion) => (event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation(); setSelectedId(region.id)
    if (event.button !== 0) return
    const box = bounds(); if (!box) return
    startPointerDrag((pointer) => {
      const x = Math.max(0, Math.min(1, (pointer.clientX - box.left) / box.width))
      const y = Math.max(0, Math.min(1, (pointer.clientY - box.top) / box.height))
      const next = resizeMosaicRegion(region, handle, x, y)
      setRegions((current) => current.map((candidate) => candidate.id === region.id ? next : candidate))
    }, undefined, event.pointerId)
  }
  const addRegion = () => {
    if (regions.length >= 12) return
    const offset = Math.min(0.45, 0.18 + regions.length * 0.04)
    const next = { ...DEFAULT_MOSAIC_REGION, id: crypto.randomUUID(), x: offset, y: offset }
    setRegions((current) => [...current, next])
    setSelectedId(next.id)
  }
  const removeRegion = () => {
    const next = regions.filter((region) => region.id !== selectedId)
    setRegions(next)
    setSelectedId(next[0]?.id ?? '')
  }
  const apply = () => {
    const mosaicRegions = sanitizeMosaicRegions(regions)
    if (clip) updateClip(clip.id, { mosaicRegions })
    else updateOverlay(overlay!.id, { mosaicRegions })
    onClose()
  }

  return (
    <div className="crop-dialog mosaic-dialog" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="crop-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="mosaic-dialog-title">
        <header className="crop-dialog__head">
          <div><h2 id="mosaic-dialog-title">{t('영역 모자이크', 'Area mosaic')}</h2><p>{item.name} · {t('가릴 부분을 옮기거나 테두리를 끌어 크기를 조절하세요', 'Move the area or drag its edges to resize it')}</p></div>
          <button ref={closeRef} className="iconbtn" onClick={onClose} aria-label={t('모자이크 취소하고 닫기', 'Cancel mosaic and close')}><Icon name="close" /></button>
        </header>
        <div className="crop-dialog__workspace" ref={workspaceRef}>
          <div className="crop-dialog__stage mosaic-dialog__stage" ref={stageRef} style={{ width: stageBox.width, height: stageBox.height }}>
            {item.kind === 'image' ? <img ref={imageRef} src={item.src} alt={t('모자이크 원본', 'Mosaic source')} draggable={false} onLoad={(event) => {
              const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setSourceAspect(image.naturalWidth / image.naturalHeight)
            }} /> : <video ref={videoRef} src={item.src} muted playsInline preload="auto" onLoadedMetadata={(event) => {
              const video = event.currentTarget; if (video.videoWidth && video.videoHeight) setSourceAspect(video.videoWidth / video.videoHeight)
              try { video.currentTime = Math.min(sourceTime, video.duration || sourceTime) } catch { /* ignore */ }
            }} />}
            <MosaicLayer regions={regions} getSource={() => item.kind === 'video' ? videoRef.current : imageRef.current} />
            {regions.map((region, index) => <div key={region.id} className={`mosaicedit__rect${region.id === selectedId ? ' is-selected' : ''}`}
              style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
              onPointerDown={(event) => panDown(event, region)}>
              <span>{t(`영역 ${index + 1}`, `Area ${index + 1}`)}</span>
              {region.id === selectedId && (['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'] as const).map((handle) => <i key={handle} className={`crophandle crophandle--${handle}`} onPointerDown={handleDown(handle, region)} />)}
            </div>)}
          </div>
        </div>
        <div className="crop-dialog__controls mosaic-dialog__controls">
          <div className="mosaic-dialog__areas" role="tablist" aria-label={t('모자이크 영역', 'Mosaic areas')}>
            {regions.map((region, index) => <button key={region.id} type="button" role="tab" aria-selected={region.id === selectedId} className={region.id === selectedId ? 'is-active' : ''} onClick={() => setSelectedId(region.id)}>{t(`영역 ${index + 1}`, `Area ${index + 1}`)}</button>)}
            <button type="button" onClick={addRegion} disabled={regions.length >= 12}><Icon name="plus" />{t('영역 추가', 'Add area')}</button>
          </div>
          {selected && <label className="crop-dialog__zoom"><Icon name="mosaic" /><span>{t('모자이크 크기', 'Pixel size')}</span><input type="range" min="4" max="80" step="1" value={selected.pixelSize} onChange={(event) => updateSelected({ pixelSize: Number(event.target.value) })} /><b>{selected.pixelSize}px</b></label>}
          <button type="button" className="btn btn--sm btn--danger" disabled={!selected} onClick={removeRegion}>{t('선택 영역 삭제', 'Delete selected area')}</button>
        </div>
        <footer className="crop-dialog__actions"><span>{t('여러 영역을 추가할 수 있으며 원본 파일은 변경되지 않습니다.', 'You can add multiple areas without changing the source file.')}</span><button type="button" className="btn" onClick={onClose}>{t('취소', 'Cancel')}</button><button type="button" className="btn btn--primary" onClick={apply}>{t('적용', 'Apply')}</button></footer>
      </section>
    </div>
  )
}
