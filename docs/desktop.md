# Cadria 데스크톱

Windows 앱은 Electron 셸 안에 React UI, Express 백엔드, FFmpeg를 함께 넣는다. 시스템 파이썬은 쓰지 않는다.

## 구조

```text
Electron (메인 프로세스)
  ├─ Express (127.0.0.1, 세션 쿠키)
  │    └─ frontend/dist 정적 UI
  └─ extraResources/bin
       ├─ ffmpeg.exe
       └─ ffprobe.exe
```

편집 명령과 프로젝트 JSON은 웹 배포와 같다. 데스크톱만 다른 점은 로컬호스트 바인딩, 세션 토큰, 네이티브 파일 대화상자, 번들 FFmpeg다.

## 패키징 경계

- `frontend/`: Vite 빌드 결과를 Electron 앱의 `dist/`에 포함한다.
- `server/`: Express를 별도 sidecar가 아니라 메인 프로세스에서 `require`로 띄운다.
- `desktop/bin/`: 빌드 때 Windows amd64 FFmpeg/ffprobe를 받아 `extraResources/bin`으로 넣는다.
- 설치 산출물은 NSIS `Cadria_Studio_Setup_<version>.exe`다.

## Windows 데이터 경로

`%APPDATA%\Cadria Studio\cadria-data\` 아래에 다음을 둔다.

```text
cadria-data/
  media/
  metadata/
  thumbnails/
  exports/
```

## 보안

- API는 `127.0.0.1`만 연다. 포트 39017이 쓰이면 다음 포트를 찾는다.
- 시작 시 세션 토큰을 만들고 httpOnly 쿠키로만 전달한다. `/api/*`는 이 토큰이 있어야 한다.
- 렌더러는 `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`다. 파일 선택은 preload IPC를 쓴다.

빌드와 설치 절차는 [`desktop_build.md`](desktop_build.md)를 따른다.
