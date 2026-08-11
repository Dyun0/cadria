from datetime import UTC, datetime
from uuid import uuid4

from app.models import ExportRequest, MediaMetadata
from app.services.ffmpeg_builder import build_ffmpeg_plan, split_atempo


def test_atempo_chain_covers_full_speed_range() -> None:
    assert split_atempo(0.1) == (0.5, 0.5, 0.5, 0.8)
    assert split_atempo(16) == (2.0, 2.0, 2.0, 2.0)
    assert split_atempo(1) == (1,)


def test_builder_preserves_preview_transform_contract(tmp_path) -> None:
    media_id = uuid4()
    request = ExportRequest.model_validate(
        {
            "project": {
                "version": 1,
                "background": {
                    "type": "gradient",
                    "color": "#112233",
                    "color2": "#334455",
                },
                "tracks": [
                    {
                        "id": "pip",
                        "kind": "overlay",
                        "clips": [
                            {
                                "id": "clip",
                                "mediaId": str(media_id),
                                "sourceStart": 1,
                                "sourceEnd": 9,
                                "timelineStart": 2,
                                "speed": 4,
                                "crop": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
                                "transform": {
                                    "x": 0.5,
                                    "y": 0.5,
                                    "width": 0.4,
                                    "height": 0.4,
                                    "scale": 1,
                                    "flipX": True,
                                    "rotation": 90,
                                },
                                "audio": {"enabled": True, "volume": 0.5},
                            }
                        ],
                    }
                ],
                "export": {
                    "width": 1280,
                    "height": 720,
                    "aspect": "16:9",
                    "fps": 60,
                    "quality": "high",
                },
            }
        }
    )
    metadata = MediaMetadata(
        fileId=media_id,
        originalName="input.mp4",
        storageName=f"{media_id}.mp4",
        contentType="video/mp4",
        size=10,
        duration=10,
        width=1920,
        height=1080,
        fps=30,
        hasAudio=True,
        codec="h264",
        createdAt=datetime.now(UTC),
    )
    plan = build_ffmpeg_plan(
        request.project,
        {media_id: (metadata, tmp_path / "input.mp4")},
        tmp_path / "output.mp4",
    )

    filters = plan.filter_complex
    assert filters.index("crop=iw*") < filters.index("hflip,transpose=1")
    assert filters.index("hflip,transpose=1") < filters.index("scale=512:288")
    assert filters.index("scale=512:288") < filters.index("setpts=PTS-STARTPTS+2/TB")
    assert "atempo=2" in filters
    assert "volume=0.5" in filters
    assert "overlay=x=640:y=360" in filters
    assert "fps=60" in filters
    assert plan.duration == 4
    assert plan.argv[-1].endswith("output.mp4")
