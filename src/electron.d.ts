import type { DesktopAppStatus, PillState, SubtitleState } from './types';

declare global {
  interface Window {
    squaredElectron?: {
      isElectron: boolean;
      platform?: string;
      openExternalAuth: (url: string) => void;
      updatePill: (state: PillState) => void;
      updateSubtitles: (state: SubtitleState) => void;
      clearOverlay: () => void;
      hideMainWindow: () => void;
      showMainWindow: () => void;
      stopSession: () => void;
      onStopSession: (listener: () => void) => () => void;
      setAppStatus: (status: DesktopAppStatus) => void;
      onPillState?: (listener: (state: PillState) => void) => () => void;
      onSubtitleState?: (listener: (state: SubtitleState) => void) => () => void;
    };
  }
}

export {};
