from __future__ import annotations

import asyncio
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

from app.config import Settings
from app.models import ExportRequest, JobResponse, JobStatus
from app.services.ffmpeg_builder import FfmpegPlan, build_ffmpeg_plan
from app.services.registry import MediaRegistry


TERMINAL_STATUSES = {
    JobStatus.completed,
    JobStatus.failed,
    JobStatus.cancelled,
}


@dataclass(slots=True)
class ExportJob:
    job_id: UUID
    plan: FfmpegPlan
    temporary_path: Path
    output_path: Path
    status: JobStatus = JobStatus.queued
    progress: float = 0
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    revision: int = 0
    task: asyncio.Task[None] | None = None
    process: asyncio.subprocess.Process | None = None
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)


class JobNotFoundError(KeyError):
    pass


class JobConflictError(RuntimeError):
    pass


class JobManager:
    def __init__(self, settings: Settings, registry: MediaRegistry) -> None:
        self.settings = settings
        self.registry = registry
        self.semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self.jobs: dict[UUID, ExportJob] = {}

    def create(self, request: ExportRequest) -> ExportJob:
        media_ids = {
            clip.media_id
            for track in request.project.tracks
            for clip in track.clips
        }
        if request.project.background.blur_source_id:
            media_ids.add(request.project.background.blur_source_id)
        resolved = self.registry.resolve_many(media_ids)
        job_id = uuid4()
        temporary = self.settings.output_dir / f".{job_id}.part.mp4"
        output = self.settings.output_dir / f"{job_id}.mp4"
        plan = build_ffmpeg_plan(request.project, resolved, temporary)
        job = ExportJob(job_id, plan, temporary, output)
        self.jobs[job_id] = job
        job.task = asyncio.create_task(self._run(job), name=f"export-{job_id}")
        return job

    def get(self, job_id: UUID) -> ExportJob:
        try:
            return self.jobs[job_id]
        except KeyError as exc:
            raise JobNotFoundError(str(job_id)) from exc

    def response(self, job: ExportJob) -> JobResponse:
        return JobResponse(
            job_id=job.job_id,
            status=job.status,
            progress=job.progress,
            duration=job.plan.duration,
            error=job.error,
            download_url=(
                f"/api/exports/{job.job_id}/download"
                if job.status == JobStatus.completed
                else None
            ),
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    async def _update(
        self,
        job: ExportJob,
        *,
        status: JobStatus | None = None,
        progress: float | None = None,
        error: str | None = None,
    ) -> None:
        if status is not None:
            job.status = status
        if progress is not None:
            job.progress = min(1, max(job.progress, progress))
        if error is not None:
            job.error = error
        job.updated_at = datetime.now(UTC)
        async with job.condition:
            job.revision += 1
            job.condition.notify_all()

    async def wait_for_update(
        self, job: ExportJob, revision: int, timeout: float = 15
    ) -> int:
        async with job.condition:
            await asyncio.wait_for(
                job.condition.wait_for(
                    lambda: job.revision != revision
                    or job.status in TERMINAL_STATUSES
                ),
                timeout,
            )
            return job.revision

    async def cancel(self, job_id: UUID) -> ExportJob:
        job = self.get(job_id)
        if job.status in TERMINAL_STATUSES:
            raise JobConflictError(f"job is already {job.status}")
        await self._update(job, status=JobStatus.cancelled)
        if job.task:
            job.task.cancel()
        return job

    async def shutdown(self) -> None:
        tasks = [
            job.task
            for job in self.jobs.values()
            if job.task is not None and not job.task.done()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _run(self, job: ExportJob) -> None:
        stderr_tail: deque[str] = deque(maxlen=80)
        stderr_task: asyncio.Task[None] | None = None
        try:
            async with self.semaphore:
                if job.status == JobStatus.cancelled:
                    return
                await self._update(job, status=JobStatus.running)
                job.process = await asyncio.create_subprocess_exec(
                    self.settings.ffmpeg,
                    *job.plan.argv,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                async def consume_stderr() -> None:
                    assert job.process and job.process.stderr
                    while line := await job.process.stderr.readline():
                        stderr_tail.append(line.decode(errors="replace").rstrip())

                stderr_task = asyncio.create_task(consume_stderr())
                assert job.process.stdout
                while line := await job.process.stdout.readline():
                    key, separator, value = line.decode(errors="replace").strip().partition("=")
                    if not separator:
                        continue
                    seconds: float | None = None
                    if key in {"out_time_ms", "out_time_us"}:
                        try:
                            seconds = int(value) / 1_000_000
                        except ValueError:
                            pass
                    elif key == "out_time":
                        try:
                            hours, minutes, seconds_text = value.split(":")
                            seconds = (
                                int(hours) * 3600
                                + int(minutes) * 60
                                + float(seconds_text)
                            )
                        except (ValueError, TypeError):
                            pass
                    if seconds is not None and job.plan.duration > 0:
                        await self._update(
                            job,
                            progress=min(0.999, seconds / job.plan.duration),
                        )
                return_code = await job.process.wait()
                await stderr_task
                job.process = None
                if return_code != 0:
                    message = "\n".join(stderr_tail)[-4000:]
                    raise RuntimeError(message or f"ffmpeg exited with {return_code}")
                os.replace(job.temporary_path, job.output_path)
                await self._update(
                    job, status=JobStatus.completed, progress=1
                )
        except asyncio.CancelledError:
            process = job.process
            if process and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except TimeoutError:
                    process.kill()
                    await process.wait()
            if job.status != JobStatus.cancelled:
                await self._update(job, status=JobStatus.cancelled)
        except Exception as exc:
            await self._update(
                job,
                status=JobStatus.failed,
                error=str(exc)[-4000:] or type(exc).__name__,
            )
        finally:
            if stderr_task and not stderr_task.done():
                stderr_task.cancel()
                await asyncio.gather(stderr_task, return_exceptions=True)
            job.process = None
            if job.status != JobStatus.completed:
                job.temporary_path.unlink(missing_ok=True)
                job.output_path.unlink(missing_ok=True)
