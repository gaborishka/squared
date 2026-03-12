import { GoogleGenAI } from '@google/genai';
import type { LiveAuthTokenResponse, LiveSessionKind } from '../types';
import { API_BASE_URL } from '../api/client';

async function requestLiveAuthToken(kind: LiveSessionKind): Promise<LiveAuthTokenResponse> {
  const response = await fetch(`${API_BASE_URL}/api/live/auth-token`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Failed to create Live auth token (${response.status}).`);
  }

  return response.json() as Promise<LiveAuthTokenResponse>;
}

export async function createBrowserLiveClient(kind: LiveSessionKind): Promise<GoogleGenAI> {
  const { token } = await requestLiveAuthToken(kind);
  return new GoogleGenAI({
    apiKey: token,
    httpOptions: { apiVersion: 'v1alpha' },
  });
}
