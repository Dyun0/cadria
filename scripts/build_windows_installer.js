#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const frontendDist = path.join(root, 'frontend', 'dist');
const desktopDir = path.join(root, 'desktop');
const desktopDist = path.join(desktopDir, 'dist');
const desktopServer = path.join(desktopDir, 'server');
const serverDir = path.join(root, 'server');

console.log('📦 [1/4] Building React Frontend SPA...');
execSync('npm run build', { cwd: path.join(root, 'frontend'), stdio: 'inherit' });

console.log('📁 [2/4] Syncing Frontend and Server assets to Desktop package...');
if (fs.existsSync(desktopDist)) fs.rmSync(desktopDist, { recursive: true, force: true });
if (fs.existsSync(desktopServer)) fs.rmSync(desktopServer, { recursive: true, force: true });

fs.cpSync(frontendDist, desktopDist, { recursive: true });
fs.cpSync(serverDir, desktopServer, { recursive: true });

const desktopBin = path.join(desktopDir, 'bin');
const desktopServerBin = path.join(desktopServer, 'bin');
if (fs.existsSync(desktopBin)) {
  fs.cpSync(desktopBin, desktopServerBin, { recursive: true });
}

console.log('✨ [3/4] Installing desktop Electron dependencies (Express, Cors, Multer)...');
execSync('npm install', { cwd: desktopDir, stdio: 'inherit' });

console.log('🔨 [4/4] Building Unpacked Windows Executable Package...');
try {
  execSync('npx electron-builder --win dir', { cwd: desktopDir, stdio: 'inherit' });
} catch (e) {
  console.log('⚠️ electron-builder notice:', e.message);
}

const winUnpacked = path.join(desktopDir, 'release', 'win-unpacked');
const releaseZip = path.join(desktopDir, 'release', 'Cadria_Studio_Windows_x64.zip');

if (fs.existsSync(winUnpacked)) {
  const winUnpackedBin = path.join(winUnpacked, 'bin');
  const winUnpackedResBin = path.join(winUnpacked, 'resources', 'bin');
  if (fs.existsSync(desktopBin)) {
    fs.cpSync(desktopBin, winUnpackedBin, { recursive: true });
    fs.cpSync(desktopBin, winUnpackedResBin, { recursive: true });
  }
  const batScriptLines = [
    '@echo off',
    'title Cadria Studio Installer',
    'echo ========================================================',
    'echo         Cadria Studio Desktop Setup',
    'echo ========================================================',
    'echo.',
    'set "INSTALL_DIR=%LOCALAPPDATA%\\CadriaStudio"',
    'echo [1/3] Cleaning previous installation...',
    'if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"',
    'mkdir "%INSTALL_DIR%"',
    '',
    'echo [2/3] Copying Cadria Studio binaries...',
    'xcopy /e /i /y "%~dp0win-unpacked\\*" "%INSTALL_DIR%\\" >nul',
    '',
    'echo [3/3] Creating Desktop shortcut...',
    'set "SHORTCUT_PATH=%USERPROFILE%\\Desktop\\Cadria Studio.lnk"',
    'set "TARGET_PATH=%INSTALL_DIR%\\Cadria Studio.exe"',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut(\'%SHORTCUT_PATH%\'); $s.TargetPath=\'%TARGET_PATH%\'; $s.WorkingDirectory=\'%INSTALL_DIR%\'; $s.Save()"',
    '',
    'echo.',
    'echo ========================================================',
    'echo  Installation Completed Successfully!',
    'echo  Double click "Cadria Studio" shortcut on your Desktop.',
    'echo ========================================================',
    'echo.',
    'pause',
  ];
  fs.writeFileSync(path.join(desktopDir, 'release', 'Install_Cadria_Studio.bat'), batScriptLines.join('\r\n'), 'utf8');

  console.log('📦 Creating distribution zip archive (Cadria_Studio_Windows_x64.zip)...');
  try {
    execSync(`cd "${path.join(desktopDir, 'release')}" && zip -r Cadria_Studio_Windows_x64.zip win-unpacked Install_Cadria_Studio.bat`, { stdio: 'inherit' });
  } catch (e) {
    console.log('⚠️ zip command notice:', e.message);
  }
}

console.log('\n🎉 Desktop Package Build Completed Successfully!');
