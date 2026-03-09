import { BrowserWindow, screen } from 'electron';
import type { OverlayState } from '../shared/types.js';

function getOverlayBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(820, Math.max(420, workArea.width - 80));
  const height = 180;
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + 28,
  };
}

export function createOverlayWindow(preloadPath: string, overlayHtmlPath: string): BrowserWindow {
  const bounds = getOverlayBounds();
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setContentProtection(true);
  void window.loadFile(overlayHtmlPath);
  return window;
}

export function pushOverlayState(window: BrowserWindow, state: OverlayState): void {
  if (window.isDestroyed()) return;
  if (!window.webContents.isLoadingMainFrame()) {
    window.webContents.send('overlay:state', state);
  }

  if (state.visible) {
    if (!window.isVisible()) {
      window.showInactive();
    }
  } else if (window.isVisible()) {
    window.hide();
  }
}
