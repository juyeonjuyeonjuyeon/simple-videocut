import { useEffect, useRef } from 'react'
import type { StickerKind } from '../types'
import { STICKER_OPTIONS } from '../utils/sticker'
import Icon from './Icon'
import StickerGraphic from './StickerGraphic'
import { useLanguage } from '../i18n'

export default function StickerPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (kind: StickerKind) => void }) {
  const { language, t } = useLanguage()
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])

  return (
    <div className="modal sticker-dialog" onClick={onClose}>
      <section className="modal__panel sticker-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="sticker-dialog-title"
        onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 id="sticker-dialog-title">{t('스티커 추가', 'Add sticker')}</h2>
            <p>{t('앱에 포함된 자체 제작 스티커입니다. 인터넷 없이도 미리보기와 MP4에 동일하게 적용됩니다.', 'Original stickers bundled with the app. They work offline and export exactly as previewed.')}</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label={t('스티커 선택 닫기', 'Close sticker picker')}><Icon name="close" /></button>
        </div>
        <div className="sticker-picker" role="list">
          {STICKER_OPTIONS.map((option, index) => (
            <button ref={index === 0 ? firstRef : undefined} type="button" role="listitem" key={option.value}
              onClick={() => onSelect(option.value)} aria-label={t(`${option.label} 스티커 추가`, `Add ${option.labelEn.toLowerCase()} sticker`)}>
              <StickerGraphic kind={option.value} />
              <span>{language === 'ko' ? option.label : option.labelEn}</span>
            </button>
          ))}
        </div>
        <p className="sticker-dialog__hint">{t('추가한 뒤 미리보기에서 이동·크기·회전을 조절하고, 시간 탭에서 길이와 등장을 조절할 수 있습니다.', 'After adding, adjust position, size, and rotation in the preview, then set duration and entrance in Timing.')}</p>
      </section>
    </div>
  )
}
