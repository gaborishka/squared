import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAppStatus, PillState, SubtitleState } from '../shared/types.js';

function readRuntimeConfig(): { apiBaseUrl?: string } {
  try {
    return ipcRenderer.sendSync('runtime-config:get') as { apiBaseUrl?: string };
  } catch {
    return {};
  }
}

const runtimeConfig = readRuntimeConfig();

contextBridge.exposeInMainWorld('squaredElectron', {
  isElectron: true,
  platform: process.platform,
  runtimeConfig,

  // Auth: open URL in system browser for Google sign-in
  openExternalAuth: (url: string) => ipcRenderer.send('auth:open-external', url),

  clearOverlay: () => ipcRenderer.send('overlay:clear'),

  // Pill + subtitles
  updatePill: (state: PillState) => ipcRenderer.send('pill:update', state),
  updateSubtitles: (state: SubtitleState) => ipcRenderer.send('subtitle:update', state),
  onPillState: (listener: (state: PillState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PillState) => listener(state);
    ipcRenderer.on('pill:state', handler);
    return () => ipcRenderer.removeListener('pill:state', handler);
  },
  onSubtitleState: (listener: (state: SubtitleState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SubtitleState) => listener(state);
    ipcRenderer.on('subtitle:state', handler);
    return () => ipcRenderer.removeListener('subtitle:state', handler);
  },

  // Main window hide/show
  hideMainWindow: () => ipcRenderer.send('main-window:hide'),
  showMainWindow: () => ipcRenderer.send('main-window:show'),

  // Stop session (from pill Stop button)
  stopSession: () => ipcRenderer.send('session:stop'),
  onStopSession: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('session:stop', handler);
    return () => ipcRenderer.removeListener('session:stop', handler);
  },

  // App status
  setAppStatus: (status: DesktopAppStatus) => ipcRenderer.send('app-status:update', status),

  // Source picker
  onPickerSources: (listener: (sources: Array<{ id: string; name: string; thumbnail: string; type: string }>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sources: Array<{ id: string; name: string; thumbnail: string; type: string }>) => listener(sources);
    ipcRenderer.on('picker:sources', handler);
    return () => ipcRenderer.removeListener('picker:sources', handler);
  },
  selectPickerSource: (sourceId: string | null) => ipcRenderer.send('picker:select', sourceId),
});
