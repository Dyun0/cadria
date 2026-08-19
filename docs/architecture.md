# Cadria 애플리케이션 구조

Cadria는 브라우저에서 편집 상태와 미리보기를 관리하고, Express가 미디어 저장과 FFmpeg 렌더링을 담당한다. 두 영역은 `ProjectV1` JSON과 HTTP API를 경계로 분리되어 있다.

```text
Browser / Electron WebView
  └─ React UI
      ├─ 편집 상태와 히스토리
      ├─ 실시간 미리보기
      └─ API transport
             │ HTTP / SSE
             ▼
Express (Node.js)
  ├─ 미디어 등록과 메타데이터
  ├─ 비동기 내보내기 작업
  └─ FFmpeg / ffprobe
             │
             ▼
       영속 데이터 디렉터리
```

웹은 Docker 컨테이너가 같은 스택을 제공한다. Windows 앱은 Electron이 Express를 127.0.0.1에 띄우고 FFmpeg를 번들한다. 데스크톱 패키징은 `docs/desktop.md`를 따른다.

## 프론트엔드

프론트엔드는 React, TypeScript, Vite, Zustand로 구성한다.

```text
frontend/
├─ src/
│  ├─ api/
│  │  └─ transport.ts       HTTP, SSE, 응답 정규화
│  ├─ core/
│  │  ├─ types.ts           프로젝트와 편집 데이터 타입
│  │  ├─ edit.ts            트림, 분할, 이동, 삭제, 갭 제거
│  │  └─ transforms.ts      브라우저 미리보기 변환
│  ├─ store/
│  │  └─ editorStore.ts     편집 상태, undo/redo, 자동 저장
│  ├─ App.tsx               워크벤치 UI와 사용자 상호작용
│  ├─ tokens.css            디자인 토큰
│  ├─ styles.css            화면 레이아웃과 컴포넌트 스타일
│  └─ enhancements.css      접근성과 세부 표현
├─ e2e/                     Playwright 사용자 흐름 테스트
└─ vite.config.ts
```

### 상태와 편집 명령

- `ProjectV1`이 미디어, 트랙, 클립, 배경, 출력 설정의 단일 기준이다.
- 크롭과 위치·크기는 출력 해상도와 무관한 `0–1` 정규화 좌표를 사용한다.
- `core/edit.ts`의 함수는 프로젝트를 입력받아 새 프로젝트를 반환한다.
- `editorStore.ts`는 최대 80개의 변경 이력을 관리하고 `localStorage`의 `cadria.project`에 자동 저장한다.
- 드래그 중에는 화면 상태만 갱신하고, 포인터를 놓을 때 한 번 커밋하여 undo 단위를 유지한다.

### 미리보기와 서버 통신

- `App.tsx`는 미디어 패널, 스테이지, 인스펙터, 타임라인, 내보내기 모달을 조합한다.
- 스테이지는 현재 플레이헤드에 활성화된 클립만 표시하고 소스 시간과 재생 속도를 동기화한다.
- `api/transport.ts`가 서버 응답을 프론트엔드 타입으로 변환하므로 UI는 API의 세부 필드명에 의존하지 않는다.
- 내보내기 진행률은 SSE로 수신하며, 연결이 끊기면 주기적인 상태 조회로 전환한다.

## 백엔드

백엔드는 Express와 FFmpeg로 구성한다.

```text
server/
├─ index.js                 API 라우팅, CORS, 정적 프론트 제공
├─ config.js                환경 변수와 데이터 경로 설정
└─ services/
   ├─ media.js              업로드, ffprobe 검사, 썸네일 생성
   ├─ ffmpeg_builder.js     프로젝트를 FFmpeg 명령으로 변환
   └─ jobs.js               렌더 큐, 진행률, 취소, 결과 관리
```

### 미디어 처리

1. 업로드 파일을 임시 경로에 청크 단위로 기록한다.
2. 최대 업로드 크기를 확인하고 `ffprobe`로 영상 스트림, 길이, 크기, FPS와 오디오 유무를 검사한다.
3. 검사가 끝난 파일만 최종 경로로 이동하고 FFmpeg로 썸네일을 만든다.
4. UUID 기반 파일명과 JSON 메타데이터를 `MediaRegistry`에 원자적으로 저장한다.

파일 시스템 경로는 API에 직접 노출하지 않는다. 클라이언트와 렌더 요청은 미디어 UUID만 사용하며, 백엔드가 UUID를 실제 파일로 해석한다. 데스크톱만 네이티브 대화상자로 고른 로컬 경로를 `POST /api/media/local`로 넘긴다.

### 내보내기 작업

1. `POST /api/exports`가 프로젝트를 검증하고 작업을 생성한다.
2. `ffmpeg_builder.js`가 트림, 속도, 크롭, 회전, 반전, 배치, 배경과 오디오를 필터 그래프로 변환한다.
3. `JobManager`가 동시 실행 수를 제한하고 FFmpeg를 비동기 프로세스로 실행한다.
4. FFmpeg 진행 정보를 `0–1` 범위로 기록하고 SSE 구독자에게 상태 변경을 알린다.
5. 성공한 임시 결과만 최종 MP4 경로로 원자적으로 이동한다. 실패하거나 취소된 작업의 부분 파일은 삭제한다.

작업 상태는 `queued → running → completed` 순서로 진행하며 `failed`와 `cancelled`도 종료 상태다. 실행 중인 작업은 API로 취소할 수 있다.

## 주요 API

- `GET /api/health`: API와 FFmpeg/ffprobe 상태 확인
- `POST /api/media`: 미디어 업로드와 메타데이터 생성
- `POST /api/media/local`: 데스크톱 로컬 파일 수집 (Electron 전용)
- `GET /api/media/{mediaId}/stream`: 브라우저 미리보기 스트림
- `GET /api/media/{mediaId}/thumbnail`: 미디어 썸네일
- `POST /api/exports`: 내보내기 작업 생성
- `GET /api/exports/{jobId}`: 작업 상태 조회
- `GET /api/exports/{jobId}/events`: SSE 진행 상태 구독
- `DELETE /api/exports/{jobId}`: 실행 중인 작업 취소
- `GET /api/exports/{jobId}/download`: 완성된 MP4 다운로드

## 데이터와 배포

Docker 이미지 빌드 시 Vite가 생성한 정적 파일을 Node 이미지에 포함한다. 운영 환경에서는 하나의 컨테이너가 API와 프론트엔드를 함께 제공하며 `/app/data`를 Docker 볼륨에 연결한다.

```text
data/
├─ media/         업로드 원본
├─ metadata/      미디어 메타데이터 JSON
├─ thumbnails/    미리보기 이미지
└─ exports/       렌더링 결과
```

편집 프로젝트는 현재 브라우저 `localStorage`에 저장된다. 업로드 원본과 내보내기 결과는 서버 데이터 볼륨에 저장되므로 컨테이너를 다시 만들어도 유지된다.

Windows 설치본은 같은 디렉터리 구조를 `%APPDATA%\Cadria Studio\cadria-data\`에 둔다.

## 변경 원칙

- 프로젝트 스키마를 변경하면 프론트엔드 타입과 백엔드 검증을 함께 갱신한다.
- 화면 변환을 변경하면 `transforms.ts`와 `ffmpeg_builder.js`의 결과가 같은지 확인한다.
- UI에서 직접 HTTP 요청을 만들지 않고 `WebApiTransport`를 통해 호출한다.
- 라우터에는 흐름 제어만 두고 미디어, 저장소, 렌더 로직은 서비스에 유지한다.
- 데스크톱 패키징은 `docs/desktop.md`를 따른다.
