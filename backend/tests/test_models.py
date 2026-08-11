from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models import ExportRequest


def project_payload() -> dict:
    return {
        "project": {
            "version": 1,
            "background": {"type": "solid", "color": "#000000"},
            "tracks": [
                {
                    "id": "main",
                    "kind": "video",
                    "clips": [
                        {
                            "id": "clip-1",
                            "mediaId": str(uuid4()),
                            "sourceStart": 0,
                            "sourceEnd": 10,
                            "speed": 1,
                        }
                    ],
                }
            ],
            "export": {
                "width": 1280,
                "height": 720,
                "aspect": "16:9",
                "fps": 30,
                "quality": "standard",
            },
        }
    }


def test_camel_case_project_contract_is_accepted() -> None:
    request = ExportRequest.model_validate(project_payload())
    clip = request.project.tracks[0].clips[0]
    assert clip.output_duration == 10
    assert clip.crop.w == 1
    assert clip.audio.enabled is True


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("speed", 16.1),
        ("sourceEnd", 0),
    ],
)
def test_invalid_clip_values_are_rejected(field: str, value: object) -> None:
    payload = project_payload()
    payload["project"]["tracks"][0]["clips"][0][field] = value
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


def test_invalid_rotation_is_rejected() -> None:
    payload = project_payload()
    payload["project"]["tracks"][0]["clips"][0]["transform"] = {"rotation": 45}
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


def test_crop_must_stay_inside_normalized_source() -> None:
    payload = project_payload()
    payload["project"]["tracks"][0]["clips"][0]["crop"] = {
        "x": 0.8,
        "y": 0,
        "width": 0.3,
        "height": 1,
    }
    with pytest.raises(ValidationError, match="normalized source"):
        ExportRequest.model_validate(payload)


def test_output_dimensions_must_be_even() -> None:
    payload = project_payload()
    payload["project"]["export"]["width"] = 1279
    with pytest.raises(ValidationError, match="must be even"):
        ExportRequest.model_validate(payload)
