# Cadria Studio Desktop 빌드

Cadria Studio는 Node.js 백엔드와 Electron 셸을 하나의 Windows 앱으로 묶는다. 시스템 파이썬은 필요 없다.

## 구성

- **UI**: React + TypeScript (`frontend/dist`)
- **Backend**: Express (`server/`), Electron 메인 프로세스에서 기동
- **Shell**: Electron 33 (`desktop/`)
- **Engine**: 빌드 때 받는 Windows FFmpeg/ffprobe (`desktop/bin` → `extraResources`)
- **Installer**: electron-builder NSIS (`Cadria_Studio_Setup_1.0.0.exe`)

## 빌드

Linux/macOS/Windows에서 아래만 실행하면 된다. 프론트엔드·데스크톱 의존성과 Windows FFmpeg는 스크립트가 준비한다. Linux에서 NSIS를 만들 때는 Wine이 필요하고, Wine이 없으면 Docker 이미지 `electronuserland/builder:wine`을 쓴다.

```bash
node scripts/build_windows_installer.js
```

완료 후 설치 파일:

```text
desktop/release/Cadria_Studio_Setup_1.0.0.exe
```

## 사용자 설치

1. `Cadria_Studio_Setup_1.0.0.exe`를 실행한다.
2. 설치 마법사에서 경로를 확인한 뒤 설치한다. 바탕화면·시작 메뉴 바로가기가 만들어진다.
3. `Cadria Studio`를 실행한다. Express는 `127.0.0.1`에서 UI를 서빙한다.
