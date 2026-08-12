# Cadria 데스크톱 이전 설계

Cadria의 웹 버전은 React 편집 코어와 FastAPI 렌더 서비스를 분리한다. Windows 앱은 이 경계를 유지한 채 Tauri 2 셸을 추가한다.

## 목표 구조

```text
Tauri WebView
  └─ React / TypeScript UI
      └─ EditorTransport
          ├─ WebApiTransport      (현재 Docker 배포)
          └─ TauriTransport       (향후 Windows 앱)

Tauri process
  ├─ FastAPI sidecar (127.0.0.1, 임의 포트, 세션 토큰)
  └─ bundled ffmpeg.exe / ffprobe.exe
```

편집 명령과 프로젝트 JSON은 플랫폼에 의존하지 않는다. 파일 선택, 미디어 URL, 내보내기 결과 열기만 transport 구현에서 달라진다.

## 패키징 경계

- `frontend/`: 동일한 Vite 빌드를 WebView에 포함한다.
- `backend/`: PyInstaller 또는 Nuitka one-file이 아닌 one-folder sidecar로 패키징한다. FFmpeg 프로세스와 모델 파일을 명확히 분리하고 시작 시간을 줄이기 위해서다.
- `resources/ffmpeg/<target-triple>/`: GPL/LGPL 라이선스 조건을 확인한 고정 FFmpeg 빌드를 배포한다.
- Tauri는 sidecar에 `CADRIA_DATA_DIR`, `FFMPEG_PATH`, `FFPROBE_PATH`, 임의 포트와 세션 토큰을 전달한다.
- sidecar는 외부 인터페이스에 바인딩하지 않고 `127.0.0.1`만 사용한다.

## Windows 데이터 경로

`%LOCALAPPDATA%\Cadria\` 아래에 다음을 둔다.

```text
Cadria/
  projects/
  media/
  thumbnails/
  exports/
  jobs/
  logs/
```

프로젝트는 원본 파일을 복사하거나 외부 경로 참조로 유지할 수 있다. 외부 참조가 사라지면 앱은 재연결 대화상자를 제공해야 한다.

## 단계별 이전

1. `WebApiTransport`와 API 계약을 고정한다.
2. Tauri 2 기본 셸과 capabilities를 추가한다.
3. 네이티브 파일 선택 및 출력 폴더 열기를 `TauriTransport`로 구현한다.
4. Python sidecar와 FFmpeg 바이너리를 target triple별로 번들한다.
5. sidecar 준비 상태, 비정상 종료, 앱 종료 시 작업 취소를 연결한다.
6. Windows 코드 서명, MSI/NSIS 설치, 자동 업데이트 서명을 추가한다.

## 업데이트와 보안

- Tauri updater의 서명 검증을 사용하고 공개 키를 앱에 고정한다.
- sidecar API에는 시작 시 생성한 세션 토큰을 요구한다.
- 웹 배포의 업로드 ID와 로컬 파일 시스템 경로를 프로젝트 JSON에 직접 섞지 않는다.
- 로그에는 원본 전체 경로와 FFmpeg 인자 내 민감한 파일명을 기본적으로 남기지 않는다.

현재 리포지토리에는 Tauri 코드를 포함하지 않는다. 웹 편집 기능과 렌더 계약이 안정화된 뒤 별도 `src-tauri/` 단계에서 추가한다.
