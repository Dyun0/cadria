from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


@dataclass(frozen=True, slots=True)
class Settings:
    root_dir: Path
    data_dir: Path
    upload_dir: Path
    metadata_dir: Path
    thumbnail_dir: Path
    output_dir: Path
    frontend_dist: Path
    ffmpeg: str
    ffprobe: str
    max_upload_bytes: int
    max_concurrent_jobs: int
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(__file__).resolve().parents[2]
        data = Path(os.getenv("DATA_DIR", root / "data")).resolve()
        origins = tuple(
            origin.strip()
            for origin in os.getenv("CORS_ORIGINS", "*").split(",")
            if origin.strip()
        )
        return cls(
            root_dir=root,
            data_dir=data,
            upload_dir=Path(os.getenv("UPLOAD_DIR", data / "media")).resolve(),
            metadata_dir=Path(os.getenv("METADATA_DIR", data / "metadata")).resolve(),
            thumbnail_dir=Path(os.getenv("THUMBNAIL_DIR", data / "thumbnails")).resolve(),
            output_dir=Path(os.getenv("OUTPUT_DIR", data / "exports")).resolve(),
            frontend_dist=(root / "frontend" / "dist").resolve(),
            ffmpeg=os.getenv("FFMPEG_BIN", "ffmpeg"),
            ffprobe=os.getenv("FFPROBE_BIN", "ffprobe"),
            max_upload_bytes=_env_int("MAX_UPLOAD_BYTES", 2 * 1024**3),
            max_concurrent_jobs=_env_int("MAX_CONCURRENT_JOBS", 2),
            cors_origins=origins or ("*",),
        )

    def ensure_directories(self) -> None:
        for directory in (
            self.data_dir,
            self.upload_dir,
            self.metadata_dir,
            self.thumbnail_dir,
            self.output_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)


settings = Settings.from_env()
