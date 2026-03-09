import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const electronDistDir = path.dirname(currentFilePath);

export interface ElectronPaths {
  preloadPath: string;
  frontendDistDir: string;
  devServerUrl: string;
  serverEntry: string;
  overlayHtmlPath: string;
  trayIconPath: string;
  userDataPath: string;
  executableDir: string;
}

export function getElectronPaths(): ElectronPaths {
  const appRoot = app.getAppPath();
  const resourcesRoot = app.isPackaged ? process.resourcesPath : appRoot;

  return {
    preloadPath: app.isPackaged
      ? path.resolve(appRoot, 'dist-electron/electron/preload.js')
      : path.resolve(electronDistDir, 'preload.js'),
    frontendDistDir: path.resolve(resourcesRoot, 'dist'),
    devServerUrl: 'http://127.0.0.1:3000',
    serverEntry: app.isPackaged
      ? path.resolve(appRoot, 'dist-server/server/index.js')
      : path.resolve(resourcesRoot, 'dist-server/server/index.js'),
    overlayHtmlPath: path.resolve(resourcesRoot, 'electron/overlay.html'),
    trayIconPath: path.resolve(resourcesRoot, 'electron/assets/tray-template.svg'),
    userDataPath: app.getPath('userData'),
    executableDir: path.dirname(app.getPath('exe')),
  };
}
