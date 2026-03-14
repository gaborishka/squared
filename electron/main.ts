import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { registerIpc } from './ipc.js';
import { createPillWindow } from './statusPill.js';
import { createSubtitlesWindow } from './subtitles.js';
import { getElectronPaths } from './paths.js';
import { createAppTray } from './tray.js';
import type { DesktopAppStatus } from '../shared/types.js';
import { migrateLegacyAppData } from '../server/config/dataMigration.js';

const CUSTOM_PROTOCOL = 'squared';

let mainWindow: BrowserWindow | null = null;
let pillWindow: BrowserWindow | null = null;
let subtitlesWindow: BrowserWindow | null = null;
let ipcRegistration: ReturnType<typeof registerIpc> | null = null;
let trayRegistration: ReturnType<typeof createAppTray> | null = null;
let overlayEnabled = true;
let appStatus: DesktopAppStatus = { mode: 'idle', connected: false };
let desktopSessionId: string | null = null;
const isDev = !app.isPackaged;

function readRuntimeConfig(): { apiBaseUrl?: string; capturableOverlays?: boolean } {
  try {
    const raw = fs.readFileSync(getElectronPaths().runtimeConfigPath, 'utf8');
    return JSON.parse(raw) as { apiBaseUrl?: string; capturableOverlays?: boolean };
  } catch (error) {
    console.error('Failed to read desktop runtime config', error);
    return {};
  }
}

function getStatusLabel(status: DesktopAppStatus): string {
  if (status.connected && status.mode === 'rehearsal') return 'Rehearsal active';
  if (status.connected && status.mode === 'presentation') return 'Presentation active';
  if (status.mode !== 'idle') return 'Connecting';
  return 'Ready';
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

async function syncDesktopSessionToRenderer(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || !desktopSessionId) return;

  const encodedSessionId = JSON.stringify(desktopSessionId);
  await mainWindow.webContents.executeJavaScript(
    `try { window.localStorage.setItem('sq_desktop_session', ${encodedSessionId}); } catch {}`,
    true,
  ).catch((error) => {
    console.warn('Failed to sync desktop session to renderer', error);
  });
}

function resolveConfiguredBackendBaseUrl(): string | null {
  const runtimeValue = readRuntimeConfig().apiBaseUrl?.trim();
  if (runtimeValue) return runtimeValue.replace(/\/$/, '');

  const desktopEnvValue = process.env.DESKTOP_API_BASE_URL?.trim();
  if (desktopEnvValue) return desktopEnvValue.replace(/\/$/, '');

  const publicEnvValue = process.env.APP_URL?.trim();
  if (publicEnvValue) return publicEnvValue.replace(/\/$/, '');

  return null;
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
  return /squared|status|subtitle|source picker/i.test(name);
}

async function chooseDisplaySource(parentWindow: BrowserWindow | null): Promise<Electron.DesktopCapturerSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });

  const rankedSources = [
    ...sources.filter((source) => source.id.startsWith('screen:')),
    ...sources.filter((source) => source.id.startsWith('window:') && !isSquaredWindowSource(source.name)),
  ];

  if (rankedSources.length === 0) {
    return null;
  }

  const selectableSources = rankedSources.slice(0, 9);
  const paths = getElectronPaths();

  const pickerWindow = new BrowserWindow({
    width: 680,
    height: 500,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Choose Source',
    parent: parentWindow ?? undefined,
    modal: Boolean(parentWindow),
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: paths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  return new Promise<Electron.DesktopCapturerSource | null>((resolve) => {
    let resolved = false;

    const onSelect = (_event: Electron.IpcMainEvent, sourceId: string | null) => {
      if (resolved) return;
      resolved = true;
      const selected = sourceId
        ? selectableSources.find((s) => s.id === sourceId) ?? null
        : null;
      if (!pickerWindow.isDestroyed()) pickerWindow.close();
      resolve(selected);
    };

    const cleanup = () => {
      ipcMain.removeListener('picker:select', onSelect);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    };

    ipcMain.once('picker:select', onSelect);

    pickerWindow.on('closed', cleanup);

    void pickerWindow.loadFile(paths.sourcePickerHtmlPath).then(() => {
      const serialized = selectableSources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        type: s.id.startsWith('screen:') ? 'screen' : 'window',
      }));
      pickerWindow.webContents.send('picker:sources', serialized);
      pickerWindow.show();
    }).catch(() => {
      cleanup();
      if (!pickerWindow.isDestroyed()) pickerWindow.close();
    });
  });
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
  });
}

