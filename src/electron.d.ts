import type { DesktopAppStatus, OverlayState } from './types';

declare global {
  interface Window {
    squaredElectron?: {
      isElectron: boolean;
      updateOverlay: (state: OverlayState) => void;
      clearOverlay: () => void;
      setAppStatus: (status: DesktopAppStatus) => void;
      onOverlayState?: (listener: (state: OverlayState) => void) => () => void;
    };
  }
}

export {};
