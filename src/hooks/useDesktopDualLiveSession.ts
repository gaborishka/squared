import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeliveryLiveAPI } from './useDeliveryLiveAPI';
import { useScreenLiveAPI } from './useScreenLiveAPI';
import {
  DEFAULT_DELIVERY_AGENT_STATE,
  DEFAULT_SCREEN_AGENT_STATE,
  composeLegacyIndicators,
  mergeDeliveryAgentState,
  mergeScreenAgentState,
} from '../types';
import type {
  DeliveryAgentState,
  DeliveryAgentUpdate,
  GamePlan,
  ProjectAnalysis,
  ProjectDetails,
  ScreenAgentState,
  ScreenAgentUpdate,
  SlideAnalysisToolPayload,
} from '../types';
import {
  buildDeliveryContext,
  buildScreenAgentContext,
  formatScreenStateForDelivery,
  shouldForwardScreenStateToDelivery,
} from '../lib/session';

export function useDesktopDualLiveSession({
  mode,
  project,
  analysis,
  gamePlan,
  onSlideAnalysis,
}: {
  mode: 'rehearsal' | 'presentation';
  project: ProjectDetails;
  analysis?: ProjectAnalysis | null;
  gamePlan?: GamePlan | null;
  onSlideAnalysis?: (payload: SlideAnalysisToolPayload) => void;
}) {
  const [deliveryState, setDeliveryState] = useState<DeliveryAgentState | null>(null);
  const [screenState, setScreenState] = useState<ScreenAgentState | null>(null);

  const deliveryContext = useMemo(
    () => buildDeliveryContext({ mode, project, analysis, gamePlan }),
    [analysis, gamePlan, mode, project],
  );
  const screenContext = useMemo(
    () => buildScreenAgentContext({ mode, project, analysis, gamePlan }),
    [analysis, gamePlan, mode, project],
  );

  const previousScreenStateRef = useRef<ScreenAgentState | null>(null);
  const handleDeliveryUpdate = useCallback((update: DeliveryAgentUpdate) => {
    setDeliveryState((previous) => mergeDeliveryAgentState(previous, update));
  }, []);
  const handleScreenUpdate = useCallback((update: ScreenAgentUpdate) => {
    setScreenState((previous) => mergeScreenAgentState(previous, update));
  }, []);
  const handleSlideAnalysis = useCallback((payload: SlideAnalysisToolPayload) => {
    onSlideAnalysis?.(payload);
  }, [onSlideAnalysis]);

  const {
    isConnected: isDeliveryConnected,
    isConnecting: isDeliveryConnecting,
    isSpeaking,
    error: deliveryError,
    connect: connectDelivery,
    disconnect: disconnectDelivery,
    analyserRef,
    playbackAnalyserRef,
    pushContextNote,
  } = useDeliveryLiveAPI({
    mode,
    contextText: deliveryContext,
    onUpdate: handleDeliveryUpdate,
    onSlideAnalysis: handleSlideAnalysis,
  });

  const {
    isConnecting: isScreenConnecting,
    error: screenError,
    connect: connectScreen,
    disconnect: disconnectScreen,
  } = useScreenLiveAPI({
    mode,
    contextText: screenContext,
    onUpdate: handleScreenUpdate,
  });

  useEffect(() => {
    if (!screenState) return;
    if (!shouldForwardScreenStateToDelivery(previousScreenStateRef.current, screenState)) {
      previousScreenStateRef.current = screenState;
      return;
    }

    const note = formatScreenStateForDelivery(screenState);
    previousScreenStateRef.current = screenState;
    if (note) {
      pushContextNote(note);
    }
  }, [pushContextNote, screenState]);

  const connect = useCallback(async (videoElement: HTMLVideoElement): Promise<boolean> => {
    previousScreenStateRef.current = null;
    setScreenState(DEFAULT_SCREEN_AGENT_STATE);
    const deliveryConnected = await connectDelivery(videoElement);
    if (!deliveryConnected) {
      return false;
    }

    if (!window.squaredElectron?.isElectron) {
      return true;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenState((previous) => mergeScreenAgentState(previous, {
        captureStatus: 'unsupported',
        screenPrompt: '',
        screenDetails: '',
      }));
      return true;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 1, max: 2 },
        },
        audio: false,
      });

      let mirroredMicStream: MediaStream | null = null;
      try {
        mirroredMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (audioError) {
        console.warn('ScreenAgent microphone mirror unavailable', audioError);
      }

      if (!mirroredMicStream || mirroredMicStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach((track) => track.stop());
        mirroredMicStream?.getTracks().forEach((track) => track.stop());
        setScreenState((previous) => mergeScreenAgentState(previous, {
          captureStatus: 'inactive',
          screenPriority: 'watch',
          screenPrompt: 'ScreenAgent offline',
          screenDetails: 'Could not mirror microphone audio into ScreenAgent. Delivery coaching continues.',
        }));
        return true;
      }

      const screenConnected = await connectScreen({
        screenStream: displayStream,
        audioStream: mirroredMicStream,
      });
      if (!screenConnected) {
        displayStream.getTracks().forEach((track) => track.stop());
        mirroredMicStream.getTracks().forEach((track) => track.stop());
      }
      return true;
    } catch (error: any) {
      const denied = error?.name === 'NotAllowedError' || error?.message === 'Permission denied';
      setScreenState((previous) => mergeScreenAgentState(previous, {
        captureStatus: denied ? 'denied' : 'inactive',
        screenPrompt: '',
        screenDetails: '',
      }));
      return true;
    }
  }, [connectDelivery, connectScreen]);

  const disconnect = useCallback(() => {
    disconnectScreen();
    disconnectDelivery();
    previousScreenStateRef.current = null;
    setScreenState(DEFAULT_SCREEN_AGENT_STATE);
  }, [disconnectDelivery, disconnectScreen]);

  const effectiveScreenState = useMemo(() => {
    const current = screenState ?? DEFAULT_SCREEN_AGENT_STATE;
    const deliveryCurrent = deliveryState ?? DEFAULT_DELIVERY_AGENT_STATE;
    if (current.captureStatus === 'active' || current.captureStatus === 'lost') {
      return current;
    }

    return {
      ...current,
      currentSlide: current.currentSlide ?? deliveryCurrent.fallbackCurrentSlide,
      slideTimeRemaining: current.slideTimeRemaining ?? deliveryCurrent.fallbackSlideTimeRemaining,
    };
  }, [deliveryState, screenState]);

  const legacyIndicators = useMemo(
    () => composeLegacyIndicators(deliveryState ?? DEFAULT_DELIVERY_AGENT_STATE, effectiveScreenState),
    [deliveryState, effectiveScreenState],
  );

  return {
    isConnected: isDeliveryConnected,
    isConnecting: isDeliveryConnecting || isScreenConnecting,
    isSpeaking,
    error: deliveryError ?? screenError,
    connect,
    disconnect,
    analyserRef,
    playbackAnalyserRef,
    deliveryState: deliveryState ?? DEFAULT_DELIVERY_AGENT_STATE,
    screenState: effectiveScreenState,
    rawScreenState: screenState ?? DEFAULT_SCREEN_AGENT_STATE,
    legacyIndicators,
  };
}
