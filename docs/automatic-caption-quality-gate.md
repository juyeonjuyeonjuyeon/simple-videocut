# 로컬 자동 자막 품질 게이트

평가일: 2026-08-22

## 결론

`whisper.cpp` 기반 자동 자막은 지금 제품 기능으로 노출하지 않는다. 무료·오프라인 실행과 macOS arm64 지원은 확인했지만, 이 앱이 주로 다룰 한국어 영상에서 정확도와 자막 구간 품질을 검증하지 못했다. 검증되지 않은 고급 기능을 추가하기보다 현재의 수동 자막·SRT 작업 흐름을 완전하게 유지한다.

## 확인된 사실

- `whisper.cpp`는 MIT 라이선스이고 macOS Intel/Arm, iOS와 오프라인 실행을 공식 지원한다.
- Apple Silicon에서는 Metal을 사용하며 Core ML 가속도 선택할 수 있다.
- 입력은 FFmpeg로 16 kHz mono PCM WAV로 변환해야 한다. 앱에는 이미 네이티브 FFmpeg 경로가 있어 기술적으로 연결할 수 있다.
- 다국어 모델 용량은 tiny 75 MiB, base 142 MiB, small 466 MiB, medium 1.5 GiB이다. 한국어 품질을 검증하지 않은 채 작은 모델을 기본 탑재하거나 466 MiB 이상을 앱에 묶는 결정은 적절하지 않다.
- Whisper 공식 모델 카드는 배포 전에 대상 언어·도메인에서 별도 평가할 것을 권고하고, 실제 음성에 없는 문장 생성(환각), 반복 문장, 언어·화자별 정확도 편차를 한계로 명시한다.

## 통과 기준

다음 조건을 모두 실제 측정으로 만족할 때만 다시 개발한다.

1. 사용자가 편집하는 유형과 비슷한 한국어 음성 30분 이상과 정답 전사문을 준비한다.
2. 보통 말소리·배경음악·잡음·두 명 대화·아이폰 녹음 파일을 모두 포함한다.
3. 글자 오류율(CER) 12% 이하, 자막 시작·끝 경계의 중앙 오차 300 ms 이하를 달성한다.
4. 무음 구간 환각과 반복 문장이 평가 세트 전체에서 한 건도 없어야 한다.
5. 현재 16 GB Apple Silicon Mac에서 10분 음성을 5분 이내에 처리하고, 편집·미리보기의 반응성을 방해하지 않아야 한다.
6. 모델은 앱에 강제 포함하지 않는다. 최초 1회 명시적 다운로드, SHA-256 검증, 진행률·취소·재시도·삭제를 갖춘 모델 관리 화면을 제공한다.
7. 자동 생성 결과는 새 자막 트랙에만 넣고 기존 자막을 덮어쓰지 않으며, 실행 전 언어·대상 미디어·교체 여부를 확인한다.

## 재개 시 구현 순서

1. `whisper.cpp` 버전과 모델 체크섬을 고정한다.
2. Electron 메인 프로세스에서 FFmpeg 음성 추출과 별도 자식 프로세스 추론을 실행한다.
3. 진행률·취소·앱 종료 시 정리·오류 복구를 먼저 완성한다.
4. JSON 구간 결과를 전용 자막 트랙으로 가져오고 원본 클립 또는 오디오에 연결한다.
5. 위 평가 세트를 자동 회귀 테스트로 고정한 뒤에만 UI 버튼을 공개한다.

## 공식 근거

- whisper.cpp README: https://github.com/ggml-org/whisper.cpp/blob/master/README.md
- whisper.cpp 모델 크기: https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md
- whisper.cpp MIT 라이선스: https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE
- OpenAI Whisper 모델 카드: https://github.com/openai/whisper/blob/main/model-card.md
