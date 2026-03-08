import { BrowserWindow, ipcMain } from 'electron';
import type { OverlayState } from '../shared/types.js';
import { pushOverlayState } from './overlay.js';

const hiddenState: OverlayState = {
  visible: false,
  mode: 'monitor',
  microPrompt: '',
  rescueText: '',
  slideTimeRemaining: null,
  currentSlide: null,
};

export function registerIpc(mainWindow: BrowserWindow, overlayWindow: BrowserWindow): void {
  let overlayState = hiddenState;

  ipcMain.on('overlay:update', (_event, nextState: OverlayState) => {
    overlayState = nextState;
    pushOverlayState(overlayWindow, overlayState);
  });

  ipcMain.on('overlay:clear', () => {
    overlayState = hiddenState;
    pushOverlayState(overlayWindow, overlayState);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    pushOverlayState(overlayWindow, overlayState);
  });

  mainWindow.on('closed', () => {
    ipcMain.removeAllListeners('overlay:update');
    ipcMain.removeAllListeners('overlay:clear');
  });
}
