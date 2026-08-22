import { useEffect, useRef } from 'react'
import Icon from './Icon'
import { useLanguage } from '../i18n'

interface Props {
  onClose: () => void
}

const shortcuts = [
  ['Space', '재생·일시정지', 'Play / pause'],
  ['S', '재생 헤드에서 분할', 'Split at playhead'],
  ['M', '현재 위치에 마커 추가', 'Add marker at current time'],
  ['← / →', '0.1초 이동', 'Move 0.1 seconds'],
  ['⌥ + ← / →', '한 프레임 이동', 'Move one frame'],
  ['⇧ + ← / →', '1초 이동', 'Move one second'],
  ['Home / End', '처음·끝으로 이동', 'Go to start / end'],
  ['⌘/Ctrl + D', '선택 항목 복제', 'Duplicate selection'],
  ['⌘/Ctrl + G', '여러 선택 항목 그룹 만들기', 'Group selected items'],
  ['⇧ + ⌘/Ctrl + G', '선택 그룹 해제', 'Ungroup selection'],
  ['Delete', '선택 항목 삭제', 'Delete selection'],
  ['⌘/Ctrl + Z', '실행 취소', 'Undo'],
  ['⇧ + ⌘/Ctrl + Z', '다시 실행', 'Redo'],
  ['⌘/Ctrl + S', '현재 프로젝트 저장', 'Save current project'],
  ['⇧ + ⌘/Ctrl + S', '다른 이름으로 저장', 'Save as'],
  ['?', '도움말 열기', 'Open help'],
  ['Esc', '열린 창 닫기', 'Close open dialog'],
]

export default function HelpDialog({ onClose }: Props) {
  const { language, t } = useLanguage()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  return (
    <div className="modal help-dialog" onClick={onClose}>
      <section className="modal__panel help-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 id="help-title">{t('사용 도움말', 'Help')}</h2>
            <p className="help-dialog__lead">{t('자주 쓰는 편집 동작을 한곳에서 확인할 수 있습니다.', 'Quick reference for common editing actions.')}</p>
          </div>
          <button ref={closeRef} className="iconbtn" onClick={onClose} aria-label={t('도움말 닫기', 'Close help')}><Icon name="close" /></button>
        </div>

        <div className="help-dialog__grid">
          <section className="help-card">
            <h3>{t('마우스·트랙패드', 'Mouse and trackpad')}</h3>
            <ul>
              <li>{t('클립을 드래그하면 시간 또는 트랙 위치를 옮깁니다.', 'Drag a clip to change its time or track position.')}</li>
              <li>{t('클립 양끝 손잡이를 드래그하면 길이를 조절합니다.', 'Drag either end handle to adjust duration.')}</li>
              <li>{t('우클릭하면 이동·길이 맞춤·그룹·삭제 메뉴가 열립니다.', 'Right-click for move, fit, group, and delete actions.')}</li>
              <li>{t('‘도형’에서 사각형·원·별 등을 추가하고 오른쪽 스타일 패널에서 색·테두리·그림자를 바꿉니다.', 'Add rectangles, circles, stars, and more from Shape, then edit fill, border, and shadow in the right panel.')}</li>
              <li>{t('⌘/Ctrl을 누른 채 클릭하면 여러 항목을 선택합니다.', 'Hold ⌘/Ctrl while clicking to select multiple items.')}</li>
              <li>{t('타임라인에서 두 손가락 스크롤은 상하·좌우로 이동하고, 핀치 또는 Ctrl/⌘+스크롤은 확대·축소합니다.', 'Two-finger scrolling moves through the timeline; pinch or Ctrl/Cmd+scroll zooms it.')}</li>
              <li>{t('Finder·사진 앱·음성 메모의 파일을 편집기 화면에 끌어 놓아 바로 추가합니다.', 'Drag files from Finder, Photos, or Voice Memos directly into the editor.')}</li>
            </ul>
          </section>

          <section className="help-card">
            <h3>{t('아이폰·아이패드', 'iPhone and iPad')}</h3>
            <ul>
              <li>{t('타임라인의 ‘여러 항목’ 버튼을 켜고 항목을 차례로 눌러 함께 선택합니다.', 'Turn on Multi-select in the timeline, then tap items to select them together.')}</li>
              <li>{t('클립을 길게 누르면 우클릭과 같은 편집 메뉴가 열립니다.', 'Touch and hold a clip to open the same menu as right-click.')}</li>
              <li>{t('선택한 영상·이미지는 미리보기의 손잡이로 크기와 회전을 조절합니다.', 'Use preview handles to resize and rotate selected video or images.')}</li>
              <li>{t('도형도 영상·이미지처럼 한 손가락으로 이동하고 손잡이로 크기를 바꿀 수 있습니다.', 'Move shapes with one finger and resize them with the handles.')}</li>
              <li>{t('사진 앱·음성 메모·파일 앱에서 항목을 길게 잡은 채 앱을 전환해 편집기 화면에 놓을 수 있습니다.', 'Hold an item in Photos, Voice Memos, or Files, switch apps, and drop it in the editor.')}</li>
              <li>{t('가져오기 버튼으로 넣은 파일은 왼쪽 보관함에서 메인 또는 레이어에 추가합니다.', 'Files imported with the button appear in the left media bin for adding to the main track or a layer.')}</li>
            </ul>
          </section>
        </div>

        <section className="help-shortcuts" aria-labelledby="shortcut-title">
          <h3 id="shortcut-title">{t('키보드 단축키', 'Keyboard shortcuts')}</h3>
          <div className="help-shortcuts__list">
            {shortcuts.map(([keys, ko, en]) => (
              <div className="help-shortcuts__row" key={keys}>
                <kbd>{keys}</kbd>
                <span>{language === 'ko' ? ko : en}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  )
}
