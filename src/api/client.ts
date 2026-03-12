import type {
  GamePlan,
  LiveMemoryCue,
  ProjectAnalysis,
  ProjectDetails,
  ProjectInput,
  ProjectSummary,
  RiskSegment,
  RunArtifact,
  RunDetails,
  RunSummary,
  SaveRunPayload,
} from '../types';

export function getApiBaseUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envBase) return envBase;
  const electronBase = window.squaredElectron?.runtimeConfig?.apiBaseUrl?.trim();
  if (electronBase) return electronBase.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:3001';
  // In dev, Vite proxy forwards /api to the backend; in production, same origin
  return '';
}

export const API_BASE_URL = getApiBaseUrl();
const DESKTOP_SESSION_STORAGE_KEY = 'sq_desktop_session';

function getDesktopSessionId(): string | null {
  if (!window.squaredElectron?.isElectron) return null;
  try {
    return window.localStorage.getItem(DESKTOP_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearDesktopSessionId(): void {
  if (!window.squaredElectron?.isElectron) return;
  try {
    window.localStorage.removeItem(DESKTOP_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const desktopSessionId = getDesktopSessionId();
  if (desktopSessionId) {
    headers.set('x-squared-session', desktopSessionId);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: 'include', ...init, headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => requestJson<ProjectSummary[]>('/api/projects'),
  getProject: (id: string) => requestJson<ProjectDetails>(`/api/projects/${id}`),
  createProject: (input: ProjectInput) =>
    requestJson<ProjectDetails>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateProject: (id: string, input: ProjectInput) =>
    requestJson<ProjectDetails>(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  deleteProject: (id: string) =>
    requestJson<void>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),
  uploadProjectFile: async (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return requestJson<ProjectDetails>(`/api/projects/${id}/upload`, {
      method: 'POST',
      body: formData,
    });
  },
  listRuns: (projectId?: string) =>
    requestJson<RunSummary[]>(projectId ? `/api/runs?project_id=${encodeURIComponent(projectId)}` : '/api/runs'),
  getRun: (id: string) => requestJson<RunDetails>(`/api/runs/${id}`),
  saveRun: (payload: SaveRunPayload) =>
    requestJson<RunDetails>('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  uploadRunArtifact: async (
    runId: string,
    file: Blob,
    meta: { kind: RunArtifact['kind']; startMs?: number | null; endMs?: number | null; fileName?: string },
  ) => {
    const formData = new FormData();
    formData.append('runId', runId);
    formData.append('kind', meta.kind);
    if (typeof meta.startMs === 'number') formData.append('startMs', String(meta.startMs));
    if (typeof meta.endMs === 'number') formData.append('endMs', String(meta.endMs));
    formData.append('file', file, meta.fileName ?? 'recording.webm');
    return requestJson<RunArtifact>('/api/runs/artifacts', {
      method: 'POST',
      body: formData,
    });
  },
  getProjectAnalysis: (projectId: string) =>
    requestJson<ProjectAnalysis>(`/api/projects/${projectId}/analysis`),
  getProjectRisks: (projectId: string) =>
    requestJson<RiskSegment[]>(`/api/projects/${projectId}/risks`),
  getProjectMemory: (projectId: string) =>
    requestJson<Record<number, LiveMemoryCue[]>>(`/api/projects/${projectId}/memory`),
  getProjectSlideMemory: (projectId: string, slideNumber: number) =>
    requestJson<LiveMemoryCue[]>(`/api/projects/${projectId}/memory?slide_number=${encodeURIComponent(slideNumber)}`),
  generateGamePlan: (projectId: string) =>
    requestJson<GamePlan>(`/api/projects/${projectId}/gameplan`, {
      method: 'POST',
    }),
  getLatestGamePlan: (projectId: string) =>
    requestJson<GamePlan>(`/api/projects/${projectId}/gameplan/latest`),
  getGamePlan: (id: string) => requestJson<GamePlan>(`/api/gameplans/${id}`),
  getProjectFileUrl: (id: string) => `${API_BASE_URL}/api/projects/${id}/file`,
  getProjectSlidePreviewUrl: (id: string, slideNumber: number) =>
    `${API_BASE_URL}/api/projects/${id}/slides/${slideNumber}/preview`,
  getCurrentUser: () => requestJson<import('../types').AuthUser>('/api/auth/me'),
  logout: async () => {
    try {
      await requestJson<void>('/api/auth/logout', { method: 'POST' });
    } finally {
      clearDesktopSessionId();
    }
  },
  getAuthBaseUrl: () => API_BASE_URL,
};
