const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

ipcMain.handle('dialog:openMedia', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '미디어 열기',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mp3', 'wav', 'aac', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

async function createWindow() {
  Menu.setApplicationMenu(null);

  setupFFmpegPath();

  const dataDir = path.join(app.getPath('userData'), 'cadria-data');
  process.env.DATA_DIR = dataDir;
  process.env.HOST = '127.0.0.1';
  process.env.CADRIA_ALLOW_LOCAL_MEDIA = '1';

  const sessionToken = crypto.randomBytes(32).toString('hex');
  process.env.CADRIA_SESSION_TOKEN = sessionToken;

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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  try {
    const serverModulePath = path.join(__dirname, 'server', 'index.js');
    const { startServer } = require(serverModulePath);
    const server = await startServer({ port: 39017, host: '127.0.0.1', allowFallback: true });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 39017;
    const origin = `http://127.0.0.1:${port}`;
    await mainWindow.webContents.session.cookies.set({
      url: origin,
      name: 'cadria_token',
      value: sessionToken,
      path: '/',
      httpOnly: true,
      sameSite: 'lax'
    });
    await mainWindow.loadURL(origin);
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
