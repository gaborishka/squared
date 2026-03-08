import type { OverlayState } from './types';

declare global {
  interface Window {
    squaredElectron?: {
      isElectron: boolean;
      updateOverlay: (state: OverlayState) => void;
      clearOverlay: () => void;
      onOverlayState?: (listener: (state: OverlayState) => void) => () => void;
    };
  }
}

export {};
