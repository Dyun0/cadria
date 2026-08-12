# Cadria Studio Desktop App 가이드

Cadria Studio는 Node.js 내장 백엔드 및 Electron 기반의 독립형 데스크톱 전용 비디오 편집기 애플리케이션입니다.
추가 파이썬 설치나 외부 웹서버 설정 없이, 실행 파일 더블클릭만으로 100% 오프라인 동작합니다.

---

## 1. 주요 아키텍처

- **UI Core**: React + TypeScript + Canvas Timeline (`frontend/dist`)
- **Backend Service**: Node.js Express Backend (`server/`)
  - 미디어 업로드, `ffprobe` 메타데이터 탐색, 썸네일 생성, 타임라인 `filter_complex` FFmpeg 렌더링 내보내기 전담
- **Desktop Shell**: Electron 셸 (`desktop/`)
- **FFmpeg Engine**: Windows 64-bit static 바이너리 (`bin/ffmpeg.exe`, `bin/ffprobe.exe`) 내장

---

## 2. 데스크톱 패키지 빌드 방법

### 원클릭 빌드 스크립트 실행
```bash
# 1. 의존성 설치
cd server && npm install
cd ../desktop && npm install

# 2. Windows 데스크톱 앱 패키징 스크립트 실행
node scripts/build_windows_installer.js
```

빌드가 완료되면 `desktop/release/` 디렉터리에 설치 파일 및 실행 패키지가 생성됩니다.

---

## 3. 사용자 설치 및 실행 안내

1. 배포된 `Cadria_Studio_Windows_x64.zip` 압축을 풉니다.
2. `Install_Cadria_Studio.bat` 파일을 실행합니다.
   - `AppData/Local/CadriaStudio` 경로에 모든 시스템 및 바이너리 파일이 자동으로 덮어쓰기 설치됩니다.
   - 바탕화면 및 시작 메뉴에 `Cadria Studio` 바로가기 아이콘이 자동 생성됩니다.
3. 바탕화면의 `Cadria Studio` 아이콘을 더블클릭하여 바로 비디오 편집기를 사용할 수 있습니다.
