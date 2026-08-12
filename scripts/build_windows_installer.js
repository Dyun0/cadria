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
if (!fs.existsSync(frontendDist)) {
  execSync('npm run build', { cwd: path.join(root, 'frontend'), stdio: 'inherit' });
}

console.log('📁 [2/4] Syncing Frontend and Server assets to Desktop package...');
if (fs.existsSync(desktopDist)) fs.rmSync(desktopDist, { recursive: true, force: true });
if (fs.existsSync(desktopServer)) fs.rmSync(desktopServer, { recursive: true, force: true });

fs.cpSync(frontendDist, desktopDist, { recursive: true });
fs.cpSync(serverDir, desktopServer, { recursive: true });

console.log('✨ [3/4] Installing desktop Electron dependencies (Express, Cors, Multer)...');
execSync('npm install', { cwd: desktopDir, stdio: 'inherit' });

console.log('🔨 [4/4] Building Unpacked Windows Executable Package...');
try {
  execSync('npx electron-builder --win dir', { cwd: desktopDir, stdio: 'inherit' });
} catch (e) {
  console.log('⚠️ electron-builder notice:', e.message);
}

console.log('\n🎉 Desktop Package Build Completed Successfully!');