async function createWindows(): Promise<void> {
  const paths = getElectronPaths();
  migratePackagedLegacyData(paths);
  registerDisplayMediaHandler();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#09090b',
    title: 'Squared',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 20, y: 12 } : undefined,
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith(paths.devServerUrl)) return;
    if (!isDev && url.startsWith('file://')) return;
    if (!isAllowedExternalAuthUrl(url)) return;

    event.preventDefault();
    void shell.openExternal(normalizeDesktopAuthUrl(url));
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalAuthUrl(url)) {
      void shell.openExternal(normalizeDesktopAuthUrl(url));
    }
    return { action: 'deny' };
  });

  const capturable = readRuntimeConfig().capturableOverlays === true;
  console.log('[squared] capturableOverlays =', capturable);
  pillWindow = createPillWindow(paths.preloadPath, paths.statusPillHtmlPath, capturable);
  subtitlesWindow = createSubtitlesWindow(paths.preloadPath, paths.subtitlesHtmlPath, capturable);
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

  if (isDev) {
    await mainWindow.loadURL(paths.devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(paths.frontendDistDir, 'index.html'));
  }

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

  mainWindow.webContents.on('did-finish-load', () => {
    void syncDesktopSessionToRenderer();
  });
}

// --- Deep-link / custom protocol auth flow ---

function resolveBackendBaseUrl(): string {
  const backendBaseUrl = resolveConfiguredBackendBaseUrl();
  if (backendBaseUrl) return backendBaseUrl;

  dialog.showErrorBox(
    'Squared requires a backend URL',
    'Desktop uses the bundled frontend, but it still needs the backend base URL for auth and API requests. Configure APP_URL or dist-resources/electron/runtime-config.json.',
  );
  throw new Error('A backend base URL is required for desktop communication.');
}

function normalizeDesktopAuthUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/auth/google' && !parsed.searchParams.has('platform')) {
    parsed.searchParams.set('platform', 'desktop');
  }
  return parsed.toString();
}

function isAllowedExternalAuthUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(normalizeDesktopAuthUrl(url));
  } catch {
    return false;
  }

  const backendBaseUrl = resolveConfiguredBackendBaseUrl();
  if (!backendBaseUrl) return false;

  let backendOrigin: string;
  try {
    backendOrigin = new URL(backendBaseUrl).origin;
  } catch {
    return false;
  }

  return parsed.origin === backendOrigin && parsed.pathname === '/api/auth/google';
}

async function handleAuthDeepLink(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (parsed.host !== 'auth' || !parsed.pathname.startsWith('/callback')) return;

  const error = parsed.searchParams.get('error');
  if (error) {
    dialog.showErrorBox('Sign-in failed', 'Google sign-in did not complete. Please try again.');
    return;
  }

  const sessionId = parsed.searchParams.get('session');
  if (!sessionId) return;
  desktopSessionId = sessionId;

  // Set the session cookie in Electron's session so the webview is authenticated
  const backendBaseUrl = resolveBackendBaseUrl();
  await session.defaultSession.cookies.set({
    url: backendBaseUrl,
    name: 'sq_session',
    value: sessionId,
    path: '/',
    httpOnly: true,
    secure: backendBaseUrl.startsWith('https'),
    sameSite: 'lax',
    expirationDate: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
  });

  // Reload the main window to pick up the authenticated session
  if (mainWindow && !mainWindow.isDestroyed()) {
    await syncDesktopSessionToRenderer();
    focusMainWindow();
    mainWindow.reload();
  }
}

// Windows/Linux: handle deep links via second-instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // Register the custom protocol for deep-link auth (after acquiring the lock
  // so a second instance doesn't overwrite the first's protocol registration).
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL);
  }

  app.on('second-instance', (_event, argv) => {
    const deepLinkUrl = argv.find((arg) => arg.startsWith(`${CUSTOM_PROTOCOL}://`));
    if (deepLinkUrl) {
      void handleAuthDeepLink(deepLinkUrl);
    } else {
      focusMainWindow();
    }
  });
}

// macOS: handle deep links via open-url event (registered early for cold-start launches)
app.on('open-url', (event, url) => {
  event.preventDefault();
  void handleAuthDeepLink(url);
});

// IPC handler: open auth URL in system browser (validated to auth endpoints only)
ipcMain.on('auth:open-external', (_event, url: string) => {
  if (isAllowedExternalAuthUrl(url)) {
    void shell.openExternal(normalizeDesktopAuthUrl(url));
  } else {
    console.warn('Blocked openExternal for disallowed URL:', url);
  }
});

ipcMain.on('runtime-config:get', (event) => {
  event.returnValue = readRuntimeConfig();
});

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
});
