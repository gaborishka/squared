import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeliveryLiveAPI } from './useDeliveryLiveAPI';
import { useAudienceLiveAPI } from './useAudienceLiveAPI';
import {
  DEFAULT_AUDIENCE_AGENT_STATE,
  DEFAULT_DELIVERY_AGENT_STATE,
  composeLegacyIndicators,
  mergeDeliveryAgentState,
  mergeAudienceAgentState,
} from '../types';
import type {
  AudienceAgentState,
  AudienceAgentUpdate,
  DeliveryAgentState,
  DeliveryAgentUpdate,
  GamePlan,
  LiveMemoryCue,
  ProjectAnalysis,
  ProjectDetails,
  SlideAnalysisToolPayload,
} from '../types';
import {
  buildDeliveryContext,
  buildAudienceAgentContext,
  formatAudienceStateForDelivery,
  shouldForwardAudienceStateToDelivery,
} from '../lib/session';

export function useDesktopDualLiveSession({
  mode,
  project,
  analysis,
  gamePlan,
  onSlideAnalysis,
  onTranscriptSegment,
  onMediaStream,
  memoryBySlide,
}: {
  mode: 'rehearsal' | 'presentation';
  project: ProjectDetails;
  analysis?: ProjectAnalysis | null;
  gamePlan?: GamePlan | null;
  onSlideAnalysis?: (payload: SlideAnalysisToolPayload) => void;
  onTranscriptSegment?: (payload: { text: string; capturedAt: number }) => void;
  onMediaStream?: (stream: MediaStream | null) => void;
  memoryBySlide?: Record<number, LiveMemoryCue[]> | null;
}) {
  const [deliveryState, setDeliveryState] = useState<DeliveryAgentState | null>(null);
  const [audienceState, setAudienceState] = useState<AudienceAgentState | null>(null);

  const deliveryContext = useMemo(
    () => buildDeliveryContext({ mode, project, analysis, gamePlan, memoryBySlide }),
    [analysis, gamePlan, memoryBySlide, mode, project],
  );
  const audienceContext = useMemo(
    () => buildAudienceAgentContext({ mode, project, analysis, gamePlan }),
    [analysis, gamePlan, mode, project],
  );

  const previousAudienceStateRef = useRef<AudienceAgentState | null>(null);
  const handleDeliveryUpdate = useCallback((update: DeliveryAgentUpdate) => {
    setDeliveryState((previous) => mergeDeliveryAgentState(previous, update));
  }, []);
  const handleAudienceUpdate = useCallback((update: AudienceAgentUpdate) => {
    setAudienceState((previous) => mergeAudienceAgentState(previous, update));
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
    onTranscriptSegment,
    onMediaStream,
  });

  const {
    isConnected: isAudienceConnected,
    isConnecting: isAudienceConnecting,
    error: audienceError,
    connect: connectAudienceSession,
    disconnect: disconnectAudienceSession,
  } = useAudienceLiveAPI({
    mode,
    contextText: audienceContext,
    onUpdate: handleAudienceUpdate,
  });

  useEffect(() => {
    if (!audienceState) return;
    if (!shouldForwardAudienceStateToDelivery(previousAudienceStateRef.current, audienceState)) {
      previousAudienceStateRef.current = audienceState;
      return;
    }

    const note = formatAudienceStateForDelivery(audienceState);
    previousAudienceStateRef.current = audienceState;
    if (note) {
      pushContextNote(note);
    }
  }, [pushContextNote, audienceState]);

  const connect = useCallback(async (videoElement: HTMLVideoElement): Promise<boolean> => {
    previousAudienceStateRef.current = null;
    setAudienceState(DEFAULT_AUDIENCE_AGENT_STATE);
    const deliveryConnected = await connectDelivery(videoElement);
    if (!deliveryConnected) {
      return false;
    }
    // Audience agent connects lazily via connectAudience() — not automatically
    return true;
  }, [connectDelivery]);

  const connectAudience = useCallback(async (): Promise<boolean> => {
    if (!window.squaredElectron?.isElectron) {
      return false;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setAudienceState((previous) => mergeAudienceAgentState(previous, {
        captureStatus: 'unsupported',
        audiencePrompt: '',
        audienceDetails: '',
      }));
      return false;
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
        console.warn('AudienceAgent microphone mirror unavailable', audioError);
      }

      if (!mirroredMicStream || mirroredMicStream.getAudioTracks().length === 0) {
        displayStream.getTracks().forEach((track) => track.stop());
        mirroredMicStream?.getTracks().forEach((track) => track.stop());
        setAudienceState((previous) => mergeAudienceAgentState(previous, {
          captureStatus: 'inactive',
          priority: 'watch',
          audiencePrompt: 'AudienceAgent offline',
          audienceDetails: 'Could not mirror microphone audio into AudienceAgent. Delivery coaching continues.',
        }));
        return false;
      }

      const connected = await connectAudienceSession({
        displayStream: displayStream,
        audioStream: mirroredMicStream,
      });
      if (!connected) {
        displayStream.getTracks().forEach((track) => track.stop());
        mirroredMicStream.getTracks().forEach((track) => track.stop());
        return false;
      }
      return true;
    } catch (error: any) {
      const denied = error?.name === 'NotAllowedError' || error?.message === 'Permission denied';
      setAudienceState((previous) => mergeAudienceAgentState(previous, {
        captureStatus: denied ? 'denied' : 'inactive',
        audiencePrompt: '',
        audienceDetails: '',
      }));
      return false;
    }
  }, [connectAudienceSession]);

  const disconnectAudience = useCallback(() => {
    disconnectAudienceSession();
    previousAudienceStateRef.current = null;
    setAudienceState(DEFAULT_AUDIENCE_AGENT_STATE);
  }, [disconnectAudienceSession]);

  const disconnect = useCallback(() => {
    disconnectAudienceSession();
    disconnectDelivery();
    previousAudienceStateRef.current = null;
    setAudienceState(DEFAULT_AUDIENCE_AGENT_STATE);
  }, [disconnectDelivery, disconnectAudienceSession]);

  const legacyIndicators = useMemo(
    () => composeLegacyIndicators(deliveryState ?? DEFAULT_DELIVERY_AGENT_STATE, audienceState ?? DEFAULT_AUDIENCE_AGENT_STATE),
    [deliveryState, audienceState],
  );

  return {
    isConnected: isDeliveryConnected,
    isConnecting: isDeliveryConnecting || isAudienceConnecting,
    isSpeaking,
    error: deliveryError ?? audienceError,
    connect,
    disconnect,
    connectAudience,
    disconnectAudience,
    isAudienceConnected,
    analyserRef,
    playbackAnalyserRef,
    deliveryState: deliveryState ?? DEFAULT_DELIVERY_AGENT_STATE,
    audienceState: audienceState ?? DEFAULT_AUDIENCE_AGENT_STATE,
    legacyIndicators,
  };
}
