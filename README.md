# Cadria Studio

Cadria Studio는 웹 및 오프라인 데스크톱 환경에서 동작하는 미디어 편집기 애플리케이션입니다. React SPA UI 코어와 Node.js Express 백엔드가 통합되어 동작하며, FFmpeg 기반의 고성능 타임라인 멀티트랙 비디오 렌더링을 지원합니다.

## 주요 기능

- 프레임 타임코드, 스크러빙, 타임라인 확대/축소
- 클립 트림, 시커 기준 분할, 이동, 복사/붙여넣기, 삭제, 트랙 리플 지우기
- 0.25x–4x 재생 속도 조정 및 오디오 동기화
- 크롭, 회전, 좌우·상하 반전, 위치·크기 조절
- 메인 비디오, 멀티트랙 오버레이, 독립 오디오 트랙 지원
- 16:9, 9:16, 1:1, 4:5, 4:3 캔버스 및 추천 해상도 지원
- 단색, 그라디언트, 소스 기반 흐림 배경
- Figma Editorial 기반 라이트 / 다크 모드 테마 시스템
- 비동기 FFmpeg MP4 내보내기, 진행률 표시 및 결과 다운로드

## Docker 실행

```bash
docker compose -f docker-compose.node.yml up --build -d
```

브라우저에서 [http://localhost:3080](http://localhost:3080)을 연다.

```bash
docker compose -f docker-compose.node.yml ps
docker compose -f docker-compose.node.yml logs -f cadria
docker compose -f docker-compose.node.yml down
```

## 데스크톱 앱 빌드 (Windows 64-bit)

Electron 데스크톱 패키징 및 원클릭 자동 설치 파일 생성에 관한 상세한 안내는 [`docs/desktop_build.md`](docs/desktop_build.md) 문서를 참고한다.

```bash
# Windows 데스크톱 패키징 스크립트 실행
node scripts/build_windows_installer.js
```
