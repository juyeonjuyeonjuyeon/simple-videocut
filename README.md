# SimpleCut — 나만의 영상 편집기

캡컷 스타일의 가볍고 직관적인 개인용 영상 편집기입니다. 웹·모바일에서는 브라우저
안에서, macOS 앱에서는 내장된 네이티브 FFmpeg로 처리하며 서버에는 원본을 올리지
않습니다. 화면 크기에 맞춰 사용할 수 있는 반응형 디자인입니다.

## 주요 기능

- **트림** — 클립의 시작/끝 지점 조절
- **분할 & 삭제** — 플레이헤드 위치에서 클립을 자르고(✂ / 단축키 `S`) 불필요한 구간 제거
- **여러 클립 합치기** — 여러 동영상을 타임라인에 올려 순서대로 이어 붙이기
- **시각적인 타임라인** — 영상 썸네일·오디오 파형으로 장면과 소리 위치 확인
- **마커** — 중요한 지점을 이름과 색으로 표시하고 이동·스냅·저장
- **클립 전환** — 클립 경계에서 검정 페이드 전환 길이 선택
- **텍스트 자막 오버레이** — 위치·크기·색·배경·표시 구간 지정 (한글 지원)
- **음량 / 음소거** — 클립별 볼륨 조절
- **화면·소리 페이드** — 영상·오버레이·텍스트·배경·음악의 시작/끝을 부드럽게 처리
- **속도 조절** — 0.25× ~ 4× 배속/슬로우 (오디오 피치 보정 포함)
- **캔버스 규격** — 16:9·9:16·1:1·4:3·3:4·4:5·5:4·21:9·2:1과 정확한 사용자 픽셀 크기
- **내보내기** — MP4(H.264/AAC)·WebM 렌더링, 480p부터 4K까지 선택
- **macOS 하드웨어 인코딩** — VideoToolbox를 우선 사용하고 실패하면 호환 인코딩으로 자동 재시도
- **완전한 트랙 합성** — 배경·오버레이 화면과 소리·음악까지 결과물에 포함
- **레이어 보호** — 오버레이·텍스트·배경의 잠금·숨김·불투명도·중앙 정렬
- **위치 키프레임** — 오버레이·텍스트의 움직임을 시간별 위치와 보간 방식으로 지정
- **실행 취소 / 다시 실행** — 버튼 또는 `⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`
- **자동 저장과 복원** — 저장 상태 표시 및 작업 복구
- **기기 간 이동** — `.scut` 프로젝트 파일 저장·불러오기·모바일 공유
- **설치형 웹앱(PWA)** — 홈 화면에 설치하고 앱처럼 실행

## 기술 스택

React 18 · TypeScript · Vite · Zustand(상태 관리) · ffmpeg.wasm(웹) · Electron/FFmpeg(VideoToolbox, macOS)

## 제품 정책

출시 예정 제품명 **개간단컷**의 무료·Pro 기능 범위, 7일 체험, 평생 이용권,
광고·구독 정책과 경쟁 전략은 [제품·수익화 전략](docs/product-and-monetization-strategy.md)에 정리되어 있습니다.

iPhone·iPad 화면 구조, 패널 전환 원칙과 기기별 검증 기준은
[모바일 UI·UX 기준](docs/mobile-ui-ux.md)에 정리되어 있습니다.

## 실행

```bash
npm install
npm run dev     # 개발 서버 (http://localhost:5173)
npm run build   # 프로덕션 빌드 (결과물: dist/)
npm run preview # 빌드 결과 미리보기
npm run check   # 코드 검사 + 단위 테스트 + 프로덕션 빌드
npm run test:e2e # 모바일·태블릿·노트북 반응형 브라우저 테스트
npm run desktop:build # macOS 앱 빌드
npm run desktop:test  # 앱 실행·닫기·복원·M4A·HEVC·MP4 전체 검사
```

## 배포 (GitHub Pages)

이 저장소는 `main` 브랜치가 갱신될 때 GitHub Actions로 자동 빌드·배포됩니다.

공개 주소: `https://juyeonjuyeonjuyeon.github.io/simple-videocut/`

GitHub 저장소의 **Settings → Pages → Build and deployment → Source**는 `GitHub Actions`로 설정합니다.

## 단축키

| 키 | 동작 |
| --- | --- |
| `Space` | 재생 / 일시정지 |
| `S` | 플레이헤드에서 분할 |
| `M` | 현재 위치에 마커 추가 |
| `Delete` / `Backspace` | 선택 항목 삭제 |
| `⌘/Ctrl+Z` | 실행 취소 |
| `⌘/Ctrl+Shift+Z` | 다시 실행 |
| `←` / `→` | 플레이헤드 0.1초 이동 |

## 구조

```
src/
  components/   Preview · Timeline · Inspector · ExportDialog · App
  ffmpeg/       exporter.ts   — 필터그래프 구성 + 텍스트 PNG 합성 + 인코딩
  utils/        time.ts(타임라인 계산) · motion.ts(키프레임 보간) · media.ts(메타데이터 프로브)
  store.ts      Zustand 편집 상태 + 모든 편집 액션
  types.ts      Clip / TextOverlay 등 데이터 모델
electron/
  main.mjs                  — 앱 창·FFmpeg·보안 IPC 경계
  native-project-store.mjs  — 원본 미디어 보관소·원자적 자동저장 세대
```

## 동작 메모

- 웹 **내보내기**는 사이트와 함께 배포된 ffmpeg 코어를 사용합니다. 이후 렌더링은
  브라우저 안에서 진행되며, 길이·해상도에 따라 시간이 걸릴 수 있습니다.
  단일 스레드 코어를 쓰므로 `SharedArrayBuffer`(COOP/COEP 헤더)가 필요 없어,
  헤더 설정이 불가능한 정적 호스팅(예: GitHub Pages)에서도 그대로 동작합니다.
- macOS 앱은 원본 미디어를 한 번만 관리 보관소에 복사하고 자동저장에는 가벼운 편집
  정보와 불투명 미디어 ID만 남깁니다. 현재 저장이 손상되면 이전 자동저장 세대도
  순서대로 검사합니다.
- **텍스트 자막**은 출력 해상도 크기의 투명 PNG로 캔버스에서 직접 렌더링한 뒤
  영상 위에 오버레이합니다. 덕분에 wasm 폰트 설정 없이도 한글이 정확히 표시됩니다.
- 미리보기 프레임 크기는 JS로 계산해 선택한 비율에 정확히 맞추므로, 미리보기의
  자막 위치가 내보낸 영상과 일치합니다.
