import { BrowserWindow, screen } from 'electron';
import type { SubtitleState } from '../shared/types.js';

function getSubtitleBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(720, workArea.width - 80);
  const height = 180;
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 40,
  };
}

export function createSubtitlesWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  const bounds = getSubtitleBounds();
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
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
  void window.loadFile(htmlPath);
  return window;
}

export function pushSubtitleState(window: BrowserWindow, state: SubtitleState): void {
  if (window.isDestroyed()) return;

  // Keep window always shown — it's transparent, so invisible when bar is hidden via CSS.
  // Avoids macOS panel window hide/show issues.
  if (!window.isVisible()) window.showInactive();

  if (!window.webContents.isLoadingMainFrame()) {
    window.webContents.send('subtitle:state', state);
  }
}
