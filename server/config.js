const path = require('path');
const fs = require('fs');

function getSettings() {
  const rootDir = path.resolve(__dirname, '..');
  const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
  const uploadDir = process.env.UPLOAD_DIR || path.join(dataDir, 'media');
  const metadataDir = process.env.METADATA_DIR || path.join(dataDir, 'metadata');
  const thumbnailDir = process.env.THUMBNAIL_DIR || path.join(dataDir, 'thumbnails');
  const outputDir = process.env.OUTPUT_DIR || path.join(dataDir, 'exports');
  const frontendDist = process.env.FRONTEND_DIST || path.join(rootDir, 'frontend', 'dist');

  [dataDir, uploadDir, metadataDir, thumbnailDir, outputDir].forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });

  const appBinDir = path.join(rootDir, 'bin');
  const isWin = process.platform === 'win32';
  const ffmpegExe = path.join(appBinDir, isWin ? 'ffmpeg.exe' : 'ffmpeg');
  const ffprobeExe = path.join(appBinDir, isWin ? 'ffprobe.exe' : 'ffprobe');

  const ffmpegBin = process.env.FFMPEG_BIN || (fs.existsSync(ffmpegExe) ? ffmpegExe : 'ffmpeg');
  const ffprobeBin = process.env.FFPROBE_BIN || (fs.existsSync(ffprobeExe) ? ffprobeExe : 'ffprobe');

  return {
    rootDir,
    dataDir,
    uploadDir,
    metadataDir,
    thumbnailDir,
    outputDir,
    frontendDist,
    ffmpegBin,
    ffprobeBin,
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES || String(2 * 1024 * 1024 * 1024), 10)
  };
}

module.exports = { getSettings };
