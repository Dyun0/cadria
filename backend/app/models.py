from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


def _camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
    )


UnitFloat = Annotated[float, Field(ge=0, le=1)]
PositiveUnitFloat = Annotated[float, Field(gt=0, le=1)]


class Crop(APIModel):
    x: UnitFloat = 0
    y: UnitFloat = 0
    w: PositiveUnitFloat = Field(
        default=1, validation_alias=AliasChoices("width", "w"), serialization_alias="width"
    )
    h: PositiveUnitFloat = Field(
        default=1, validation_alias=AliasChoices("height", "h"), serialization_alias="height"
    )

    @model_validator(mode="after")
    def contained(self) -> "Crop":
        if self.x + self.w > 1.000001 or self.y + self.h > 1.000001:
            raise ValueError("crop must be contained within normalized source bounds")
        return self


class Transform(APIModel):
    x: float = Field(default=0, ge=-2, le=2)
    y: float = Field(default=0, ge=-2, le=2)
    scale: float = Field(default=1, gt=0, le=8)
    width: float = Field(default=1, gt=0, le=4)
    height: float = Field(default=1, gt=0, le=4)
    rotation: Literal[0, 90, 180, 270] = 0
    flip_x: bool = False
    flip_y: bool = False


class AudioSettings(APIModel):
    enabled: bool = True
    volume: float = Field(default=1, ge=0, le=4)
    mute: bool = False


class Clip(APIModel):
    id: str = Field(min_length=1, max_length=128)
    media_id: UUID = Field(
        validation_alias=AliasChoices("mediaId", "fileId"),
        serialization_alias="mediaId",
    )
    source_start: float = Field(default=0, ge=0)
    source_end: float = Field(gt=0)
    timeline_start: float = Field(default=0, ge=0)
    speed: float = Field(default=1, ge=0.1, le=16)
    crop: Crop = Field(default_factory=Crop)
    transform: Transform = Field(default_factory=Transform)
    audio: AudioSettings = Field(default_factory=AudioSettings)

    @model_validator(mode="after")
    def valid_trim(self) -> "Clip":
        if self.source_end <= self.source_start:
            raise ValueError("sourceEnd must be greater than sourceStart")
        return self

    @property
    def output_duration(self) -> float:
        return (self.source_end - self.source_start) / self.speed


class Track(APIModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["video", "overlay", "audio"] = Field(
        default="video",
        validation_alias=AliasChoices("kind", "type"),
        serialization_alias="kind",
    )
    name: str | None = Field(default=None, max_length=200)
    clips: list[Clip] = Field(default_factory=list, max_length=1000)
    muted: bool = False
    locked: bool = False


class Background(APIModel):
    type: Literal["solid", "gradient", "blur"] = "solid"
    color: str = Field(default="#000000", pattern=r"^#[0-9a-fA-F]{6}$")
    color2: str = Field(default="#1a1a2e", pattern=r"^#[0-9a-fA-F]{6}$")
    blur_source_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("mediaId", "blurSourceId"),
        serialization_alias="mediaId",
    )
    blur_radius: float = Field(
        default=20,
        ge=0,
        le=100,
        validation_alias=AliasChoices("blur", "blurRadius"),
        serialization_alias="blur",
    )

    @model_validator(mode="after")
    def blur_has_source(self) -> "Background":
        if self.type == "blur" and self.blur_source_id is None:
            raise ValueError("blurSourceId is required for blur background")
        return self


class ExportQuality(StrEnum):
    draft = "draft"
    standard = "standard"
    high = "high"


class ExportSettings(APIModel):
    width: int = Field(default=1920, ge=16, le=7680)
    height: int = Field(default=1080, ge=16, le=4320)
    aspect: Literal["16:9", "9:16", "1:1", "4:5", "4:3"] = "16:9"
    fps: int = Field(default=30, ge=1, le=120)
    quality: ExportQuality = ExportQuality.standard
    video_codec: Literal["libx264", "libx265"] = "libx264"
    audio_bitrate: str = Field(default="192k", pattern=r"^(?:[3-9][0-9]|[1-9][0-9]{2,3})k$")


class Project(APIModel):
    version: Literal[1] = 1
    id: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=300)
    media: dict[str, object] = Field(default_factory=dict)
    background: Background = Field(default_factory=Background)
    tracks: list[Track] = Field(min_length=1, max_length=100)
    export: ExportSettings = Field(default_factory=ExportSettings)
    updated_at: datetime | None = None

    @property
    def width(self) -> int:
        return self.export.width

    @property
    def height(self) -> int:
        return self.export.height

    @model_validator(mode="after")
    def has_clips(self) -> "Project":
        if self.width % 2 or self.height % 2:
            raise ValueError("output width and height must be even")
        if not any(track.clips for track in self.tracks):
            raise ValueError("project must contain at least one clip")
        return self


class ExportRequest(APIModel):
    project: Project
    # Accepted only for migration from the JS client. Values are never trusted as paths.
    files: dict[UUID, str] | None = None
    file_meta: dict[UUID, dict[str, object]] | None = None


class MediaMetadata(APIModel):
    media_id: UUID = Field(alias="fileId")
    original_name: str
    storage_name: str
    content_type: str
    size: int = Field(ge=0)
    duration: float = Field(gt=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: float = Field(gt=0)
    has_audio: bool
    codec: str | None = None
    created_at: datetime


class MediaResponse(APIModel):
    media_id: UUID = Field(alias="fileId")
    filename: str
    original_name: str
    url: str
    thumbnail_url: str
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool
    codec: str | None = None


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class JobResponse(APIModel):
    job_id: UUID
    status: JobStatus
    progress: float = Field(ge=0, le=1)
    duration: float | None = None
    error: str | None = None
    download_url: str | None = None
    created_at: datetime
    updated_at: datetime
