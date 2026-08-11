from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.models import ExportRequest, JobResponse, JobStatus, MediaResponse
from app.services.jobs import (
    JobConflictError,
    JobManager,
    JobNotFoundError,
    TERMINAL_STATUSES,
)
from app.services.media import (
    InvalidMediaError,
    UploadTooLargeError,
    ingest_upload,
)
from app.services.registry import MediaNotFoundError, MediaRegistry


settings.ensure_directories()
registry = MediaRegistry(
    settings.upload_dir, settings.metadata_dir, settings.thumbnail_dir
)
jobs = JobManager(settings, registry)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.ensure_directories()
    yield
    await jobs.shutdown()


app = FastAPI(
    title="Cadria API",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=settings.cors_origins != ("*",),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def reject_known_oversized_uploads(request: Request, call_next):
    if request.url.path in {"/api/upload", "/api/media"}:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                # Multipart framing is small but included in Content-Length.
                if int(content_length) > settings.max_upload_bytes + 1024 * 1024:
                    return JSONResponse(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        content={"detail": "upload is too large"},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "invalid Content-Length"},
                )
    return await call_next(request)


async def _binary_health(binary: str) -> dict[str, object]:
    process: asyncio.subprocess.Process | None = None
    try:
        process = await asyncio.create_subprocess_exec(
            binary,
            "-version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=3)
        first_line = stdout.decode(errors="replace").splitlines()
        return {
            "available": process.returncode == 0,
            "version": first_line[0] if first_line else None,
        }
    except TimeoutError:
        if process and process.returncode is None:
            process.kill()
            await process.wait()
        return {"available": False, "version": None}
    except OSError:
        return {"available": False, "version": None}


@app.get("/api/health")
async def health() -> JSONResponse:
    ffmpeg, ffprobe = await asyncio.gather(
        _binary_health(settings.ffmpeg), _binary_health(settings.ffprobe)
    )
    healthy = bool(ffmpeg["available"] and ffprobe["available"])
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"ok": healthy, "ffmpeg": ffmpeg, "ffprobe": ffprobe},
    )


@app.post("/api/upload", response_model=MediaResponse, status_code=201)
@app.post("/api/media", response_model=MediaResponse, status_code=201)
async def upload_media(media: UploadFile = File(...)) -> MediaResponse:
    try:
        return await ingest_upload(media, settings, registry)
    except UploadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except InvalidMediaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _media_or_404(media_id: UUID):
    try:
        metadata = registry.get(media_id)
        return metadata, registry.media_path(metadata)
    except MediaNotFoundError as exc:
        raise HTTPException(status_code=404, detail="media not found") from exc


@app.get("/api/media/{media_id}/stream")
async def stream_media(media_id: UUID) -> FileResponse:
    metadata, path = _media_or_404(media_id)
    return FileResponse(
        path,
        media_type=metadata.content_type,
        content_disposition_type="inline",
    )


@app.get("/api/media/{media_id}/download")
async def download_media(media_id: UUID) -> FileResponse:
    metadata, path = _media_or_404(media_id)
    return FileResponse(
        path,
        media_type=metadata.content_type,
        filename=metadata.original_name,
        content_disposition_type="attachment",
    )


@app.get("/api/media/{media_id}/thumbnail")
async def media_thumbnail(media_id: UUID) -> FileResponse:
    _media_or_404(media_id)
    path = registry.thumbnail_path(media_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="thumbnail not found")
    return FileResponse(path, media_type="image/jpeg")


@app.post("/api/export", response_model=JobResponse, status_code=202)
@app.post("/api/exports", response_model=JobResponse, status_code=202)
async def create_export(request: ExportRequest) -> JobResponse:
    try:
        return jobs.response(jobs.create(request))
    except MediaNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"media not found: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _job_or_404(job_id: UUID):
    try:
        return jobs.get(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="export job not found") from exc


@app.get("/api/exports/{job_id}", response_model=JobResponse)
async def export_status(job_id: UUID) -> JobResponse:
    return jobs.response(_job_or_404(job_id))


@app.get("/api/exports/{job_id}/events")
async def export_events(job_id: UUID, request: Request) -> StreamingResponse:
    job = _job_or_404(job_id)

    async def events():
        revision = -1
        while True:
            if await request.is_disconnected():
                return
            if revision != job.revision:
                response = jobs.response(job)
                yield (
                    "event: status\n"
                    f"data: {response.model_dump_json(by_alias=True)}\n\n"
                )
                revision = job.revision
                if job.status in TERMINAL_STATUSES:
                    return
            try:
                await jobs.wait_for_update(job, revision)
            except TimeoutError:
                yield ": keep-alive\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.delete("/api/exports/{job_id}", response_model=JobResponse)
async def cancel_export(job_id: UUID) -> JobResponse:
    try:
        return jobs.response(await jobs.cancel(job_id))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="export job not found") from exc
    except JobConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/exports/{job_id}/download")
async def download_export(job_id: UUID) -> FileResponse:
    job = _job_or_404(job_id)
    if job.status != JobStatus.completed or not job.output_path.is_file():
        raise HTTPException(status_code=409, detail="export is not completed")
    return FileResponse(
        job.output_path,
        media_type="video/mp4",
        filename=f"export_{job_id}.mp4",
        content_disposition_type="attachment",
    )


if settings.frontend_dist.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=Path(settings.frontend_dist), html=True),
        name="frontend",
    )
