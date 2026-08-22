import type { ShapeKind } from '../types'
import { shapePathData } from '../utils/shape'

export default function ShapeIcon({ kind, className = '' }: { kind: ShapeKind; className?: string }) {
  return (
    <svg className={`shape-icon ${className}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={shapePathData(kind, 100, 100, 7, .16)} />
    </svg>
  )
}
