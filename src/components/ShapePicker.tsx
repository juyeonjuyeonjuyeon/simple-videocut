import { useEffect, useRef } from 'react'
import type { ShapeKind } from '../types'
import { SHAPE_OPTIONS } from '../utils/shape'
import Icon from './Icon'
import ShapeIcon from './ShapeIcon'
import { useLanguage } from '../i18n'

export default function ShapePicker({ onClose, onSelect }: { onClose: () => void; onSelect: (kind: ShapeKind) => void }) {
  const { language, t } = useLanguage()
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])

  return (
    <div className="modal shape-dialog" onClick={onClose}>
      <section className="modal__panel shape-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="shape-dialog-title"
        onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 id="shape-dialog-title">{t('도형 추가', 'Add shape')}</h2>
            <p>{t('도형을 선택하면 현재 재생 헤드에 5초 길이로 추가됩니다.', 'Choose a shape to add it at the playhead with a 5-second duration.')}</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label={t('도형 선택 닫기', 'Close shape picker')}><Icon name="close" /></button>
        </div>
        <div className="shape-picker" role="list">
          {SHAPE_OPTIONS.map((option, index) => (
            <button ref={index === 0 ? firstRef : undefined} type="button" role="listitem" key={option.value}
              onClick={() => onSelect(option.value)} aria-label={t(`${option.label} 도형 추가`, `Add ${option.labelEn.toLowerCase()} shape`)}>
              <ShapeIcon kind={option.value} />
              <span>{language === 'ko' ? option.label : option.labelEn}</span>
            </button>
          ))}
        </div>
        <p className="shape-dialog__hint">{t('추가한 뒤 미리보기에서 이동·크기·회전을 조절하고 오른쪽 패널에서 색과 테두리를 바꿀 수 있습니다.', 'After adding it, move, resize, and rotate it in the preview. Change its fill and border in the right panel.')}</p>
      </section>
    </div>
  )
}
