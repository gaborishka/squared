import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveAuthTokenResponse, LiveSessionKind } from '../../shared/types.js';

const LIVE_MODELS: Record<LiveSessionKind, string> = {
  coach: 'gemini-2.5-flash-native-audio-latest',
  delivery: 'gemini-2.5-flash-native-audio-latest',
  audience: 'gemini-2.5-flash-native-audio-latest',
};

const TOKEN_EXPIRE_MS = 30 * 60 * 1000;
const TOKEN_NEW_SESSION_EXPIRE_MS = 10 * 60 * 1000;
const TOKEN_USES = 3;

export function isLiveSessionKind(value: string): value is LiveSessionKind {
  return value === 'coach' || value === 'delivery' || value === 'audience';
}

export function getLiveModelForKind(kind: LiveSessionKind): string {
  return LIVE_MODELS[kind];
}

export async function createLiveAuthToken(kind: LiveSessionKind): Promise<LiveAuthTokenResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to mint Gemini Live tokens.');
  }

  const now = Date.now();
  const expiresAt = new Date(now + TOKEN_EXPIRE_MS).toISOString();
  const newSessionExpiresAt = new Date(now + TOKEN_NEW_SESSION_EXPIRE_MS).toISOString();
  const model = getLiveModelForKind(kind);

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: 'v1alpha' },
  });

  const token = await ai.authTokens.create({
    config: {
      uses: TOKEN_USES,
      expireTime: expiresAt,
      newSessionExpireTime: newSessionExpiresAt,
      lockAdditionalFields: [],
      liveConnectConstraints: {
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          contextWindowCompression: {
            slidingWindow: {},
          },
        },
      },
    },
  });

  if (!token.name) {
    throw new Error('Gemini did not return a usable Live auth token.');
  }

  return {
    token: token.name,
    model,
    expiresAt,
    newSessionExpiresAt,
  };
}
