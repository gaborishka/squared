import { BrowserWindow, ipcMain } from 'electron';
import type { DesktopAppStatus, OverlayState } from '../shared/types.js';
import { pushOverlayState } from './overlay.js';

const hiddenState: OverlayState = {
  visible: false,
  mode: 'monitor',
  microPrompt: '',
  rescueText: '',
  slideTimeRemaining: null,
  currentSlide: null,
};

export interface IpcRegistration {
  setOverlayEnabled: (enabled: boolean) => void;
}

export function registerIpc(
  mainWindow: BrowserWindow,
  overlayWindow: BrowserWindow,
  options: {
    getOverlayEnabled: () => boolean;
    onStatusUpdate: (status: DesktopAppStatus) => void;
  },
): IpcRegistration {
  let overlayState = hiddenState;
  let overlayEnabled = options.getOverlayEnabled();

  const renderOverlay = () => {
    pushOverlayState(overlayWindow, overlayEnabled ? overlayState : hiddenState);
  };

  const handleOverlayUpdate = (_event: Electron.IpcMainEvent, nextState: OverlayState) => {
    overlayState = nextState;
    renderOverlay();
  };

  const handleOverlayClear = () => {
    overlayState = hiddenState;
    renderOverlay();
  };

  const handleAppStatusUpdate = (_event: Electron.IpcMainEvent, status: DesktopAppStatus) => {
    options.onStatusUpdate(status);
  };

  ipcMain.on('overlay:update', handleOverlayUpdate);
  ipcMain.on('overlay:clear', handleOverlayClear);
  ipcMain.on('app-status:update', handleAppStatusUpdate);

  overlayWindow.webContents.on('did-finish-load', () => {
    renderOverlay();
  });

  mainWindow.on('closed', () => {
    ipcMain.off('overlay:update', handleOverlayUpdate);
    ipcMain.off('overlay:clear', handleOverlayClear);
    ipcMain.off('app-status:update', handleAppStatusUpdate);
  });

  return {
    setOverlayEnabled: (enabled: boolean) => {
      overlayEnabled = enabled;
      renderOverlay();
    },
  };
}
