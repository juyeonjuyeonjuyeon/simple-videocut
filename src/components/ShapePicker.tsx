import { useEffect, useRef } from 'react'
import type { ShapeKind } from '../types'
import { SHAPE_OPTIONS } from '../utils/shape'
import Icon from './Icon'
import ShapeIcon from './ShapeIcon'

export default function ShapePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (kind: ShapeKind) => void }) {
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])

  return (
    <div className="modal shape-dialog" onClick={onClose}>
      <section className="modal__panel shape-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="shape-dialog-title"
        onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 id="shape-dialog-title">도형 추가</h2>
            <p>도형을 선택하면 현재 재생 헤드에 5초 길이로 추가됩니다.</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="도형 선택 닫기"><Icon name="close" /></button>
        </div>
        <div className="shape-picker" role="list">
          {SHAPE_OPTIONS.map((option, index) => (
            <button ref={index === 0 ? firstRef : undefined} type="button" role="listitem" key={option.value}
              onClick={() => onSelect(option.value)} aria-label={`${option.label} 도형 추가`}>
              <ShapeIcon kind={option.value} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <p className="shape-dialog__hint">추가한 뒤 미리보기에서 이동·크기·회전을 조절하고 오른쪽 패널에서 색과 테두리를 바꿀 수 있습니다.</p>
      </section>
    </div>
  )
}
