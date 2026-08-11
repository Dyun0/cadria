from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import UUID

from app.models import MediaMetadata


class MediaNotFoundError(FileNotFoundError):
    pass


class MediaRegistry:
    def __init__(self, media_dir: Path, metadata_dir: Path, thumbnail_dir: Path) -> None:
        self.media_dir = media_dir.resolve()
        self.metadata_dir = metadata_dir.resolve()
        self.thumbnail_dir = thumbnail_dir.resolve()

    @staticmethod
    def _inside(root: Path, candidate: Path) -> Path:
        resolved = candidate.resolve()
        if resolved.parent != root:
            raise ValueError("unsafe registry path")
        return resolved

    def metadata_path(self, media_id: UUID) -> Path:
        return self._inside(self.metadata_dir, self.metadata_dir / f"{media_id}.json")

    def media_path(self, metadata: MediaMetadata) -> Path:
        if Path(metadata.storage_name).name != metadata.storage_name:
            raise ValueError("invalid storage name")
        return self._inside(self.media_dir, self.media_dir / metadata.storage_name)

    def thumbnail_path(self, media_id: UUID) -> Path:
        return self._inside(self.thumbnail_dir, self.thumbnail_dir / f"{media_id}.jpg")

    def save(self, metadata: MediaMetadata) -> None:
        destination = self.metadata_path(metadata.media_id)
        temporary = destination.with_suffix(f".{os.getpid()}.tmp")
        payload = metadata.model_dump_json(by_alias=True, indent=2)
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def get(self, media_id: UUID) -> MediaMetadata:
        path = self.metadata_path(media_id)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            metadata = MediaMetadata.model_validate(raw)
            media_path = self.media_path(metadata)
        except FileNotFoundError as exc:
            raise MediaNotFoundError(str(media_id)) from exc
        except (json.JSONDecodeError, ValueError) as exc:
            raise MediaNotFoundError(str(media_id)) from exc
        if metadata.media_id != media_id or not media_path.is_file():
            raise MediaNotFoundError(str(media_id))
        return metadata

    def resolve_many(self, media_ids: set[UUID]) -> dict[UUID, tuple[MediaMetadata, Path]]:
        return {
            media_id: (metadata := self.get(media_id), self.media_path(metadata))
            for media_id in media_ids
        }
