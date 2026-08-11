from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from app.models import ExportQuality, MediaMetadata, Project


@dataclass(frozen=True, slots=True)
class FfmpegPlan:
    argv: tuple[str, ...]
    filter_complex: str
    duration: float


def split_atempo(speed: float) -> tuple[float, ...]:
    if not 0.1 <= speed <= 16:
        raise ValueError("speed must be between 0.1 and 16")
    factors: list[float] = []
    remaining = speed
    while remaining > 2:
        factors.append(2.0)
        remaining /= 2
    while remaining < 0.5:
        factors.append(0.5)
        remaining /= 0.5
    factors.append(round(remaining, 6))
    return tuple(factors)


def _number(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def _even(value: float) -> int:
    rounded = max(2, round(value))
    return rounded if rounded % 2 == 0 else rounded + 1


def build_ffmpeg_plan(
    project: Project,
    media: dict[UUID, tuple[MediaMetadata, Path]],
    output_path: Path,
) -> FfmpegPlan:
    clips = [
        (track, clip)
        for track in project.tracks
        for clip in track.clips
    ]
    if not clips:
        raise ValueError("no clips to export")
    for _, clip in clips:
        if clip.media_id not in media:
            raise ValueError(f"missing media: {clip.media_id}")
        metadata, _ = media[clip.media_id]
        if clip.source_end > metadata.duration + 0.05:
            raise ValueError(f"clip {clip.id} exceeds media duration")

    total_duration = max(
        clip.timeline_start + clip.output_duration for _, clip in clips
    )
    media_ids = list(dict.fromkeys(clip.media_id for _, clip in clips))
    blur_id = project.background.blur_source_id
    if blur_id is not None and blur_id not in media_ids:
        if blur_id not in media:
            raise ValueError(f"missing blur media: {blur_id}")
        media_ids.append(blur_id)
    input_index = {media_id: index for index, media_id in enumerate(media_ids)}
    inputs: list[tuple[str, str]] = [
        ("file", str(media[media_id][1])) for media_id in media_ids
    ]

    filters: list[str] = []
    labels = 0

    def label(prefix: str) -> str:
        nonlocal labels
        labels += 1
        return f"{prefix}{labels}"

    width, height = project.width, project.height
    background = project.background
    color1 = background.color.removeprefix("#")
    duration = _number(total_duration)
    if background.type == "gradient":
        color2 = background.color2.removeprefix("#")
        filters.extend(
            (
                f"color=c=0x{color1}:s={width}x{height}:d={duration}[g1]",
                f"color=c=0x{color2}:s={width}x{height}:d={duration}[g2]",
                "[g1][g2]blend=all_expr='A*(1-Y/H)+B*(Y/H)'[bg]",
            )
        )
    elif background.type == "blur":
        assert blur_id is not None
        blur_index = input_index[blur_id]
        filters.append(
            f"[{blur_index}:v]scale={width}:{height}:"
            "force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur={_number(background.blur_radius)}:5,"
            f"setsar=1,tpad=stop_mode=clone:stop_duration={duration}[bg]"
        )
    else:
        filters.append(
            f"color=c=0x{color1}:s={width}x{height}:d={duration}[bg]"
        )

    visual: list[tuple[int, float, str, int, int, float, float]] = []
    audio_labels: list[str] = []
    for track_order, (track, clip) in enumerate(clips):
        index = input_index[clip.media_id]
        start = _number(clip.source_start)
        end = _number(clip.source_end)
        timeline_start = _number(clip.timeline_start)

        if track.type != "audio":
            current = label("trim")
            filters.append(
                f"[{index}:v]trim=start={start}:end={end},"
                f"setpts=PTS-STARTPTS[{current}]"
            )

            crop = clip.crop
            if crop.x or crop.y or crop.w < 1 or crop.h < 1:
                cropped = label("crop")
                filters.append(
                    f"[{current}]crop=iw*{_number(crop.w)}:ih*{_number(crop.h)}:"
                    f"iw*{_number(crop.x)}:ih*{_number(crop.y)}[{cropped}]"
                )
                current = cropped

            operations: list[str] = []
            transform = clip.transform
            if transform.flip_x:
                operations.append("hflip")
            if transform.flip_y:
                operations.append("vflip")
            if transform.rotation == 90:
                operations.append("transpose=1")
            elif transform.rotation == 180:
                operations.extend(("hflip", "vflip"))
            elif transform.rotation == 270:
                operations.append("transpose=2")
            if operations:
                transformed = label("orient")
                filters.append(f"[{current}]{','.join(operations)}[{transformed}]")
                current = transformed

            if clip.speed != 1:
                sped = label("speed")
                filters.append(
                    f"[{current}]setpts=PTS/{_number(clip.speed)}[{sped}]"
                )
                current = sped

            target_width = _even(transform.width * width * transform.scale)
            target_height = _even(transform.height * height * transform.scale)
            scaled = label("scale")
            filters.append(
                f"[{current}]scale={target_width}:{target_height},"
                f"setsar=1,format=rgba[{scaled}]"
            )
            positioned = label("position")
            filters.append(
                f"[{scaled}]setpts=PTS-STARTPTS+{timeline_start}/TB[{positioned}]"
            )
            visual.append(
                (
                    1 if track.type == "overlay" else 0,
                    clip.timeline_start,
                    positioned,
                    round(transform.x * width),
                    round(transform.y * height),
                    clip.timeline_start,
                    clip.timeline_start + clip.output_duration,
                )
            )

        metadata, _ = media[clip.media_id]
        audio = clip.audio
        if (
            metadata.has_audio
            and not track.muted
            and audio.enabled
            and not audio.mute
            and audio.volume > 0
        ):
            current_audio = label("atrim")
            filters.append(
                f"[{index}:a]atrim=start={start}:end={end},"
                f"asetpts=PTS-STARTPTS,aresample=48000[{current_audio}]"
            )
            if clip.speed != 1:
                for factor in split_atempo(clip.speed):
                    adjusted = label("atempo")
                    filters.append(
                        f"[{current_audio}]atempo={_number(factor)}[{adjusted}]"
                    )
                    current_audio = adjusted
            if audio.volume != 1:
                adjusted = label("volume")
                filters.append(
                    f"[{current_audio}]volume={_number(audio.volume)}[{adjusted}]"
                )
                current_audio = adjusted
            delayed = label("delay")
            delay_ms = round(clip.timeline_start * 1000)
            filters.append(
                f"[{current_audio}]adelay={delay_ms}|{delay_ms}[{delayed}]"
            )
            audio_labels.append(delayed)

    visual.sort(key=lambda item: (item[0], item[1]))
    base = "bg"
    for index, (_, _, video_label, x, y, start, end) in enumerate(visual):
        result = "vcomposed" if index == len(visual) - 1 else label("overlay")
        filters.append(
            f"[{base}][{video_label}]overlay=x={x}:y={y}:eof_action=pass:"
            f"enable='between(t\\,{_number(start)}\\,{_number(end)})'[{result}]"
        )
        base = result
    filters.append(
        f"[{base}]trim=duration={duration},setpts=PTS-STARTPTS,"
        f"fps={project.export.fps},format=yuv420p[vout]"
    )

    if audio_labels:
        joined = "".join(f"[{item}]" for item in audio_labels)
        if len(audio_labels) == 1:
            filters.append(
                f"{joined}atrim=duration={duration},asetpts=PTS-STARTPTS[aout]"
            )
        else:
            filters.append(
                f"{joined}amix=inputs={len(audio_labels)}:duration=longest:"
                "dropout_transition=0,"
                f"atrim=duration={duration},asetpts=PTS-STARTPTS[aout]"
            )
    else:
        silence_index = len(inputs)
        inputs.append(
            ("lavfi", "anullsrc=channel_layout=stereo:sample_rate=48000")
        )
        filters.append(
            f"[{silence_index}:a]atrim=duration={duration},"
            "asetpts=PTS-STARTPTS[aout]"
        )

    quality = {
        ExportQuality.draft: ("veryfast", "28"),
        ExportQuality.standard: ("medium", "23"),
        ExportQuality.high: ("slow", "18"),
    }[project.export.quality]
    argv: list[str] = ["-hide_banner", "-nostdin"]
    for kind, source in inputs:
        if kind == "lavfi":
            argv.extend(("-f", "lavfi", "-i", source))
        else:
            argv.extend(("-i", source))
    filter_complex = ";".join(filters)
    argv.extend(
        (
            "-filter_complex",
            filter_complex,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            project.export.video_codec,
            "-preset",
            quality[0],
            "-crf",
            quality[1],
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            project.export.audio_bitrate,
            "-movflags",
            "+faststart",
            "-t",
            duration,
            "-progress",
            "pipe:1",
            "-nostats",
            "-y",
            str(output_path),
        )
    )
    return FfmpegPlan(tuple(argv), filter_complex, total_duration)
