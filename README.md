# 🐶 간단컷 — 간단한 영상 편집기

캡컷 스타일의 가볍고 직관적인 웹 기반 영상 편집기입니다. 브라우저 안에서 모든
처리가 이루어지며(서버 업로드 없음), 어떤 화면 크기에서도 쓸 수 있는 반응형
디자인입니다.

## 주요 기능

- **트림** — 클립의 시작/끝 지점 조절
- **분할 & 삭제** — 플레이헤드 위치에서 클립을 자르고(✂ / 단축키 `S`) 불필요한 구간 제거
- **여러 클립 합치기** — 여러 동영상을 타임라인에 올려 순서대로 이어 붙이기
- **텍스트 자막 오버레이** — 위치·크기·색·배경·표시 구간 지정 (한글 지원)
- **음량 / 음소거** — 클립별 볼륨 조절
- **속도 조절** — 0.25× ~ 4× 배속/슬로우 (오디오 피치 보정 포함)
- **화면 비율** — 16:9 / 9:16 / 1:1
- **내보내기** — `ffmpeg.wasm`으로 실제 MP4(H.264/AAC) 렌더링, 해상도 480p/720p/1080p 선택
- **완전한 트랙 합성** — 배경·오버레이 화면과 소리·음악까지 결과물에 포함
- **실행 취소 / 다시 실행** — 버튼 또는 `⌘/Ctrl+Z`, `⌘/Ctrl+Shift+Z`
- **자동 저장과 복원** — 저장 상태 표시 및 작업 복구
- **기기 간 이동** — `.scut` 프로젝트 파일 저장·불러오기·모바일 공유
- **설치형 웹앱(PWA)** — 홈 화면에 설치하고 앱처럼 실행

## 기술 스택

React 18 · TypeScript · Vite · Zustand(상태 관리) · ffmpeg.wasm(내보내기)

## 실행

```bash
npm install
npm run dev     # 개발 서버 (http://localhost:5173)
npm run build   # 프로덕션 빌드 (결과물: dist/)
npm run preview # 빌드 결과 미리보기
npm run check   # 코드 검사 + 단위 테스트 + 프로덕션 빌드
npm run test:e2e # 모바일·태블릿·노트북 반응형 브라우저 테스트
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
| `Delete` / `Backspace` | 선택 항목 삭제 |
| `⌘/Ctrl+Z` | 실행 취소 |
| `⌘/Ctrl+Shift+Z` | 다시 실행 |
| `←` / `→` | 플레이헤드 0.1초 이동 |

## 구조

```
src/
  components/   Preview · Timeline · Inspector · ExportDialog · App
  ffmpeg/       exporter.ts   — 필터그래프 구성 + 텍스트 PNG 합성 + 인코딩
  utils/        time.ts(타임라인 계산) · media.ts(메타데이터 프로브)
  store.ts      Zustand 편집 상태 + 모든 편집 액션
  types.ts      Clip / TextOverlay 등 데이터 모델
```

## 동작 메모

- **내보내기**는 최초 1회 ffmpeg 코어(약 30MB)를 CDN(unpkg)에서 받습니다. 이후
  렌더링은 브라우저 안에서 진행되며, 길이·해상도에 따라 시간이 걸릴 수 있습니다.
  단일 스레드 코어를 쓰므로 `SharedArrayBuffer`(COOP/COEP 헤더)가 필요 없어,
  헤더 설정이 불가능한 정적 호스팅(예: GitHub Pages)에서도 그대로 동작합니다.
- **텍스트 자막**은 출력 해상도 크기의 투명 PNG로 캔버스에서 직접 렌더링한 뒤
  영상 위에 오버레이합니다. 덕분에 wasm 폰트 설정 없이도 한글이 정확히 표시됩니다.
- 미리보기 프레임 크기는 JS로 계산해 선택한 비율에 정확히 맞추므로, 미리보기의
  자막 위치가 내보낸 영상과 일치합니다.
