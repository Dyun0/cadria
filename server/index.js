const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { execFile } = require('child_process');
const { getSettings } = require('./config');
const { MediaRegistry, ingestUpload } = require('./services/media');
const { JobManager } = require('./services/jobs');

const settings = getSettings();
const registry = new MediaRegistry(settings);
const jobManager = new JobManager(settings, registry);

const upload = multer({
  dest: settings.uploadDir,
  limits: { fileSize: settings.maxUploadBytes }
});

const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// 1. Health check
app.get('/api/health', (req, res) => {
  execFile(settings.ffmpegBin, ['-version'], (err1) => {
    execFile(settings.ffprobeBin, ['-version'], (err2) => {
      const healthy = !err1 && !err2;
      res.status(healthy ? 200 : 503).json({
        ok: healthy,
        ffmpeg: { available: !err1 },
        ffprobe: { available: !err2 }
      });
    });
  });
});

// 2. Media Upload
const uploadHandler = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: 'No file uploaded' });
  }
  try {
    const result = await ingestUpload(req.file, settings, registry);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
};
app.post('/api/upload', upload.single('media'), uploadHandler);
app.post('/api/media', upload.single('media'), uploadHandler);

// 3. Stream Media
app.get('/api/media/:mediaId/stream', (req, res) => {
  try {
    const metadata = registry.getMetadata(req.params.mediaId);
    const filePath = registry.getMediaPath(metadata);
    res.sendFile(filePath);
  } catch (err) {
    res.status(404).json({ detail: 'Media not found' });
  }
});

// 4. Download Media
app.get('/api/media/:mediaId/download', (req, res) => {
  try {
    const metadata = registry.getMetadata(req.params.mediaId);
    const filePath = registry.getMediaPath(metadata);
    res.download(filePath, metadata.original_name);
  } catch (err) {
    res.status(404).json({ detail: 'Media not found' });
  }
});

// 5. Thumbnail
app.get('/api/media/:mediaId/thumbnail', (req, res) => {
  const thumbPath = registry.getThumbnailPath(req.params.mediaId);
  if (fs.existsSync(thumbPath)) {
    res.sendFile(thumbPath);
  } else {
    res.status(404).json({ detail: 'Thumbnail not found' });
  }
});

// 6. Export Jobs
const exportHandler = (req, res) => {
  try {
    const job = jobManager.createJob(req.body);
    res.status(202).json(jobManager.toResponse(job));
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
};
app.post('/api/export', exportHandler);
app.post('/api/exports', exportHandler);

app.get('/api/exports/:jobId', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.jobId);
    res.json(jobManager.toResponse(job));
  } catch (err) {
    res.status(404).json({ detail: err.message });
  }
});

// SSE Events
app.get('/api/exports/:jobId/events', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.jobId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendStatus = (j) => {
      res.write(`event: status\ndata: ${JSON.stringify(jobManager.toResponse(j))}\n\n`);
    };

    sendStatus(job);

    const listener = (updatedJob) => {
      sendStatus(updatedJob);
      if (['completed', 'failed', 'cancelled'].includes(updatedJob.status)) {
        res.end();
      }
    };

    job.listeners.add(listener);
    req.on('close', () => {
      job.listeners.delete(listener);
    });
  } catch (err) {
    res.status(404).json({ detail: err.message });
  }
});

app.delete('/api/exports/:jobId', (req, res) => {
  try {
    const job = jobManager.cancelJob(req.params.jobId);
    res.json(jobManager.toResponse(job));
  } catch (err) {
    res.status(400).json({ detail: err.message });
  }
});

app.get('/api/exports/:jobId/download', (req, res) => {
  try {
    const job = jobManager.getJob(req.params.jobId);
    if (job.status !== 'completed' || !fs.existsSync(job.outputPath)) {
      return res.status(409).json({ detail: 'Export is not completed' });
    }
    res.download(job.outputPath, `export_${job.job_id}.mp4`);
  } catch (err) {
    res.status(404).json({ detail: err.message });
  }
});

// SPA Static mount
if (fs.existsSync(settings.frontendDist)) {
  app.use(express.static(settings.frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(settings.frontendDist, 'index.html'));
  });
}

function startServer(port = 39017) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`🚀 Cadria Node.js Backend running at http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer(process.env.PORT || 39017);
}

module.exports = { app, startServer, settings };
