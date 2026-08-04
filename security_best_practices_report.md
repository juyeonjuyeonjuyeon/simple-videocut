# SimpleCut 코드 안전성 분석 보고서

## 요약

SimpleCut은 서버, 계정, 쿠키, API가 없는 정적 React 앱이며 영상은 사용자의 브라우저 안에서 처리된다. 이번 검사에서 치명적(Critical) 또는 높음(High) 등급의 취약점은 확인되지 않았다. 위험한 HTML 삽입, 동적 코드 실행, 비밀키, 인증 토큰, 임의 외부 요청도 발견되지 않았고 `npm audit` 결과 알려진 취약점은 0건이다.

검사에서 발견된 중간 위험 3건은 이번 변경에서 모두 보완했다. 프로젝트·미디어 자원 한도와 상세 스키마 검증을 추가했고, GitHub Pages에서 가능한 범위의 CSP와 Referrer Policy를 적용했다. 아래 항목의 Evidence는 최초 검사 당시 상태이며, 각 항목의 조치 결과가 현재 상태를 설명한다.

## 조치 결과

- SEC-01: 부분 해결. CSP 메타 정책과 `no-referrer`를 적용하고 실제 브라우저에서 FFmpeg.wasm 내보내기를 검증했다. GitHub Pages가 사용자 지정 응답 헤더를 지원하지 않아 `frame-ancestors`, `nosniff`, Permissions Policy는 호스팅 제약으로 남는다.
- SEC-02: 해결. 파일·디코딩 용량·항목 수·문자열·숫자 범위·중복 ID·미디어 참조·전체 타임라인 길이를 파싱 및 디코딩 전에 검증한다.
- SEC-03: 해결. 단일 파일 1GB, 프로젝트 미디어 합계 1.5GB, 미디어 100개 한도를 디코더 진입 전에 적용한다.
- SEC-04: 미해결(낮음). Google Fonts 자체 호스팅은 저장소·첫 로드 용량과의 절충이 필요하다.
- SEC-05: 해결. 모든 GitHub Actions를 검증된 전체 커밋 SHA로 고정했다.
- SEC-06: 미해결(낮음). 사용자가 저장 프로젝트를 개별 삭제할 수 있지만 자동저장 보존 기간과 전체 로컬 데이터 지우기 기능은 추후 작업이다.

## 중간 위험

### SEC-01 — 배포 응답에 브라우저 보안 정책이 없음

- Rule ID: REACT-CSP-001, REACT-HEADERS-001
- Severity: Medium
- Location: `index.html:3-18`, 실제 GitHub Pages HTML 응답
- Evidence: `index.html`에 CSP 메타 정책이 없고, 실제 응답 헤더에는 `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` 또는 CSP `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`가 없다. 응답은 HTTPS와 HSTS는 제공한다.
- Impact: 향후 XSS가 생기거나 외부 리소스가 변조될 경우 브라우저 차원의 2차 방어가 약하다. 다른 사이트가 편집기를 iframe으로 감싸 클릭을 유도하는 것도 차단되지 않는다.
- Fix: 헤더를 설정할 수 있는 정적 호스팅/엣지 계층에서 CSP, `nosniff`, `frame-ancestors 'none'`, Referrer Policy와 최소 Permissions Policy를 적용한다. GitHub Pages만 유지한다면 CSP의 지원 가능한 부분을 문서 최상단 메타로 적용하고, `frame-ancestors`는 메타에서 동작하지 않는 한계를 문서화한다.
- Mitigation: 외부 스크립트를 추가하지 않고 현재처럼 FFmpeg 코어를 동일 출처에서 제공한다. CSP에는 실제 동작에 필요한 `blob:` worker와 WebAssembly 정책을 최소 범위로 허용한다.
- False positive notes: GitHub Pages 앞에 별도 CDN/프록시가 있다면 그 계층의 응답 헤더를 다시 확인해야 한다. 현재 공개 URL에서는 해당 헤더가 보이지 않는다.

### SEC-02 — 프로젝트 가져오기 검증이 자원 고갈을 막기에 부족함

