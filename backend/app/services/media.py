from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import UploadFile

from app.config import Settings
from app.models import MediaMetadata, MediaResponse
from app.services.registry import MediaRegistry


class InvalidMediaError(ValueError):
    pass


class UploadTooLargeError(ValueError):
    pass


def _fps(value: str | None) -> float:
    if not value:
        return 0
    numerator, _, denominator = value.partition("/")
    try:
        return float(numerator) / float(denominator or 1)
    except (ValueError, ZeroDivisionError):
        return 0


async def _command(*args: str, timeout: float = 60) -> tuple[bytes, bytes]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise InvalidMediaError("media inspection timed out")
    if process.returncode:
        message = stderr.decode(errors="replace")[-1000:].strip()
        raise InvalidMediaError(message or f"{args[0]} failed")
    return stdout, stderr


async def probe_media(ffprobe: str, path: Path) -> dict[str, object]:
    stdout, _ = await _command(
        ffprobe,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    )
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise InvalidMediaError("ffprobe returned invalid JSON") from exc
    video = next(
        (stream for stream in data.get("streams", []) if stream.get("codec_type") == "video"),
        None,
    )
    audio = next(
        (stream for stream in data.get("streams", []) if stream.get("codec_type") == "audio"),
        None,
    )
    if not video or not video.get("width") or not video.get("height"):
        raise InvalidMediaError("uploaded file has no valid video stream")
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    frame_rate = _fps(video.get("avg_frame_rate") or video.get("r_frame_rate"))
    if duration <= 0 or frame_rate <= 0:
        raise InvalidMediaError("video duration or frame rate is invalid")
    return {
        "duration": duration,
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": frame_rate,
        "has_audio": audio is not None,
        "codec": video.get("codec_name"),
    }


async def generate_thumbnail(ffmpeg: str, source: Path, destination: Path, duration: float) -> None:
    temporary = destination.with_suffix(".tmp.jpg")
    temporary.unlink(missing_ok=True)
    try:
        await _command(
            ffmpeg,
            "-v",
            "error",
            "-ss",
            str(min(max(duration * 0.1, 0), 5)),
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-2",
            "-y",
            str(temporary),
            timeout=120,
        )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _safe_extension(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix) else ".bin"


async def ingest_upload(
    upload: UploadFile,
    settings: Settings,
    registry: MediaRegistry,
) -> MediaResponse:
    media_id = uuid4()
    incoming = registry.media_dir / f".{media_id}.upload"
    final = registry.media_dir / f"{media_id}{_safe_extension(upload.filename)}"
    size = 0
    try:
        with incoming.open("xb") as stream:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise UploadTooLargeError(
                        f"upload exceeds {settings.max_upload_bytes} byte limit"
                    )
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        if size == 0:
            raise InvalidMediaError("uploaded file is empty")
        probed = await probe_media(settings.ffprobe, incoming)
        os.replace(incoming, final)
        thumbnail = registry.thumbnail_path(media_id)
        await generate_thumbnail(
            settings.ffmpeg, final, thumbnail, float(probed["duration"])
        )
        metadata = MediaMetadata(
            fileId=media_id,
            original_name=Path(upload.filename or "video").name,
            storage_name=final.name,
            content_type=upload.content_type or "application/octet-stream",
            size=size,
            created_at=datetime.now(UTC),
            **probed,
        )
        registry.save(metadata)
        return media_response(metadata)
    except Exception:
        incoming.unlink(missing_ok=True)
        final.unlink(missing_ok=True)
        registry.thumbnail_path(media_id).unlink(missing_ok=True)
        registry.metadata_path(media_id).unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def media_response(metadata: MediaMetadata) -> MediaResponse:
    media_id = metadata.media_id
    return MediaResponse(
        fileId=media_id,
        filename=str(media_id),
        original_name=metadata.original_name,
        url=f"/api/media/{media_id}/stream",
        thumbnail_url=f"/api/media/{media_id}/thumbnail",
        duration=metadata.duration,
        width=metadata.width,
        height=metadata.height,
        fps=metadata.fps,
        has_audio=metadata.has_audio,
        codec=metadata.codec,
    )
