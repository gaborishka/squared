import { Menu, Tray, nativeImage } from 'electron';
import fs from 'node:fs';

export interface AppTrayOptions {
  iconPath: string;
  getStatusLabel: () => string;
  isOverlayEnabled: () => boolean;
  onShowMainWindow: () => void;
  onToggleOverlay: (enabled: boolean) => void;
  onQuit: () => void;
}

function loadTrayImage(iconPath: string) {
  try {
    const svg = fs.readFileSync(iconPath, 'utf8');
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const image = nativeImage.createFromDataURL(dataUrl).resize({ width: 18, height: 18 });
    image.setTemplateImage(true);
    return image;
  } catch (error) {
    console.warn('Could not load tray icon asset', error);
    return nativeImage.createEmpty();
  }
}

export function createAppTray(options: AppTrayOptions) {
  const tray = new Tray(loadTrayImage(options.iconPath));

  const refresh = () => {
    const overlayEnabled = options.isOverlayEnabled();
    tray.setToolTip(`Squared — ${options.getStatusLabel()}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Status: ${options.getStatusLabel()}`, enabled: false },
      { type: 'separator' },
      { label: 'Show Squared', click: options.onShowMainWindow },
      {
        label: overlayEnabled ? 'Disable Overlay' : 'Enable Overlay',
        click: () => options.onToggleOverlay(!overlayEnabled),
      },
      { type: 'separator' },
      { label: 'Quit', click: options.onQuit },
    ]));
  };

  tray.on('click', options.onShowMainWindow);
  refresh();

  return {
    refresh,
    destroy: () => tray.destroy(),
  };
}