- Rule ID: REACT-FILE-001
- Severity: Medium
- Location: `src/utils/project.ts:229-257` (`fileBlobToProject`, `assertPortableProject`), `src/utils/project.ts:68-101` (`deserialize`)
- Evidence: 프로젝트 파일을 최대 1GB까지 `file.text()`로 한 번에 읽고 JSON 전체를 메모리에 만든 뒤, 각 base64 문자열을 다시 바이너리로 복제한다. 검증은 최상위 배열과 미디어 필드의 문자열 여부만 확인하며 배열 개수, base64별 크기, 총 디코딩 크기, 중복 ID, 트림·반복·좌표·해상도·내보내기 설정의 타입과 범위를 제한하지 않는다.
- Impact: 사용자가 조작된 `.scut/.json` 파일을 직접 열면 수 GB의 순간 메모리 사용, 브라우저 탭 종료, 매우 큰 canvas/FFmpeg 작업 또는 장시간 정지가 발생할 수 있다. 서버나 다른 사용자에게 전파되는 취약점은 아니며 공격에는 사용자의 파일 열기 동작이 필요하다.
- Fix: 가져오기 상한을 현실적인 값으로 낮추고, JSON 파싱 전에 파일 크기를 제한한다. 모든 배열의 최대 개수, 미디어별/총 디코딩 크기, ID 유일성, 허용 MIME·확장자, 문자열 길이와 모든 숫자의 `Number.isFinite` 및 범위를 스키마로 검증한다. `exportSettings.height`는 허용 해상도 집합으로 제한한다.
- Mitigation: 가져오기 전에 예상 프로젝트 크기와 미디어 개수를 표시하고 사용자 확인을 받는다. 변환 작업은 취소 가능한 Worker로 격리한다.
- False positive notes: 신뢰하는 본인 생성 프로젝트만 연다면 실제 위험은 낮다. 이메일·메신저 등에서 받은 프로젝트를 열 수 있는 기능이므로 신뢰 경계는 유지해야 한다.

### SEC-03 — 일반 미디어 입력에 파일 크기·개수·해상도 한도가 없음

- Rule ID: REACT-FILE-001
- Severity: Medium
- Location: `src/utils/media.ts:1-10`, `src/store.ts:112-142`, `src/store.ts:368-383`, `src/App.tsx:209-225`
- Evidence: 파일은 브라우저가 제공한 MIME 또는 확장자로 분류되지만 크기, 동시 개수, 영상 길이, 이미지 픽셀 수, 총 프로젝트 용량을 추가 전에 제한하지 않는다. 이후 브라우저 디코더와 FFmpeg.wasm이 파일 전체를 처리한다.
- Impact: 매우 큰 파일, 디코딩 폭탄 또는 다수 파일을 추가하면 메모리 고갈, 저장 공간 고갈, 자동 저장 실패나 탭 종료가 발생할 수 있다. 악성 코덱 파일은 브라우저/FFmpeg 파서 공격면도 넓힌다. 영향은 해당 사용자 브라우저에 한정된다.
- Fix: 기기 메모리를 고려한 단일 파일·총 프로젝트·파일 개수 상한을 두고, 메타데이터 검사 후 최대 픽셀 수와 길이를 제한한다. 파일 헤더/컨테이너 판별 결과와 선언 MIME이 불일치하면 거부한다.
- Mitigation: 큰 파일은 추가 전 경고하고 저해상도 프록시 생성 여부를 선택하게 한다. FFmpeg 실패 시 현재처럼 엔진을 종료해 메모리를 회수한다.
- False positive notes: 개인 로컬 편집기라 가용성 영향만 있으며 원격 데이터 유출로 이어지지는 않는다.

## 낮은 위험

### SEC-04 — Google Fonts 외부 의존성과 개인정보 노출

- Rule ID: REACT-SRI-001, REACT-3P-001
- Severity: Low
- Location: `index.html:13-17`
- Evidence: 앱 시작 시 `fonts.googleapis.com`과 `fonts.gstatic.com`에 연결한다. Google Fonts CSS는 사용자 요청에 따라 생성돼 일반적인 고정 SRI 적용이 어렵다.
- Impact: 사용자의 IP·브라우저 요청 정보가 제3자에게 전달되고, 네트워크 차단 시 글꼴 사용감이 달라진다. 외부 스타일 공급망도 추가된다.
- Fix: 필요한 글꼴 파일과 CSS를 저장소에 고정 버전으로 자체 호스팅하고 CSP를 `self` 중심으로 좁힌다.
- Mitigation: 현재처럼 스크립트는 외부에서 로드하지 않고 글꼴에만 한정한다.
- False positive notes: 이는 직접 코드 실행 취약점이라기보다 개인정보·공급망 축소 권고다.

