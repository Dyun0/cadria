#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const frontendDir = path.join(root, 'frontend');
const frontendDist = path.join(frontendDir, 'dist');
const desktopDir = path.join(root, 'desktop');
const desktopDist = path.join(desktopDir, 'dist');
const desktopServer = path.join(desktopDir, 'server');
const desktopBin = path.join(desktopDir, 'bin');
const serverDir = path.join(root, 'server');

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function npmInstall(dir) {
  run('npm install', dir);
}

function copyServer() {
  fs.cpSync(serverDir, desktopServer, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(serverDir, src);
      if (!rel || rel === '.') return true;
      const parts = rel.split(path.sep);
      return !parts.includes('node_modules') && parts[0] !== 'data';
    }
  });
}

function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

function download(url, dest) {
  execSync(`curl -L --fail --retry 3 --retry-delay 2 -o "${dest}" "${url}"`, { stdio: 'inherit' });
}

function ensureWindowsFfmpeg() {
  fs.mkdirSync(desktopBin, { recursive: true });
  const ffmpegDest = path.join(desktopBin, 'ffmpeg.exe');
  const ffprobeDest = path.join(desktopBin, 'ffprobe.exe');
  if (fs.existsSync(ffmpegDest) && fs.existsSync(ffprobeDest)) {
    console.log('✅ Windows FFmpeg already present in desktop/bin');
    return;
  }

  console.log('⬇️  Downloading Windows FFmpeg/ffprobe...');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadria-ffmpeg-'));
  const sources = [
    {
      ffmpeg: 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip',
      ffprobe: 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-win-64.zip'
    },
    {
      bundle: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    }
  ];

  let lastError;
  for (const source of sources) {
    try {
      if (source.bundle) {
        const zip = path.join(tmp, 'ffmpeg-bundle.zip');
        download(source.bundle, zip);
        execSync(`unzip -o "${zip}" -d "${tmp}"`, { stdio: 'inherit' });
      } else {
        const ffmpegZip = path.join(tmp, 'ffmpeg.zip');
        const ffprobeZip = path.join(tmp, 'ffprobe.zip');
        download(source.ffmpeg, ffmpegZip);
        download(source.ffprobe, ffprobeZip);
        execSync(`unzip -o "${ffmpegZip}" -d "${tmp}"`, { stdio: 'inherit' });
        execSync(`unzip -o "${ffprobeZip}" -d "${tmp}"`, { stdio: 'inherit' });
      }
      const ffmpegSrc = findFile(tmp, 'ffmpeg.exe');
      const ffprobeSrc = findFile(tmp, 'ffprobe.exe');
      if (!ffmpegSrc || !ffprobeSrc) {
        throw new Error('zip 안에 ffmpeg.exe/ffprobe.exe가 없습니다');
      }
      fs.copyFileSync(ffmpegSrc, ffmpegDest);
      fs.copyFileSync(ffprobeSrc, ffprobeDest);
      console.log('✅ Bundled FFmpeg into desktop/bin');
      return;
    } catch (err) {
      lastError = err;
      console.warn('⚠️ FFmpeg download source failed:', err.message);
    }
  }

  throw lastError || new Error('Windows FFmpeg 다운로드에 실패했습니다');
}

console.log('📦 [1/5] Installing frontend dependencies and building SPA...');
npmInstall(frontendDir);
run('npm run build', frontendDir);

console.log('📁 [2/5] Syncing frontend and server into desktop package...');
if (fs.existsSync(desktopDist)) fs.rmSync(desktopDist, { recursive: true, force: true });
if (fs.existsSync(desktopServer)) fs.rmSync(desktopServer, { recursive: true, force: true });
fs.cpSync(frontendDist, desktopDist, { recursive: true });
copyServer();

console.log('⬇️  [3/5] Ensuring bundled Windows FFmpeg...');
ensureWindowsFfmpeg();

console.log('✨ [4/5] Installing desktop Electron dependencies...');
npmInstall(desktopDir);

console.log('🔨 [5/5] Building Windows NSIS installer...');
const cacheDir = path.join(root, '.cache');
fs.mkdirSync(path.join(cacheDir, 'electron-builder'), { recursive: true });
fs.mkdirSync(path.join(cacheDir, 'electron'), { recursive: true });
const builderEnv = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  ELECTRON_BUILDER_CACHE: path.join(cacheDir, 'electron-builder'),
  ELECTRON_CACHE: path.join(cacheDir, 'electron')
};
const hasBin = (name) => {
  try {
    execSync(`command -v ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
if (process.platform !== 'win32' && !hasBin('wine') && !hasBin('wine64') && hasBin('docker')) {
  console.log('Wine 없음 → electronuserland/builder:wine 컨테이너로 NSIS 빌드');
  execSync([
    'docker run --rm',
    '-e CSC_IDENTITY_AUTO_DISCOVERY=false',
    `-e ELECTRON_CACHE=/project/.cache/electron`,
    `-e ELECTRON_BUILDER_CACHE=/project/.cache/electron-builder`,
    `-v "${root}:/project"`,
    '-w /project/desktop',
    'electronuserland/builder:wine',
    'npx electron-builder --win nsis'
  ].join(' '), { stdio: 'inherit', env: builderEnv });
} else {
  execSync('npx electron-builder --win nsis', {
    cwd: desktopDir,
    stdio: 'inherit',
    env: builderEnv
  });
}

const setupExe = path.join(desktopDir, 'release', 'Cadria_Studio_Setup_1.0.0.exe');
if (!fs.existsSync(setupExe)) {
  throw new Error(`설치 파일이 생성되지 않았습니다: ${setupExe}`);
}

console.log('\n🎉 NSIS installer built:');
console.log(`   ${setupExe}`);
