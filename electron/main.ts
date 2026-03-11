import { app, BrowserWindow, desktopCapturer, dialog, session } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { registerIpc } from './ipc.js';
import { createPillWindow } from './statusPill.js';
import { createSubtitlesWindow } from './subtitles.js';
import { getElectronPaths } from './paths.js';
import { buildLocalUrl, DEFAULT_SERVER_PORT, findAvailablePort } from './runtime.js';
import { createAppTray } from './tray.js';
import type { DesktopAppStatus } from '../shared/types.js';
import { migrateLegacyAppData } from '../server/config/dataMigration.js';

let mainWindow: BrowserWindow | null = null;
let pillWindow: BrowserWindow | null = null;
let subtitlesWindow: BrowserWindow | null = null;
let bundledServer: ChildProcess | null = null;
let bundledServerPort: number | null = null;
let ipcRegistration: ReturnType<typeof registerIpc> | null = null;
let trayRegistration: ReturnType<typeof createAppTray> | null = null;
let overlayEnabled = true;
let appStatus: DesktopAppStatus = { mode: 'idle', connected: false };
const isDev = !app.isPackaged;
type ServerExitInfo = { code: number | null; signal: NodeJS.Signals | null };

function getStatusLabel(status: DesktopAppStatus): string {
  if (status.connected && status.mode === 'rehearsal') return 'Rehearsal active';
  if (status.connected && status.mode === 'presentation') return 'Presentation active';
  if (status.mode !== 'idle') return 'Connecting';
  return 'Ready';
}

function getBundledServerStartupError(exitInfo: ServerExitInfo | null): string {
  if (exitInfo === null) {
    return 'The bundled API server did not become ready in time.';
  }

  return `The bundled API server exited before it became ready (code: ${exitInfo.code ?? 'unknown'}, signal: ${exitInfo.signal ?? 'none'}).`;
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function refreshTray(): void {
  trayRegistration?.refresh();
}

function stopBundledServer(): void {
  if (!bundledServer) return;
  bundledServer.kill();
  bundledServer = null;
  bundledServerPort = null;
}

async function waitForBundledServer(url: string, timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Server is still starting up.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

function migratePackagedLegacyData(paths: ReturnType<typeof getElectronPaths>): void {
  if (isDev) return;

  const migration = migrateLegacyAppData({
    legacyRoots: [
      process.cwd(),
      paths.executableDir,
      path.resolve(paths.executableDir, '..'),
      path.resolve(paths.executableDir, '..', '..'),
      path.resolve(app.getAppPath(), '..'),
      path.resolve(app.getAppPath(), '..', '..'),
    ],
    currentDataRoot: paths.userDataPath,
  });

  if (migration.copiedDatabase || migration.copiedUploads) {
    console.log('Migrated legacy Squared desktop data', migration);
  }
}

async function ensureBundledServer(): Promise<number> {
  if (isDev) return DEFAULT_SERVER_PORT;
  if (bundledServer && bundledServerPort !== null) return bundledServerPort;

  const paths = getElectronPaths();
  migratePackagedLegacyData(paths);
  let startupExit: ServerExitInfo | null = null;
  const serverPort = await findAvailablePort(DEFAULT_SERVER_PORT);
  bundledServerPort = serverPort;
  bundledServer = fork(paths.serverEntry, [], {
    cwd: paths.userDataPath,
    env: {
      ...process.env,
      PORT: String(serverPort),
      SQUARED_DATA_DIR: paths.userDataPath,
      SQUARED_STATIC_DIR: paths.frontendDistDir,
    },
    stdio: 'inherit',
  });
  bundledServer.once('exit', (code, signal) => {
    startupExit = { code, signal };
    bundledServer = null;
  });
  bundledServer.once('error', (error) => {
    console.error('Bundled API server failed to start', error);
  });

  const isReady = await waitForBundledServer(`${buildLocalUrl(serverPort)}/api/health`);
  if (!isReady) {
    stopBundledServer();
    dialog.showErrorBox(
      'Squared failed to start',
      `${getBundledServerStartupError(startupExit)} Please reopen the app and try again.`,
    );
    throw new Error('Bundled server did not become ready.');
  }

  return serverPort;
}

function ensureTray(paths: ReturnType<typeof getElectronPaths>): void {
  if (trayRegistration) {
    refreshTray();
    return;
  }

  trayRegistration = createAppTray({
    iconPath: paths.trayIconPath,
    getStatusLabel: () => getStatusLabel(appStatus),
    isOverlayEnabled: () => overlayEnabled,
    onShowMainWindow: focusMainWindow,
    onToggleOverlay: (enabled) => {
      overlayEnabled = enabled;
      ipcRegistration?.setOverlayEnabled(enabled);
      refreshTray();
    },
    onQuit: () => {
      app.quit();
    },
  });
}

function isSquaredWindowSource(name: string): boolean {
  return /squared|status|subtitle/i.test(name);
}

function formatDisplaySourceLabel(source: Electron.DesktopCapturerSource): string {
  const prefix = source.id.startsWith('screen:') ? 'Screen' : 'Window';
  return `${prefix}: ${source.name}`;
}

async function chooseDisplaySource(parentWindow: BrowserWindow | null): Promise<Electron.DesktopCapturerSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });

  const rankedSources = [
    ...sources.filter((source) => source.id.startsWith('screen:')),
    ...sources.filter((source) => source.id.startsWith('window:') && !isSquaredWindowSource(source.name)),
  ];

  if (rankedSources.length === 0) {
    return null;
  }

  const selectableSources = rankedSources.slice(0, 8);
  const buttons = selectableSources.map(formatDisplaySourceLabel);
  buttons.push('Cancel');

  const dialogOptions = {
    type: 'question',
    title: 'Choose screen for ScreenAgent',
    message: 'Choose what ScreenAgent should watch',
    detail: 'Pick the presentation display or a slide window. If you cancel, delivery coaching will keep running without screen analysis.',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
    normalizeAccessKeys: true,
  } as const;
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);

  if (result.response >= selectableSources.length) {
    return null;
  }

  return selectableSources[result.response] ?? null;
}

