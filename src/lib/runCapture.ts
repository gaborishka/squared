import type { RunTranscriptSegment } from '../types';

const RECORDING_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'audio/webm;codecs=opus',
  'audio/webm',
];

export function pickSupportedRecordingMimeType(stream: MediaStream): string {
  const prefersAudioOnly = stream.getVideoTracks().length === 0;
  for (const mimeType of RECORDING_MIME_TYPES) {
    if (prefersAudioOnly && mimeType.startsWith('video/')) continue;
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return prefersAudioOnly ? 'audio/webm' : 'video/webm';
}

export function buildTranscriptSegmentDraft(args: {
  text: string;
  capturedAt: number;
  sessionStartTime: number | null;
  slideNumber: number | null;
  sequence: number;
}): Omit<RunTranscriptSegment, 'runId'> {
  const normalizedText = args.text.trim();
  const endMs = Math.max(0, args.sessionStartTime ? args.capturedAt - args.sessionStartTime : 0);
  const estimatedDuration = Math.min(
    4000,
    Math.max(400, normalizedText.split(/\s+/).filter(Boolean).length * 350),
  );
  const startMs = Math.max(0, endMs - estimatedDuration);

  return {
    id: crypto.randomUUID(),
    sequence: args.sequence,
    startMs,
    endMs,
    text: normalizedText,
    slideNumber: args.slideNumber,
  };
}
