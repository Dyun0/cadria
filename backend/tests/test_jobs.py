import asyncio
from pathlib import Path
from uuid import uuid4

import pytest

from app.config import Settings
from app.models import JobStatus
from app.services.ffmpeg_builder import FfmpegPlan
from app.services.jobs import ExportJob, JobConflictError, JobManager
from app.services.registry import MediaRegistry


def make_settings(tmp_path: Path, executable: Path) -> Settings:
    return Settings(
        root_dir=tmp_path,
        data_dir=tmp_path,
        upload_dir=tmp_path / "media",
        metadata_dir=tmp_path / "metadata",
        thumbnail_dir=tmp_path / "thumbs",
        output_dir=tmp_path / "outputs",
        frontend_dist=tmp_path / "dist",
        ffmpeg=str(executable),
        ffprobe="ffprobe",
        max_upload_bytes=1024,
        max_concurrent_jobs=1,
        cors_origins=("*",),
    )


@pytest.mark.asyncio
async def test_job_progress_and_atomic_completion(tmp_path) -> None:
    executable = tmp_path / "fake-ffmpeg"
    executable.write_text(
        "#!/usr/bin/env python3\n"
        "import pathlib, sys\n"
        "print('out_time_ms=500000', flush=True)\n"
        "pathlib.Path(sys.argv[-1]).write_bytes(b'complete')\n"
    )
    executable.chmod(0o755)
    settings = make_settings(tmp_path, executable)
    settings.ensure_directories()
    registry = MediaRegistry(
        settings.upload_dir, settings.metadata_dir, settings.thumbnail_dir
    )
    manager = JobManager(settings, registry)
    job_id = uuid4()
    temporary = settings.output_dir / ".part.mp4"
    output = settings.output_dir / "done.mp4"
    job = ExportJob(
        job_id,
        FfmpegPlan((str(temporary),), "null", 1),
        temporary,
        output,
    )
    manager.jobs[job_id] = job
    job.task = asyncio.create_task(manager._run(job))
    await job.task

    assert job.status == JobStatus.completed
    assert job.progress == 1
    assert output.read_bytes() == b"complete"
    assert not temporary.exists()


@pytest.mark.asyncio
async def test_queued_job_can_be_cancelled(tmp_path) -> None:
    executable = tmp_path / "unused"
    settings = make_settings(tmp_path, executable)
    settings.ensure_directories()
    manager = JobManager(
        settings,
        MediaRegistry(
            settings.upload_dir,
            settings.metadata_dir,
            settings.thumbnail_dir,
        ),
    )
    job_id = uuid4()
    temporary = settings.output_dir / ".part.mp4"
    job = ExportJob(
        job_id,
        FfmpegPlan((), "null", 1),
        temporary,
        settings.output_dir / "done.mp4",
    )
    manager.jobs[job_id] = job
    job.task = asyncio.create_task(asyncio.sleep(60))

    await manager.cancel(job_id)
    await asyncio.gather(job.task, return_exceptions=True)
    assert job.status == JobStatus.cancelled
    with pytest.raises(JobConflictError):
        await manager.cancel(job_id)
