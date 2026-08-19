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

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return '';
}

function configureCors() {
  const raw = process.env.CORS_ORIGINS;
  if (raw === '*') return cors();
  if (raw) {
    const allow = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return cors({ origin: allow, credentials: true });
  }
  return cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host === '127.0.0.1' || host === 'localhost') return cb(null, true);
      } catch (_) { /* ignore */ }
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true
  });
}

const app = express();

app.use(configureCors());
app.use(express.json({ limit: '100mb' }));

const sessionToken = process.env.CADRIA_SESSION_TOKEN || '';
if (sessionToken) {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const provided = req.get('x-cadria-token') || req.query.token || cookieValue(req, 'cadria_token');
    if (provided === sessionToken) return next();
    res.status(401).json({ detail: 'Unauthorized' });
  });
}

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

app.post('/api/media/local', async (req, res) => {
  if (process.env.CADRIA_ALLOW_LOCAL_MEDIA !== '1') {
    return res.status(404).json({ detail: 'Not found' });
  }
  const src = req.body && req.body.path;
  if (typeof src !== 'string' || !path.isAbsolute(src)) {
    return res.status(400).json({ detail: 'Invalid path' });
  }
  let stat;
  try {
    stat = fs.statSync(src);
  } catch (_) {
    return res.status(400).json({ detail: 'File not found' });
  }
  if (!stat.isFile()) {
    return res.status(400).json({ detail: 'File not found' });
  }
  const tmpPath = path.join(settings.uploadDir, `local-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    fs.copyFileSync(src, tmpPath);
    const result = await ingestUpload({
      path: tmpPath,
      originalname: path.basename(src),
      mimetype: 'application/octet-stream',
      size: stat.size
    }, settings, registry);
    res.status(201).json(result);
  } catch (err) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    res.status(400).json({ detail: err.message });
  }
});

// 3. Stream Media
app.get('/api/media/:mediaId/stream', (req, res) => {
  try {
    const metadata = registry.getMetadata(req.params.mediaId);
    const previewPath = registry.getPreviewPath(req.params.mediaId);
    if (fs.existsSync(previewPath)) {
      return res.sendFile(previewPath);
    }
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
    const safeName = (job.project_name || 'exported_video').replace(/[\\/:*?"<>|]/g, '_');
    const ext = path.extname(job.outputPath) || '.mp4';
    res.download(job.outputPath, `${safeName}${ext}`);
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

function startServer(portOrOpts, hostArg) {
  const opts = (portOrOpts && typeof portOrOpts === 'object')
    ? portOrOpts
    : { port: portOrOpts, host: hostArg };
  const host = opts.host || process.env.HOST || '127.0.0.1';
  const preferredPort = Number(opts.port || process.env.PORT || 39017);
  const allowFallback = opts.allowFallback ?? !process.env.PORT;

  const listen = (port) => new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`🚀 Cadria Node.js Backend running at http://${host}:${actualPort}`);
      resolve(server);
    });
    server.once('error', (err) => {
      server.close(() => {});
      reject(err);
    });
  });

  return (async () => {
    if (!allowFallback) return listen(preferredPort);
    for (let i = 0; i <= 30; i += 1) {
      try {
        return await listen(preferredPort + i);
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
        console.warn(`Port ${preferredPort + i} in use, trying next...`);
      }
    }
    return listen(0);
  })();
}

if (require.main === module) {
  startServer({
    port: process.env.PORT || 39017,
    host: process.env.HOST || '127.0.0.1',
    allowFallback: !process.env.PORT
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, startServer, settings };
