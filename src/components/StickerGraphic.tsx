import type { CSSProperties } from 'react'
import type { StickerKind } from '../types'
import { stickerLayers } from '../utils/sticker'

export default function StickerGraphic({ kind, className = '', style }: { kind: StickerKind; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`sticker-graphic ${className}`.trim()} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={style}>
      {stickerLayers(kind).map((layer, index) => (
        <path key={index} d={layer.path} fill={layer.fill ?? 'none'} stroke={layer.stroke}
          strokeWidth={layer.strokeWidth} strokeLinecap={layer.lineCap} strokeLinejoin={layer.lineJoin} />
      ))}
    </svg>
  )
}
