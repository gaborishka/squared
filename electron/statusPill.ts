import { BrowserWindow, screen } from 'electron';
import type { PillState } from '../shared/types.js';

function getPillBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 280;
  const height = 140;
  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
  };
}

export function createPillWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  const bounds = getPillBounds();
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
  window.setIgnoreMouseEvents(false);
  window.setContentProtection(true);
  void window.loadFile(htmlPath);
  return window;
}

export function pushPillState(window: BrowserWindow, state: PillState): void {
  if (window.isDestroyed()) return;
  if (!window.webContents.isLoadingMainFrame()) {
    window.webContents.send('pill:state', state);
  }

  if (state.visible) {
    if (!window.isVisible()) window.showInactive();
  } else if (window.isVisible()) {
    window.hide();
  }
}
