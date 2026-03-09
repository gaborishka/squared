import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAppStatus, OverlayState } from '../shared/types.js';

contextBridge.exposeInMainWorld('squaredElectron', {
  isElectron: true,
  updateOverlay: (state: OverlayState) => ipcRenderer.send('overlay:update', state),
  clearOverlay: () => ipcRenderer.send('overlay:clear'),
  setAppStatus: (status: DesktopAppStatus) => ipcRenderer.send('app-status:update', status),
  onOverlayState: (listener: (state: OverlayState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state);
    ipcRenderer.on('overlay:state', handler);
    return () => ipcRenderer.removeListener('overlay:state', handler);
  },
});
