const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

function runCommand(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message));
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseFps(str) {
  if (!str) return 0;
  const parts = str.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]) || 1;
    return num / den;
  }
  return parseFloat(str) || 0;
}

const IMAGE_CODECS = new Set(['mjpeg', 'jpeg2000', 'png', 'gif', 'webp', 'bmp', 'tiff', 'heif', 'heic']);

async function probeMedia(ffprobeBin, mediaPath) {
  const { stdout } = await runCommand(ffprobeBin, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    mediaPath
  ]);

  let data;
  try {
    data = JSON.parse(stdout);
  } catch (e) {
    throw new Error('Invalid ffprobe output');
  }

  const streams = data.streams || [];
  const video = streams.find(s => s.codec_type === 'video');
  const audio = streams.find(s => s.codec_type === 'audio');

  if (!video || !video.width || !video.height) {
    throw new Error('Uploaded file has no valid video stream');
  }

  // 이미지 파일 판별 (duration/fps 없음)
  const isImage = IMAGE_CODECS.has(video.codec_name) ||
    video.nb_frames === '1' ||
    (video.r_frame_rate === '25/1' && !data.format?.duration && video.codec_name !== 'h264');

  if (isImage) {
    return {
      duration: 5,  // 기본 5초로 타임라인에 배치
      width: parseInt(video.width, 10),
      height: parseInt(video.height, 10),
      fps: 1,
      has_audio: false,
      codec: video.codec_name || 'mjpeg',
      is_image: true
    };
  }

  const duration = parseFloat(data.format?.duration || video.duration || 0);
  const fps = parseFps(video.avg_frame_rate || video.r_frame_rate);

  if (duration <= 0 || fps <= 0) {
    throw new Error('Invalid video duration or frame rate');
  }

  return {
    duration,
    width: parseInt(video.width, 10),
    height: parseInt(video.height, 10),
    fps,
    has_audio: Boolean(audio),
    codec: video.codec_name || 'h264',
    is_image: false
  };
}

async function generateThumbnail(ffmpegBin, sourcePath, destPath, duration, isImage = false) {
  const args = isImage
    ? ['-v', 'error', '-i', sourcePath, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', destPath]
    : ['-v', 'error', '-ss', Math.min(Math.max(duration * 0.1, 0), 5).toFixed(2), '-i', sourcePath, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', destPath];
  await runCommand(ffmpegBin, args, 120000);
}

class MediaRegistry {
  constructor(settings) {
    this.settings = settings;
  }

  getMetadataPath(mediaId) {
    return path.join(this.settings.metadataDir, `${mediaId}.json`);
  }

  getThumbnailPath(mediaId) {
    return path.join(this.settings.thumbnailDir, `${mediaId}.jpg`);
  }

  saveMetadata(metadata) {
    const filePath = this.getMetadataPath(metadata.media_id);
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  getMetadata(mediaId) {
    const filePath = this.getMetadataPath(mediaId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Media not found: ${mediaId}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  }

  getMediaPath(metadata) {
    return path.join(this.settings.uploadDir, metadata.storage_name);
  }
}

async function ingestUpload(file, settings, registry) {
  const mediaId = uuidv4();
  const ext = path.extname(file.originalname || '').toLowerCase() || '.mp4';
  const storageName = `${mediaId}${ext}`;
  const finalPath = path.join(settings.uploadDir, storageName);

  fs.renameSync(file.path, finalPath);

  try {
    const probed = await probeMedia(settings.ffprobeBin, finalPath);
    const thumbnailPath = registry.getThumbnailPath(mediaId);
    await generateThumbnail(settings.ffmpegBin, finalPath, thumbnailPath, probed.duration, probed.is_image);

    const metadata = {
      media_id: mediaId,
      fileId: mediaId,
      original_name: file.originalname || 'video',
      storage_name: storageName,
      content_type: file.mimetype || 'video/mp4',
      size: file.size,
      created_at: new Date().toISOString(),
      ...probed
    };

    registry.saveMetadata(metadata);

    return {
      fileId: mediaId,
      media_id: mediaId,
      filename: mediaId,
      original_name: metadata.original_name,
      url: `/api/media/${mediaId}/stream`,
      thumbnail_url: `/api/media/${mediaId}/thumbnail`,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      has_audio: metadata.has_audio,
      codec: metadata.codec,
      is_image: metadata.is_image || false
    };
  } catch (err) {
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
    const thumb = registry.getThumbnailPath(mediaId);
    if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    throw err;
  }
}

module.exports = { MediaRegistry, ingestUpload, probeMedia, generateThumbnail };
