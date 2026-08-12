const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { buildFfmpegPlan } = require('./ffmpeg_builder');

class JobManager {
  constructor(settings, registry) {
    this.settings = settings;
    this.registry = registry;
    this.jobs = new Map();
  }

  createJob(exportRequest) {
    const project = exportRequest.project;
    const mediaIds = new Set();
    for (const track of project.tracks || []) {
      for (const clip of track.clips || []) {
        const id = clip.media_id || clip.mediaId;
        if (id) mediaIds.add(id);
      }
    }
    const blurId = project.background?.blur_source_id || project.background?.blurSourceId;
    if (blurId) mediaIds.add(blurId);

    const resolvedMap = {};
    for (const id of mediaIds) {
      const metadata = this.registry.getMetadata(id);
      const filePath = this.registry.getMediaPath(metadata);
      resolvedMap[id] = { metadata, path: filePath };
    }

    const jobId = uuidv4();
    const isAvi = (project.export?.format || '').toLowerCase() === 'avi';
    const ext = isAvi ? '.avi' : '.mp4';
    const tempPath = path.join(this.settings.outputDir, `.${jobId}.part${ext}`);
    const outputPath = path.join(this.settings.outputDir, `${jobId}${ext}`);

    const plan = buildFfmpegPlan(project, resolvedMap, tempPath);

    const job = {
      job_id: jobId,
      project_name: project.name || 'exported_video',
      status: 'queued',
      progress: 0,
      duration: plan.duration,
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tempPath,
      outputPath,
      plan,
      listeners: new Set(),
      process: null
    };

    this.jobs.set(jobId, job);
    this.runJob(job);
    return job;
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Export job not found: ${jobId}`);
    return job;
  }

  updateJob(job, updates) {
    Object.assign(job, updates, { updated_at: new Date().toISOString() });
    for (const listener of job.listeners) {
      listener(job);
    }
  }

  cancelJob(jobId) {
    const job = this.getJob(jobId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      throw new Error(`Job is already ${job.status}`);
    }
    this.updateJob(job, { status: 'cancelled' });
    if (job.process && !job.process.killed) {
      job.process.kill('SIGKILL');
    }
    return job;
  }

  runJob(job) {
    if (job.status === 'cancelled') return;
    this.updateJob(job, { status: 'running' });

    const proc = spawn(this.settings.ffmpegBin, job.plan.argv, {
      windowsHide: true
    });
    job.process = proc;

    let stderrBuffer = '';
    const parseProgress = (data) => {
      const text = data.toString();
      stderrBuffer += text;
      if (stderrBuffer.length > 5000) stderrBuffer = stderrBuffer.slice(-5000);

      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        let seconds = null;
        if (trimmed.includes('=')) {
          const [key, val] = trimmed.split('=');
          if (key === 'out_time_us') {
            const us = parseInt(val, 10);
            if (!isNaN(us) && us > 0) seconds = us / 1000000;
          } else if (key === 'out_time') {
            const parts = val.split(':');
            if (parts.length === 3) {
              const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10), s = parseFloat(parts[2]);
              if (!isNaN(h) && !isNaN(m) && !isNaN(s)) seconds = h * 3600 + m * 60 + s;
            }
          }
        }

        if (seconds !== null && !isNaN(seconds) && seconds > 0 && job.duration > 0) {
          const calculated = Math.min(99, Math.max(1, Math.floor((seconds / job.duration) * 100)));
          // Monotonic Increase Guard: Progress strictly increases during active rendering
          if (calculated > job.progress && calculated < 100) {
            this.updateJob(job, { progress: calculated });
          }
        }
      }
    };

    proc.stdout.on('data', parseProgress);
    proc.stderr.on('data', data => {
      stderrBuffer += data.toString();
      if (stderrBuffer.length > 5000) stderrBuffer = stderrBuffer.slice(-5000);
    });

    proc.on('close', code => {
      job.process = null;
      if (job.status === 'cancelled') {
        if (fs.existsSync(job.tempPath)) fs.unlinkSync(job.tempPath);
        if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
        return;
      }

      if (code === 0 && fs.existsSync(job.tempPath)) {
        fs.renameSync(job.tempPath, job.outputPath);
        this.updateJob(job, { status: 'completed', progress: 100 });
      } else {
        const errMessage = stderrBuffer.slice(-2000) || `FFmpeg process exited with code ${code}`;
        this.updateJob(job, { status: 'failed', error: errMessage });
        if (fs.existsSync(job.tempPath)) fs.unlinkSync(job.tempPath);
        if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
      }
    });

    proc.on('error', err => {
      job.process = null;
      this.updateJob(job, { status: 'failed', error: err.message });
      if (fs.existsSync(job.tempPath)) fs.unlinkSync(job.tempPath);
    });
  }

  toResponse(job) {
    return {
      job_id: job.job_id,
      status: job.status,
      progress: job.progress,
      duration: job.duration,
      error: job.error,
      download_url: job.status === 'completed' ? `/api/exports/${job.job_id}/download` : null,
      created_at: job.created_at,
      updated_at: job.updated_at
    };
  }
}

module.exports = { JobManager };
