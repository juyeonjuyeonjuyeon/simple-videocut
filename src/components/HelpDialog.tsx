import { useEffect, useRef } from 'react'
import Icon from './Icon'

interface Props {
  onClose: () => void
}

const shortcuts = [
  ['Space', '재생·일시정지'],
  ['S', '재생 헤드에서 분할'],
  ['M', '현재 위치에 마커 추가'],
  ['← / →', '0.1초 이동'],
  ['⌥ + ← / →', '한 프레임 이동'],
  ['⇧ + ← / →', '1초 이동'],
  ['Home / End', '처음·끝으로 이동'],
  ['⌘/Ctrl + D', '선택 항목 복제'],
  ['⌘/Ctrl + G', '여러 선택 항목 그룹 만들기'],
  ['⇧ + ⌘/Ctrl + G', '선택 그룹 해제'],
  ['Delete', '선택 항목 삭제'],
  ['⌘/Ctrl + Z', '실행 취소'],
  ['⇧ + ⌘/Ctrl + Z', '다시 실행'],
  ['⌘/Ctrl + S', '현재 프로젝트 저장'],
  ['⇧ + ⌘/Ctrl + S', '다른 이름으로 저장'],
  ['?', '도움말 열기'],
  ['Esc', '열린 창 닫기'],
]

export default function HelpDialog({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  return (
    <div className="modal help-dialog" onClick={onClose}>
      <section className="modal__panel help-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 id="help-title">사용 도움말</h2>
            <p className="help-dialog__lead">자주 쓰는 편집 동작을 한곳에서 확인할 수 있습니다.</p>
          </div>
          <button ref={closeRef} className="iconbtn" onClick={onClose} aria-label="도움말 닫기"><Icon name="close" /></button>
        </div>

        <div className="help-dialog__grid">
          <section className="help-card">
            <h3>마우스·트랙패드</h3>
            <ul>
              <li>클립을 드래그하면 시간 또는 트랙 위치를 옮깁니다.</li>
              <li>클립 양끝 손잡이를 드래그하면 길이를 조절합니다.</li>
              <li>우클릭하면 이동·길이 맞춤·그룹·삭제 메뉴가 열립니다.</li>
              <li>⌘/Ctrl을 누른 채 클릭하면 여러 항목을 선택합니다.</li>
              <li>타임라인 스크롤은 확대·축소, Shift+스크롤은 좌우 이동입니다.</li>
              <li>Finder·사진 앱·음성 메모의 파일을 편집기 화면에 끌어 놓아 바로 추가합니다.</li>
            </ul>
          </section>

          <section className="help-card">
            <h3>아이폰·아이패드</h3>
            <ul>
              <li>타임라인의 ‘여러 항목’ 버튼을 켜고 항목을 차례로 눌러 함께 선택합니다.</li>
              <li>클립을 길게 누르면 우클릭과 같은 편집 메뉴가 열립니다.</li>
              <li>선택한 영상·이미지는 미리보기의 손잡이로 크기와 회전을 조절합니다.</li>
              <li>사진 앱·음성 메모·파일 앱에서 항목을 길게 잡은 채 앱을 전환해 편집기 화면에 놓을 수 있습니다.</li>
              <li>가져오기 버튼으로 넣은 파일은 왼쪽 보관함에서 메인 또는 레이어에 추가합니다.</li>
            </ul>
          </section>
        </div>

        <section className="help-shortcuts" aria-labelledby="shortcut-title">
          <h3 id="shortcut-title">키보드 단축키</h3>
          <div className="help-shortcuts__list">
            {shortcuts.map(([keys, action]) => (
              <div className="help-shortcuts__row" key={keys}>
                <kbd>{keys}</kbd>
                <span>{action}</span>
              </div>
            ))}
          </div>
        </section>
      </section>
    </div>
  )
}
