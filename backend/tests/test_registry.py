import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.models import MediaMetadata
from app.services.registry import MediaNotFoundError, MediaRegistry


def metadata(media_id, storage_name: str) -> MediaMetadata:
    return MediaMetadata(
        fileId=media_id,
        originalName="safe.mp4",
        storageName=storage_name,
        contentType="video/mp4",
        size=100,
        duration=2,
        width=640,
        height=360,
        fps=30,
        hasAudio=True,
        codec="h264",
        createdAt=datetime.now(UTC),
    )


def test_registry_round_trip_uses_uuid_paths(tmp_path) -> None:
    media_dir = tmp_path / "media"
    metadata_dir = tmp_path / "metadata"
    thumbnails = tmp_path / "thumbs"
    for directory in (media_dir, metadata_dir, thumbnails):
        directory.mkdir()
    registry = MediaRegistry(media_dir, metadata_dir, thumbnails)
    media_id = uuid4()
    (media_dir / f"{media_id}.mp4").write_bytes(b"video")
    registry.save(metadata(media_id, f"{media_id}.mp4"))

    loaded = registry.get(media_id)
    assert loaded.media_id == media_id
    assert registry.media_path(loaded).parent == media_dir


def test_tampered_metadata_cannot_escape_media_root(tmp_path) -> None:
    media_dir = tmp_path / "media"
    metadata_dir = tmp_path / "metadata"
    thumbnails = tmp_path / "thumbs"
    for directory in (media_dir, metadata_dir, thumbnails):
        directory.mkdir()
    registry = MediaRegistry(media_dir, metadata_dir, thumbnails)
    media_id = uuid4()
    payload = metadata(media_id, "../secret.mp4").model_dump(
        mode="json", by_alias=True
    )
    registry.metadata_path(media_id).write_text(json.dumps(payload))

    with pytest.raises(MediaNotFoundError):
        registry.get(media_id)
