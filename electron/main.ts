import { app, BrowserWindow } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc.js';
import { createOverlayWindow } from './overlay.js';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let bundledServer: ChildProcess | null = null;

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const projectRoot = process.cwd();
const preloadPath = path.resolve(currentDir, 'preload.js');
const isDev = !app.isPackaged;

function resolveFrontendUrl(): string {
  if (isDev) return 'http://127.0.0.1:3000';
  return `file://${path.resolve(projectRoot, 'dist/index.html')}`;
}

function ensureBundledServer(): void {
  if (isDev || bundledServer) return;
  const serverEntry = path.resolve(projectRoot, 'dist-server/server/index.js');
  bundledServer = fork(serverEntry, [], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '3001' },
    stdio: 'inherit',
  });
}

async function createWindows(): Promise<void> {
  ensureBundledServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#09090b',
    title: 'Squared',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow = createOverlayWindow(preloadPath, projectRoot);
  registerIpc(mainWindow, overlayWindow);

  const frontendUrl = resolveFrontendUrl();
  if (frontendUrl.startsWith('file://')) {
    await mainWindow.loadURL(frontendUrl);
  } else {
    await mainWindow.loadURL(frontendUrl);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
    overlayWindow = null;
  });
}

app.whenReady().then(() => {
  void createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindows();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (bundledServer) {
    bundledServer.kill();
    bundledServer = null;
  }
});
