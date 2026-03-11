import { BrowserWindow, ipcMain } from 'electron';
import type { DesktopAppStatus, PillState, SubtitleState } from '../shared/types.js';
import { pushPillState } from './statusPill.js';
import { pushSubtitleState } from './subtitles.js';

const hiddenPill: PillState = {
  visible: false,
  elapsed: '0:00',
  currentSlide: null,
  pace: '',
  eyeContact: '',
  posture: '',
  fillerCount: 0,
  confidenceScore: 0,
  overallScore: 0,
  agentMode: 'monitor',
  slideTimeRemaining: null,
};

const hiddenSubtitle: SubtitleState = {
  visible: false,
  mode: 'monitor',
  microPrompt: '',
  rescueText: '',
};

export interface IpcRegistration {
  setOverlayEnabled: (enabled: boolean) => void;
}

export function registerIpc(
  mainWindow: BrowserWindow,
  pillWindow: BrowserWindow,
  subtitlesWindow: BrowserWindow,
  options: {
    getOverlayEnabled: () => boolean;
    onStatusUpdate: (status: DesktopAppStatus) => void;
    onHideMainWindow: () => void;
    onShowMainWindow: () => void;
  },
): IpcRegistration {
  let pillState = hiddenPill;
  let subtitleState = hiddenSubtitle;
  let overlayEnabled = options.getOverlayEnabled();

  const renderPill = () => {
    pushPillState(pillWindow, overlayEnabled ? pillState : hiddenPill);
  };

  const renderSubtitles = () => {
    pushSubtitleState(subtitlesWindow, overlayEnabled ? subtitleState : hiddenSubtitle);
  };

  const handlePillUpdate = (_event: Electron.IpcMainEvent, state: PillState) => {
    pillState = state;
    renderPill();
  };

  const handleSubtitleUpdate = (_event: Electron.IpcMainEvent, state: SubtitleState) => {
    subtitleState = state;
    renderSubtitles();
  };

  const handleOverlayClear = () => {
    pillState = hiddenPill;
    subtitleState = hiddenSubtitle;
    renderPill();
    renderSubtitles();
  };

  const handleAppStatusUpdate = (_event: Electron.IpcMainEvent, status: DesktopAppStatus) => {
    options.onStatusUpdate(status);
  };

  const handleHideMainWindow = () => {
    options.onHideMainWindow();
  };

  const handleShowMainWindow = () => {
    options.onShowMainWindow();
  };

  const handleStopSession = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:stop');
    }
  };

  ipcMain.on('pill:update', handlePillUpdate);
  ipcMain.on('subtitle:update', handleSubtitleUpdate);
  ipcMain.on('overlay:clear', handleOverlayClear);
  ipcMain.on('app-status:update', handleAppStatusUpdate);
  ipcMain.on('main-window:hide', handleHideMainWindow);
  ipcMain.on('main-window:show', handleShowMainWindow);
  ipcMain.on('session:stop', handleStopSession);

  const cleanup = () => {
    ipcMain.off('pill:update', handlePillUpdate);
    ipcMain.off('subtitle:update', handleSubtitleUpdate);
    ipcMain.off('overlay:clear', handleOverlayClear);
    ipcMain.off('app-status:update', handleAppStatusUpdate);
    ipcMain.off('main-window:hide', handleHideMainWindow);
    ipcMain.off('main-window:show', handleShowMainWindow);
    ipcMain.off('session:stop', handleStopSession);
  };

  pillWindow.webContents.on('did-finish-load', () => renderPill());
  subtitlesWindow.webContents.on('did-finish-load', () => renderSubtitles());
  mainWindow.on('closed', cleanup);

  return {
    setOverlayEnabled: (enabled: boolean) => {
      overlayEnabled = enabled;
      renderPill();
      renderSubtitles();
    },
  };
}