function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!request.videoRequested) {
      callback({});
      return;
    }

    void chooseDisplaySource(mainWindow)
      .then((source) => {
        if (!source) {
          callback({});
          return;
        }
        callback({ video: source });
      })
      .catch((error) => {
        console.error('Failed to choose display media source', error);
        callback({});
      });
  }, { useSystemPicker: true });
}

async function createWindows(): Promise<void> {
  const paths = getElectronPaths();
  const serverPort = await ensureBundledServer();
  registerDisplayMediaHandler();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#09090b',
    title: 'Squared',
    webPreferences: {
      preload: paths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.error('Main window failed to load', { errorCode, errorDescription, validatedURL });
    dialog.showErrorBox(
      'Squared could not load the interface',
      'The desktop UI failed to load. Please reopen the app. If the problem continues, rebuild the desktop bundle.',
    );
  });

  pillWindow = createPillWindow(paths.preloadPath, paths.statusPillHtmlPath);
  subtitlesWindow = createSubtitlesWindow(paths.preloadPath, paths.subtitlesHtmlPath);
  ipcRegistration = registerIpc(mainWindow, pillWindow, subtitlesWindow, {
    getOverlayEnabled: () => overlayEnabled,
    onStatusUpdate: (status) => {
      appStatus = status;
      refreshTray();
    },
    onHideMainWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
    },
    onShowMainWindow: focusMainWindow,
  });
  ensureTray(paths);

  await mainWindow.loadURL(isDev ? paths.devServerUrl : buildLocalUrl(serverPort));

  // Ensure dock icon stays visible on macOS
  if (process.platform === 'darwin' && app.dock) {
    void app.dock.show();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.close();
    if (subtitlesWindow && !subtitlesWindow.isDestroyed()) subtitlesWindow.close();
    pillWindow = null;
    subtitlesWindow = null;
    ipcRegistration = null;
  });
}

app.whenReady().then(() => {
  void createWindows().catch((error) => {
    console.error('Failed to create Electron windows', error);
    app.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindows().catch((error) => {
        console.error('Failed to recreate Electron windows', error);
        app.exit(1);
      });
    } else {
      focusMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  trayRegistration?.destroy();
  trayRegistration = null;
  stopBundledServer();
});
