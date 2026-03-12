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
  runtimeConfigPath: string;
  statusPillHtmlPath: string;
  subtitlesHtmlPath: string;
  sourcePickerHtmlPath: string;
  trayIconPath: string;
  userDataPath: string;
  executableDir: string;
}

export function getElectronPaths(): ElectronPaths {
  const appRoot = app.getAppPath();
  const projectRoot = app.isPackaged ? appRoot : path.resolve(electronDistDir, '..', '..');
  const resourcesRoot = app.isPackaged ? process.resourcesPath : projectRoot;

  return {
    preloadPath: app.isPackaged
      ? path.resolve(appRoot, 'dist-electron/electron/preload.cjs')
      : path.resolve(electronDistDir, 'preload.cjs'),
    frontendDistDir: path.resolve(resourcesRoot, 'dist'),
    devServerUrl: 'http://127.0.0.1:5173',
    serverEntry: app.isPackaged
      ? path.resolve(appRoot, 'dist-server/server/index.js')
      : path.resolve(resourcesRoot, 'dist-server/server/index.js'),
    runtimeConfigPath: path.resolve(resourcesRoot, 'electron/runtime-config.json'),
    statusPillHtmlPath: path.resolve(resourcesRoot, 'electron/statusPill.html'),
    subtitlesHtmlPath: path.resolve(resourcesRoot, 'electron/subtitles.html'),
    sourcePickerHtmlPath: path.resolve(resourcesRoot, 'electron/sourcePicker.html'),
    trayIconPath: path.resolve(resourcesRoot, 'electron/assets/tray-template.svg'),
    userDataPath: app.getPath('userData'),
    executableDir: path.dirname(app.getPath('exe')),
  };
}
