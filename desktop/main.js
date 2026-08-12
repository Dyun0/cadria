const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function setupFFmpegPath() {
  const isWin = process.platform === 'win32';
  const ffmpegName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = isWin ? 'ffprobe.exe' : 'ffprobe';

  const resourcesDir = process.resourcesPath || path.dirname(app.getAppPath());
  const candidateBins = [
    path.join(resourcesDir, 'bin'),
    path.join(app.getAppPath(), 'bin'),
    path.join(__dirname, 'bin')
  ];

  for (const binDir of candidateBins) {
    const ffmpegPath = path.join(binDir, ffmpegName);
    const ffprobePath = path.join(binDir, ffprobeName);
    if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
      process.env.FFMPEG_BIN = ffmpegPath;
      process.env.FFPROBE_BIN = ffprobePath;
      console.log(`✅ Using bundled FFmpeg at: ${ffmpegPath}`);
      return;
    }
  }

  console.log('⚠️ Bundled FFmpeg not found, falling back to system PATH.');
}

async function createWindow() {
  Menu.setApplicationMenu(null);

  setupFFmpegPath();

  const dataDir = path.join(app.getPath('userData'), 'cadria-data');
  process.env.DATA_DIR = dataDir;

  const frontendDistPath = path.join(__dirname, 'dist');
  process.env.FRONTEND_DIST = frontendDistPath;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'Cadria Studio',
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  try {
    const serverModulePath = path.join(__dirname, 'server', 'index.js');
    const { startServer } = require(serverModulePath);
    const PORT = 39017;
    await startServer(PORT);
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    dialog.showErrorBox('Cadria Studio Server Error', `서버 구동 실패:\n${err.stack || err.message}`);
    mainWindow.loadFile(path.join(frontendDistPath, 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
