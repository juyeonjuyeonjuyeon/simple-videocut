import { useEffect, useRef, type CSSProperties } from 'react'
import type { MosaicRegion } from '../types'

interface Props {
  regions?: MosaicRegion[]
  getSource: () => HTMLImageElement | HTMLVideoElement | undefined | null
  style?: CSSProperties
}

const sourceSize = (source: HTMLImageElement | HTMLVideoElement) => source instanceof HTMLVideoElement
  ? { width: source.videoWidth, height: source.videoHeight }
  : { width: source.naturalWidth, height: source.naturalHeight }

export default function MosaicLayer({ regions = [], getSource, style }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const getSourceRef = useRef(getSource)
  getSourceRef.current = getSource

  useEffect(() => {
    if (!regions.length) return
    let frame = 0
    let lastSignature = ''
    const draw = () => {
      const root = rootRef.current
      const source = getSourceRef.current()
      const size = source ? sourceSize(source) : { width: 0, height: 0 }
      if (root && source && size.width > 0 && size.height > 0) {
        const frameHeight = root.closest('.preview__frame')?.clientHeight || root.clientHeight || 1
        const mediaTime = source instanceof HTMLVideoElement ? source.currentTime : 0
        const signature = `${root.clientWidth}:${root.clientHeight}:${mediaTime.toFixed(3)}:${regions.map((region) => `${region.id}:${region.x}:${region.y}:${region.width}:${region.height}:${region.pixelSize}`).join('|')}`
        if (signature !== lastSignature) {
          lastSignature = signature
          const canvases = root.querySelectorAll<HTMLCanvasElement>('canvas[data-mosaic-region]')
          canvases.forEach((canvas, index) => {
            const region = regions[index]
            if (!region) return
            const cssWidth = Math.max(1, root.clientWidth * region.width)
            const cssHeight = Math.max(1, root.clientHeight * region.height)
            const block = Math.max(1, region.pixelSize / 720 * frameHeight)
            canvas.width = Math.max(1, Math.round(cssWidth / block))
            canvas.height = Math.max(1, Math.round(cssHeight / block))
            const context = canvas.getContext('2d')
            if (!context) return
            context.imageSmoothingEnabled = true
            context.clearRect(0, 0, canvas.width, canvas.height)
            context.drawImage(
              source,
              region.x * size.width,
              region.y * size.height,
              region.width * size.width,
              region.height * size.height,
              0,
              0,
              canvas.width,
              canvas.height,
            )
          })
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [regions])

  if (!regions.length) return null
  return (
    <div ref={rootRef} className="preview__mosaic-layer" style={style} aria-hidden="true">
      {regions.map((region) => (
        <canvas key={region.id} data-mosaic-region={region.id} style={{
          left: `${region.x * 100}%`, top: `${region.y * 100}%`,
          width: `${region.width * 100}%`, height: `${region.height * 100}%`,
        }} />
      ))}
    </div>
  )
}