### SEC-05 — GitHub Actions가 이동 가능한 버전 태그를 사용함

- Rule ID: REACT-SUPPLY-001
- Severity: Low
- Location: `.github/workflows/deploy-pages.yml:21-35`, `.github/workflows/deploy-pages.yml:46-48`
- Evidence: `actions/checkout@v6`, `actions/setup-node@v6`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v4`, `actions/deploy-pages@v4`처럼 커밋 SHA가 아닌 태그를 사용한다.
- Impact: 태그가 예기치 않게 이동하거나 공급망 계정이 침해되면 빌드 환경이 바뀔 수 있다. 워크플로 권한은 이미 최소 수준으로 잘 제한돼 있어 영향은 완화된다.
- Fix: 각 액션을 검증된 전체 커밋 SHA로 고정하고 Dependabot으로 갱신한다.
- Mitigation: 현재의 최소 권한(`contents: read`, Pages 배포 전용 권한)과 `npm ci`를 유지한다.
- False positive notes: GitHub 공식 액션의 주요 버전 태그는 일반적 운영 방식이지만 SHA 고정이 더 강한 공급망 방어다.

### SEC-06 — 편집 원본이 브라우저 저장소에 평문으로 지속 저장됨

- Rule ID: JS-STORAGE-001
- Severity: Low
- Location: `src/utils/project.ts:157-203`
- Evidence: 자동 저장 프로젝트와 원본 미디어 Blob을 같은 출처의 IndexedDB에 보관한다. 암호화나 자동 만료는 없다.
- Impact: 같은 기기의 브라우저 프로필에 접근할 수 있는 사람, 악성 브라우저 확장, 또는 향후 발생한 동일 출처 XSS가 편집 원본을 읽을 수 있다.
- Fix: 설정에 “자동 저장 원본 삭제”, 보존 기간, 전체 로컬 데이터 지우기를 제공한다. 고민감 영상이라면 브라우저 저장소 자체를 사용하지 않는 세션 모드를 제공한다.
- Mitigation: 현재 앱에는 XSS 위험 sink가 발견되지 않았고 서버 전송도 없어 원격 노출 가능성은 낮다.
- False positive notes: 개인 편집기의 자동 복원을 위한 의도된 동작이다. 민감 영상의 위협 모델에 따라 수용할 수 있다.

## 확인된 안전 요소

- `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, `new Function`, 문자열 이벤트 핸들러가 없다.
- URL 파라미터 기반 리디렉션, `postMessage`, 인증 쿠키/API 요청이 없다.
- 사용자 파일명과 텍스트는 React JSX 또는 canvas 텍스트 API로 처리되어 HTML로 해석되지 않는다.
- FFmpeg 코어와 WASM은 동일 출처에서 고정된 로컬 자산으로 로드된다.
- 서비스 워커는 동일 출처의 GET 응답만 캐시하며 타 출처 요청은 건드리지 않는다.
- `package-lock.json`이 존재하고 배포는 `npm ci` 및 전체 검사 후 진행된다.
- `npm audit` 결과 211개 의존성에서 알려진 취약점 0건이다.
- 저장소에서 비밀키·토큰으로 의심되는 값이 발견되지 않았다.
- 실제 배포는 HTTPS 및 HSTS를 제공한다.

## 권장 처리 순서

1. SEC-02: 프로젝트 가져오기 전체 스키마와 자원 한도 적용
2. SEC-03: 미디어 파일·총 프로젝트 자원 한도 적용
3. SEC-01: GitHub Pages 제약 안에서 CSP 메타 적용 검증, 필요하면 무료 엣지 계층 검토
4. SEC-04: Google Fonts 자체 호스팅
5. SEC-05: GitHub Actions SHA 고정
6. SEC-06: 로컬 데이터 삭제·보존 설정 제공
