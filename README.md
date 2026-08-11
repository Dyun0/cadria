# Cadria

Cadria는 브라우저에서 동작하는 로컬 중심 영상 편집기다. React 편집 코어와 Python FastAPI 렌더 서비스가 프로젝트 JSON을 공유하며, 최종 출력은 서버의 FFmpeg가 생성한다.

## 주요 기능

- 프레임 타임코드, 스크러빙, 타임라인 확대/축소
- 클립 트림, 시커 기준 분할, 이동, 삭제, 선택 트랙 갭 제거
- 0.1x–16x 속도와 동기화된 오디오
- 정규화 크롭, 회전, 좌우·상하 반전, 위치·크기 조절
- 멀티트랙 PiP와 클립별 오디오 활성화/볼륨
- 16:9, 9:16, 1:1, 4:5, 4:3 캔버스
- 단색, 그라디언트, 소스 기반 흐림 배경
- Undo/Redo와 브라우저 프로젝트 자동 저장
- 비동기 FFmpeg 내보내기, 진행률, 취소, 결과 다운로드

## Docker 실행

```bash
docker compose up --build -d
```

브라우저에서 [http://localhost:3080](http://localhost:3080)을 연다.

```bash
docker compose ps
docker compose logs -f cadria
docker compose down
```

미디어, 썸네일, 작업 정보와 결과물은 `cadria-data` Docker 볼륨에 유지된다. 데이터를 포함해 완전히 삭제하려면 `docker compose down -v`를 사용한다.

환경값은 [`.env.example`](.env.example)을 참고한다.

## 로컬 개발

FFmpeg와 ffprobe가 `PATH`에 있어야 한다.

```bash
# API
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 3001

# UI (별도 터미널)
cd frontend
npm install
npm run dev
```

UI는 `http://localhost:5173`, API 문서는 `http://localhost:3001/api/docs`에서 확인할 수 있다.

## 편집 흐름

1. 왼쪽 미디어 패널에 MP4를 드롭한다.
2. 미디어를 메인 또는 오버레이 트랙에 추가한다.
3. 타임라인 핸들로 트림하고 시커 위치에서 분할한다.
4. 프리뷰와 오른쪽 검사기에서 크롭, 배치, 속도, 오디오를 조정한다.
5. 내보내기 설정을 확인하고 렌더를 시작한다.
6. 진행률을 확인하거나 취소하고, 완료된 MP4를 다운로드한다.

## 기본 단축키

- `Space`: 재생/일시정지
- `S`: 선택 클립을 시커 위치에서 분할
- `Delete` / `Backspace`: 선택 클립 삭제
- `G`: 선택 트랙 갭 제거
- `Ctrl/Cmd + Z`: 실행 취소
- `Ctrl/Cmd + Shift + Z` 또는 `Ctrl/Cmd + Y`: 다시 실행

## 테스트

```bash
cd frontend && npm test
cd backend && pytest
```

실제 FFmpeg 통합 테스트는 짧은 합성 미디어를 사용하며 FFmpeg가 없으면 명시적으로 건너뛴다.

## 운영 경계

현재 구성은 개인 또는 신뢰된 사내 네트워크의 단일 사용자 운영을 기본으로 한다. 인터넷에 직접 공개하려면 인증, 사용자별 저장소, 요청 제한과 외부 오브젝트 스토리지가 추가로 필요하다.

Windows 앱 이전 구조는 [`docs/desktop.md`](docs/desktop.md)를 참고한다.
