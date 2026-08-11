# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=3001 \
    DATA_DIR=/app/data \
    MAX_UPLOAD_BYTES=2147483648 \
    MAX_CONCURRENT_JOBS=1 \
    CORS_ORIGINS=http://localhost:3080

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN groupadd --system cadria \
  && useradd --system --gid cadria --home-dir /app --shell /usr/sbin/nologin cadria \
  && mkdir -p /app/data \
  && chown -R cadria:cadria /app

EXPOSE 3001
VOLUME ["/app/data"]

WORKDIR /app/backend
USER cadria

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:3001/api/health || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
