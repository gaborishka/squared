# Presentation Overlay Redesign — Status Pill + Subtitles

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single Electron overlay window with two independent windows — a draggable Status Pill (always visible during session) and a Subtitles bar (situational cues at bottom of screen) — while keeping the Gemini session alive when the main window is hidden.

**Architecture:** The main window uses `hide()` instead of minimize so the renderer (and thus camera/mic capture + Gemini WebSocket) stays active. Two new Electron BrowserWindows replace the existing single overlay: a compact draggable pill (top-right) and a wide subtitles bar (bottom-center). Both use `setContentProtection(true)` and `alwaysOnTop: 'screen-saver'` to remain invisible to screen sharing. The renderer sends indicator updates via IPC; the main process fans them out to both windows.

**Tech Stack:** Electron (BrowserWindow, IPC), HTML/CSS (overlay windows), TypeScript, React (renderer-side changes)

---

## File Structure

### New files
- `electron/statusPill.ts` — creates the Status Pill BrowserWindow
- `electron/statusPill.html` — Status Pill UI (vanilla HTML/CSS/JS, no React)
- `electron/subtitles.ts` — creates the Subtitles BrowserWindow
- `electron/subtitles.html` — Subtitles UI (vanilla HTML/CSS/JS, no React)

### Modified files
- `electron/main.ts` — replace single `overlayWindow` with `pillWindow` + `subtitlesWindow`, add hide/show main window IPC
- `electron/ipc.ts` — fan out indicator updates to both windows, add `main-window:hide` / `main-window:show` handlers
- `electron/preload.ts` — expose `hideMainWindow()` / `showMainWindow()` to renderer
- `electron/tray.ts` — existing "Show Squared" already works (no changes needed)
- `electron/paths.ts` — add `statusPillHtmlPath` and `subtitlesHtmlPath`, remove `overlayHtmlPath`
- `electron/scripts/copy-resources.mjs` — copy new HTML files instead of overlay.html
- `shared/types.ts` — add `PillState` and `SubtitleState` interfaces
- `src/electron.d.ts` — add all new IPC method type declarations
- `src/types.ts` — add converter helpers, remove `indicatorToOverlayState`
- `src/components/PresentationMode.tsx` — send pill/subtitle state via IPC, add "Hide window" button

### Removed (replaced)
- `electron/overlay.ts` — replaced by `statusPill.ts` + `subtitles.ts`
- `electron/overlay.html` — replaced by `statusPill.html` + `subtitles.html`

---

## Chunk 1: Types & Window Infrastructure

### Task 1: Add new shared types

**Files:**
- Modify: `shared/types.ts`

- [ ] **Step 1: Add PillState and SubtitleState interfaces to shared/types.ts**

Add after the existing `OverlayState` interface:

```typescript
export interface PillState {
  visible: boolean;
  elapsed: string;
  currentSlide: number | null;
  pace: string;
  eyeContact: string;
  posture: string;
  fillerCount: number;
  confidenceScore: number;
  overallScore: number;
  agentMode: AgentMode;
  slideTimeRemaining: number | null;
}

export interface SubtitleState {
  visible: boolean;
  mode: AgentMode;
  microPrompt: string;
  rescueText: string;
}
```

- [ ] **Step 2: Add helper functions to types.ts for converting indicators to pill/subtitle state**

Add to `src/types.ts` after `indicatorToOverlayState`:

```typescript
export function indicatorToPillState(indicators: IndicatorData | null, elapsed: string): PillState {
  return {
    visible: true,
    elapsed,
    currentSlide: indicators?.currentSlide ?? null,
    pace: indicators?.pace ?? 'Analyzing...',
    eyeContact: indicators?.eyeContact ?? 'Analyzing...',
    posture: indicators?.posture ?? 'Analyzing...',
    fillerCount: indicators?.fillerWords?.total ?? 0,
    confidenceScore: indicators?.confidenceScore ?? 0,
    overallScore: indicators?.overallScore ?? 0,
    agentMode: indicators?.agentMode ?? 'monitor',
    slideTimeRemaining: indicators?.slideTimeRemaining ?? null,
  };
}

export function indicatorToSubtitleState(indicators: IndicatorData | null): SubtitleState {
  const hasCue = Boolean(indicators?.microPrompt || indicators?.rescueText);
  return {
    visible: hasCue,
    mode: indicators?.agentMode ?? 'monitor',
    microPrompt: indicators?.microPrompt ?? '',
    rescueText: indicators?.rescueText ?? '',
  };
}
```

Also remove `indicatorToOverlayState` from `src/types.ts` — it becomes dead code after this migration.

Note: `electron.d.ts` will be updated later in Task 5 together with the preload bridge, to keep all IPC declarations in one place.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts src/types.ts
git commit -m "feat: add PillState and SubtitleState types for new overlay windows"
```

---

### Task 2: Create Status Pill Electron window

**Files:**
- Create: `electron/statusPill.ts`
- Create: `electron/statusPill.html`

- [ ] **Step 1: Create statusPill.ts**

```typescript
import { BrowserWindow, screen } from 'electron';
import type { PillState } from '../shared/types.js';

function getPillBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 280;
  const height = 160;
  return {
    width,
    height,
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
  };
}

export function createPillWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  const bounds = getPillBounds();
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    focusable: false,
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(false);
  window.setContentProtection(true);
  void window.loadFile(htmlPath);
  return window;
}

export function pushPillState(window: BrowserWindow, state: PillState): void {
  if (window.isDestroyed()) return;
  if (!window.webContents.isLoadingMainFrame()) {
    window.webContents.send('pill:state', state);
  }

  if (state.visible) {
    if (!window.isVisible()) window.showInactive();
  } else if (window.isVisible()) {
    window.hide();
  }
}
```

Note: `movable: true` and `setIgnoreMouseEvents(false)` — the pill IS draggable and clickable (Stop button). This differs from the old overlay which was click-through.

- [ ] **Step 2: Create statusPill.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Squared Status</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: rgba(9, 9, 11, 0.82);
        --text: #f4f4f5;
        --muted: rgba(244, 244, 245, 0.5);
        --ok: #34d399;
        --watch: #fbbf24;
        --danger: #f87171;
        --border: rgba(255, 255, 255, 0.08);
      }
      * { box-sizing: border-box; margin: 0; }
      html, body {
        width: 100%; height: 100%;
        overflow: hidden; background: transparent;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        -webkit-app-region: drag;
        user-select: none;
      }
      .pill {
        display: none;
        width: 100%;
        border-radius: 20px;
        border: 1px solid var(--border);
        background: var(--bg);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 16px 64px rgba(0,0,0,0.45);
        color: var(--text);
        padding: 14px 16px;
      }
      .pill.visible { display: block; }

      .header {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 10px;
      }
      .timer {
        font-size: 22px; font-weight: 700;
        letter-spacing: -0.03em;
        font-variant-numeric: tabular-nums;
      }
      .slide-badge {
        font-size: 11px; color: var(--muted);
        padding: 2px 8px;
        border-radius: 8px;
        background: rgba(255,255,255,0.06);
      }
      .indicators {
        display: flex; gap: 10px;
        margin-bottom: 10px;
      }
      .ind {
        display: flex; align-items: center; gap: 4px;
        font-size: 11px; color: var(--muted);
      }
      .dot {
        width: 6px; height: 6px; border-radius: 50%;
      }
      .dot-ok { background: var(--ok); }
      .dot-warn { background: var(--watch); }
      .dot-bad { background: var(--danger); }
      .dot-neutral { background: rgba(255,255,255,0.25); }
      .metrics {
        display: flex; gap: 12px;
        font-size: 11px; color: var(--muted);
        margin-bottom: 12px;
      }
      .metrics span { font-variant-numeric: tabular-nums; }
      .metrics .val { color: var(--text); font-weight: 600; }
      .stop-btn {
        -webkit-app-region: no-drag;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; height: 32px;
        border-radius: 10px; border: none;
        background: rgba(248,113,113,0.12);
        color: var(--danger);
        font-size: 13px; font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .stop-btn:hover { background: rgba(248,113,113,0.22); }
    </style>
  </head>
  <body>
    <div id="pill" class="pill">
      <div class="header">
        <span id="timer" class="timer">0:00</span>
        <span id="slide" class="slide-badge">--</span>
      </div>
      <div class="indicators">
        <div class="ind"><div id="dot-eye" class="dot dot-neutral"></div><span id="lbl-eye">Eye</span></div>
        <div class="ind"><div id="dot-pace" class="dot dot-neutral"></div><span id="lbl-pace">Pace</span></div>
        <div class="ind"><div id="dot-posture" class="dot dot-neutral"></div><span id="lbl-posture">Posture</span></div>
      </div>
      <div class="metrics">
        <span>Score <span id="score" class="val">—</span></span>
        <span>Fillers <span id="fillers" class="val">0</span></span>
        <span>Conf <span id="confidence" class="val">—</span></span>
      </div>
      <button id="stop-btn" class="stop-btn">&#9632; Stop</button>
    </div>

    <script>
      const pill = document.getElementById('pill');
      const timer = document.getElementById('timer');
      const slide = document.getElementById('slide');
      const dotEye = document.getElementById('dot-eye');
      const dotPace = document.getElementById('dot-pace');
      const dotPosture = document.getElementById('dot-posture');
      const lblEye = document.getElementById('lbl-eye');
      const lblPace = document.getElementById('lbl-pace');
      const lblPosture = document.getElementById('lbl-posture');
      const score = document.getElementById('score');
      const fillers = document.getElementById('fillers');
      const confidence = document.getElementById('confidence');
      const stopBtn = document.getElementById('stop-btn');

      function classify(text, goodWords, badWords) {
        if (!text) return 'neutral';
        const l = text.toLowerCase();
        if (badWords.some(w => l.includes(w))) return 'bad';
        if (l.includes('watch') || l.includes('not visible') || l.includes('glancing') || l.includes('face not') || l.includes('posture not')) return 'warn';
        if (goodWords.some(w => l.includes(w))) return 'ok';
        return 'neutral';
      }

      function setDot(el, level) {
        el.className = 'dot dot-' + level;
      }

      function update(state) {
        pill.className = 'pill' + (state.visible ? ' visible' : '');
        timer.textContent = state.elapsed || '0:00';
        slide.textContent = state.currentSlide != null ? 'Slide ' + state.currentSlide : '--';

        const eyeLevel = classify(state.eyeContact, ['camera','good','direct'], ['looking away','around','down']);
        const paceLevel = classify(state.pace, ['good','normal','perfect'], ['fast','slow']);
        const postureLevel = classify(state.posture, ['good','straight','upright'], ['slouch','bad']);

        setDot(dotEye, eyeLevel);
        setDot(dotPace, paceLevel);
        setDot(dotPosture, postureLevel);
        lblEye.textContent = state.eyeContact || 'Eye';
        lblPace.textContent = state.pace || 'Pace';
        lblPosture.textContent = state.posture || 'Posture';

        score.textContent = state.overallScore > 0 ? state.overallScore : '—';
        fillers.textContent = state.fillerCount;
        confidence.textContent = state.confidenceScore > 0 ? state.confidenceScore : '—';
      }

      stopBtn.addEventListener('click', () => {
        if (window.squaredElectron?.stopSession) {
          window.squaredElectron.stopSession();
        }
      });

      if (window.squaredElectron?.onPillState) {
        window.squaredElectron.onPillState(update);
      }
    </script>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add electron/statusPill.ts electron/statusPill.html
git commit -m "feat: add Status Pill Electron window"
```

---

### Task 3: Create Subtitles Electron window

**Files:**
- Create: `electron/subtitles.ts`
- Create: `electron/subtitles.html`

- [ ] **Step 1: Create subtitles.ts**

```typescript
import { BrowserWindow, screen } from 'electron';
import type { SubtitleState } from '../shared/types.js';

function getSubtitleBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(720, workArea.width - 80);
  const height = 120;
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 40,
  };
}

export function createSubtitlesWindow(preloadPath: string, htmlPath: string): BrowserWindow {
  const bounds = getSubtitleBounds();
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.setContentProtection(true);
  void window.loadFile(htmlPath);
  return window;
}

export function pushSubtitleState(window: BrowserWindow, state: SubtitleState): void {
  if (window.isDestroyed()) return;
  if (!window.webContents.isLoadingMainFrame()) {
    window.webContents.send('subtitle:state', state);
  }

  if (state.visible) {
    if (!window.isVisible()) window.showInactive();
  } else if (window.isVisible()) {
    window.hide();
  }
}
```

- [ ] **Step 2: Create subtitles.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Squared Subtitles</title>
    <style>
      :root {
        color-scheme: dark;
        --text: #f4f4f5;
        --muted: rgba(244, 244, 245, 0.7);
        --ok: #34d399;
        --watch: #fbbf24;
        --danger: #f87171;
      }
      * { box-sizing: border-box; margin: 0; }
      html, body {
        width: 100%; height: 100%;
        overflow: hidden; background: transparent;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
        user-select: none;
        display: flex; align-items: flex-end; justify-content: center;
        padding-bottom: 8px;
      }
      .bar {
        display: none;
        text-align: center;
        padding: 12px 28px;
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 8px 40px rgba(0,0,0,0.4);
        max-width: 100%;
        animation: fadeUp 0.25s ease-out;
      }
      .bar.visible { display: block; }

      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .bar.mode-rescue {
        border: 1px solid rgba(248,113,113,0.35);
      }
      .bar.mode-directive {
        border: 1px solid rgba(251,191,36,0.3);
      }
      .bar.mode-soft_cue {
        border: 1px solid rgba(52,211,153,0.25);
      }
      .bar.mode-monitor {
        border: 1px solid rgba(255,255,255,0.08);
      }

      .prompt {
        font-size: 20px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--text);
        line-height: 1.3;
      }
      .bar.mode-rescue .prompt { color: var(--danger); }
      .bar.mode-directive .prompt { color: var(--watch); }
      .bar.mode-soft_cue .prompt { color: var(--ok); }

      .rescue {
        display: none;
        margin-top: 8px;
        font-size: 15px;
        line-height: 1.45;
        color: var(--muted);
      }
      .rescue.visible { display: block; }
    </style>
  </head>
  <body>
    <div id="bar" class="bar">
      <div id="prompt" class="prompt"></div>
      <div id="rescue" class="rescue"></div>
    </div>

    <script>
      const bar = document.getElementById('bar');
      const prompt = document.getElementById('prompt');
      const rescue = document.getElementById('rescue');

      let hideTimer = null;

      function update(state) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

        bar.className = 'bar' + (state.visible ? ' visible' : '') + ' mode-' + state.mode;
        prompt.textContent = state.microPrompt || '';
        rescue.textContent = state.rescueText || '';
        rescue.className = 'rescue' + (state.rescueText ? ' visible' : '');

        // Auto-hide soft cues after 6 seconds; rescue/directive stay visible
        if (state.visible && state.mode !== 'rescue' && state.mode !== 'directive') {
          hideTimer = setTimeout(() => {
            bar.classList.remove('visible');
          }, 6000);
        }
      }

      if (window.squaredElectron?.onSubtitleState) {
        window.squaredElectron.onSubtitleState(update);
      }
    </script>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add electron/subtitles.ts electron/subtitles.html
git commit -m "feat: add Subtitles Electron window"
```

---

## Chunk 2: IPC, Main Process & Preload Wiring

### Task 4: Update paths.ts for new HTML files

**Files:**
- Modify: `electron/paths.ts`

- [ ] **Step 1: Add new paths**

Add to the `ElectronPaths` interface:

```typescript
statusPillHtmlPath: string;
subtitlesHtmlPath: string;
```

Add to the return object of `getElectronPaths()`:

```typescript
statusPillHtmlPath: path.resolve(resourcesRoot, 'electron/statusPill.html'),
subtitlesHtmlPath: path.resolve(resourcesRoot, 'electron/subtitles.html'),
```

- [ ] **Step 2: Commit**

```bash
git add electron/paths.ts
git commit -m "feat: add status pill and subtitles paths"
```

---

### Task 5: Update preload.ts

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add new IPC channels to preload bridge**

Replace `electron/preload.ts` contents:

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAppStatus, OverlayState, PillState, SubtitleState } from '../shared/types.js';

contextBridge.exposeInMainWorld('squaredElectron', {
  isElectron: true,

  // Legacy overlay (kept for backward compat during transition)
  updateOverlay: (state: OverlayState) => ipcRenderer.send('overlay:update', state),
  clearOverlay: () => ipcRenderer.send('overlay:clear'),
  onOverlayState: (listener: (state: OverlayState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state);
    ipcRenderer.on('overlay:state', handler);
    return () => ipcRenderer.removeListener('overlay:state', handler);
  },

  // New pill + subtitles
  updatePill: (state: PillState) => ipcRenderer.send('pill:update', state),
  updateSubtitles: (state: SubtitleState) => ipcRenderer.send('subtitle:update', state),
  onPillState: (listener: (state: PillState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PillState) => listener(state);
    ipcRenderer.on('pill:state', handler);
    return () => ipcRenderer.removeListener('pill:state', handler);
  },
  onSubtitleState: (listener: (state: SubtitleState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SubtitleState) => listener(state);
    ipcRenderer.on('subtitle:state', handler);
    return () => ipcRenderer.removeListener('subtitle:state', handler);
  },

  // Main window hide/show
  hideMainWindow: () => ipcRenderer.send('main-window:hide'),
  showMainWindow: () => ipcRenderer.send('main-window:show'),

  // Stop session (from pill Stop button)
  stopSession: () => ipcRenderer.send('session:stop'),
  onStopSession: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('session:stop', handler);
    return () => ipcRenderer.removeListener('session:stop', handler);
  },

  // App status
  setAppStatus: (status: DesktopAppStatus) => ipcRenderer.send('app-status:update', status),
});
```

- [ ] **Step 2: Update electron.d.ts to match**

Update `src/electron.d.ts` to include all new methods:

```typescript
import type { DesktopAppStatus, OverlayState, PillState, SubtitleState } from './types';

declare global {
  interface Window {
    squaredElectron?: {
      isElectron: boolean;
      updateOverlay: (state: OverlayState) => void;
      updatePill: (state: PillState) => void;
      updateSubtitles: (state: SubtitleState) => void;
      clearOverlay: () => void;
      hideMainWindow: () => void;
      showMainWindow: () => void;
      stopSession: () => void;
      onStopSession: (listener: () => void) => () => void;
      setAppStatus: (status: DesktopAppStatus) => void;
      onOverlayState?: (listener: (state: OverlayState) => void) => () => void;
      onPillState?: (listener: (state: PillState) => void) => () => void;
      onSubtitleState?: (listener: (state: SubtitleState) => void) => () => void;
    };
  }
}

export {};
```

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts src/electron.d.ts
git commit -m "feat: extend preload bridge with pill, subtitles, and window management IPC"
```

---

### Task 6: Rewrite ipc.ts for dual windows

**Files:**
- Modify: `electron/ipc.ts`

- [ ] **Step 1: Replace ipc.ts contents**

```typescript
import { BrowserWindow, ipcMain } from 'electron';
import type { DesktopAppStatus, PillState, SubtitleState } from '../shared/types.js';
import { pushPillState } from './statusPill.js';
import { pushSubtitleState } from './subtitles.js';

const hiddenPill: PillState = {
  visible: false,
  elapsed: '0:00',
  currentSlide: null,
  pace: '',
  eyeContact: '',
  posture: '',
  fillerCount: 0,
  confidenceScore: 0,
  overallScore: 0,
  agentMode: 'monitor',
  slideTimeRemaining: null,
};

const hiddenSubtitle: SubtitleState = {
  visible: false,
  mode: 'monitor',
  microPrompt: '',
  rescueText: '',
};

export interface IpcRegistration {
  setOverlayEnabled: (enabled: boolean) => void;
}

export function registerIpc(
  mainWindow: BrowserWindow,
  pillWindow: BrowserWindow,
  subtitlesWindow: BrowserWindow,
  options: {
    getOverlayEnabled: () => boolean;
    onStatusUpdate: (status: DesktopAppStatus) => void;
    onHideMainWindow: () => void;
    onShowMainWindow: () => void;
  },
): IpcRegistration {
  let pillState = hiddenPill;
  let subtitleState = hiddenSubtitle;
  let overlayEnabled = options.getOverlayEnabled();

  const renderPill = () => {
    pushPillState(pillWindow, overlayEnabled ? pillState : hiddenPill);
  };

  const renderSubtitles = () => {
    pushSubtitleState(subtitlesWindow, overlayEnabled ? subtitleState : hiddenSubtitle);
  };

  const handlePillUpdate = (_event: Electron.IpcMainEvent, state: PillState) => {
    pillState = state;
    renderPill();
  };

  const handleSubtitleUpdate = (_event: Electron.IpcMainEvent, state: SubtitleState) => {
    subtitleState = state;
    renderSubtitles();
  };

  const handleOverlayClear = () => {
    pillState = hiddenPill;
    subtitleState = hiddenSubtitle;
    renderPill();
    renderSubtitles();
  };

  const handleAppStatusUpdate = (_event: Electron.IpcMainEvent, status: DesktopAppStatus) => {
    options.onStatusUpdate(status);
  };

  const handleHideMainWindow = () => {
    options.onHideMainWindow();
  };

  const handleShowMainWindow = () => {
    options.onShowMainWindow();
  };

  const handleStopSession = () => {
    // Forward stop request back to main window renderer
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:stop');
    }
  };

  ipcMain.on('pill:update', handlePillUpdate);
  ipcMain.on('subtitle:update', handleSubtitleUpdate);
  ipcMain.on('overlay:clear', handleOverlayClear);
  ipcMain.on('app-status:update', handleAppStatusUpdate);
  ipcMain.on('main-window:hide', handleHideMainWindow);
  ipcMain.on('main-window:show', handleShowMainWindow);
  ipcMain.on('session:stop', handleStopSession);

  // Also handle legacy overlay:update — convert to pill+subtitle for transition
  const handleLegacyOverlayUpdate = (_event: Electron.IpcMainEvent, state: { visible: boolean; mode: string; microPrompt: string; rescueText: string; slideTimeRemaining: number | null; currentSlide: number | null }) => {
    subtitleState = {
      visible: Boolean(state.microPrompt || state.rescueText),
      mode: state.mode as SubtitleState['mode'],
      microPrompt: state.microPrompt,
      rescueText: state.rescueText,
    };
    renderSubtitles();
  };
  ipcMain.on('overlay:update', handleLegacyOverlayUpdate);

  const cleanup = () => {
    ipcMain.off('pill:update', handlePillUpdate);
    ipcMain.off('subtitle:update', handleSubtitleUpdate);
    ipcMain.off('overlay:update', handleLegacyOverlayUpdate);
    ipcMain.off('overlay:clear', handleOverlayClear);
    ipcMain.off('app-status:update', handleAppStatusUpdate);
    ipcMain.off('main-window:hide', handleHideMainWindow);
    ipcMain.off('main-window:show', handleShowMainWindow);
    ipcMain.off('session:stop', handleStopSession);
  };

  pillWindow.webContents.on('did-finish-load', () => renderPill());
  subtitlesWindow.webContents.on('did-finish-load', () => renderSubtitles());
  mainWindow.on('closed', cleanup);

  return {
    setOverlayEnabled: (enabled: boolean) => {
      overlayEnabled = enabled;
      renderPill();
      renderSubtitles();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/ipc.ts
git commit -m "feat: rewrite IPC to fan out to pill + subtitles windows"
```

---

### Task 7: Rewrite main.ts to use new windows

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Replace overlay references with pill + subtitles**

Key changes to `electron/main.ts`:
- Replace `overlayWindow` with `pillWindow` and `subtitlesWindow`
- Import `createPillWindow` and `createSubtitlesWindow` instead of `createOverlayWindow`
- Update `registerIpc` call with both windows + hide/show callbacks
- Add hide/show logic for main window

Full replacement for the window management variables at top:

```typescript
let mainWindow: BrowserWindow | null = null;
let pillWindow: BrowserWindow | null = null;
let subtitlesWindow: BrowserWindow | null = null;
```

Remove old import:
```typescript
// REMOVE: import { createOverlayWindow } from './overlay.js';
```

Add new imports:
```typescript
import { createPillWindow } from './statusPill.js';
import { createSubtitlesWindow } from './subtitles.js';
```

In `createWindows()`, replace:
```typescript
overlayWindow = createOverlayWindow(paths.preloadPath, paths.overlayHtmlPath);
ipcRegistration = registerIpc(mainWindow, overlayWindow, {
  getOverlayEnabled: () => overlayEnabled,
  onStatusUpdate: (status) => {
    appStatus = status;
    refreshTray();
  },
});
```

With:
```typescript
pillWindow = createPillWindow(paths.preloadPath, paths.statusPillHtmlPath);
subtitlesWindow = createSubtitlesWindow(paths.preloadPath, paths.subtitlesHtmlPath);
ipcRegistration = registerIpc(mainWindow, pillWindow, subtitlesWindow, {
  getOverlayEnabled: () => overlayEnabled,
  onStatusUpdate: (status) => {
    appStatus = status;
    refreshTray();
  },
  onHideMainWindow: () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  },
  onShowMainWindow: focusMainWindow,
});
```

In the `mainWindow.on('closed')` handler, replace overlay cleanup with:
```typescript
mainWindow.on('closed', () => {
  mainWindow = null;
  if (pillWindow && !pillWindow.isDestroyed()) pillWindow.close();
  if (subtitlesWindow && !subtitlesWindow.isDestroyed()) subtitlesWindow.close();
  pillWindow = null;
  subtitlesWindow = null;
  ipcRegistration = null;
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/main.ts
git commit -m "feat: replace single overlay with pill + subtitles windows in main process"
```

---

## Chunk 3: Frontend Integration

### Task 8: Update PresentationMode.tsx to use new IPC

**Files:**
- Modify: `src/components/PresentationMode.tsx`

- [ ] **Step 1: Import new helper functions**

At the top of PresentationMode.tsx, update the import from `../types`:

```typescript
import { DEFAULT_INDICATORS, GamePlan, IndicatorData, IndicatorUpdate, ProjectDetails, indicatorToPillState, indicatorToSubtitleState, mergeIndicatorData } from '../types';
```

(Remove `indicatorToOverlayState` from the import.)

- [ ] **Step 2: Add stop session listener and hide/show logic**

Add after existing state declarations (around line 62):

```typescript
const isElectronApp = Boolean(window.squaredElectron?.isElectron);
const [mainWindowHidden, setMainWindowHidden] = useState(false);
const mainWindowHiddenRef = useRef(false);
const handleToggleConnectRef = useRef(handleToggleConnect);
```

Keep the ref in sync (add after `handleToggleConnect` definition):

```typescript
handleToggleConnectRef.current = handleToggleConnect;
```

Keep `mainWindowHiddenRef` in sync — update whenever state changes (in the `setMainWindowHidden` calls, also update the ref):

```typescript
// Wherever setMainWindowHidden(true) is called, also add:
mainWindowHiddenRef.current = true;
// Wherever setMainWindowHidden(false) is called, also add:
mainWindowHiddenRef.current = false;
```

Add useEffect for stop session listener (after the existing useEffects). Uses ref to avoid stale closure:

```typescript
useEffect(() => {
  if (!window.squaredElectron?.onStopSession) return;
  const unsubscribe = window.squaredElectron.onStopSession(() => {
    handleToggleConnectRef.current();
  });
  return unsubscribe;
}, []);
```

- [ ] **Step 3: Replace overlay update effect**

Replace the existing overlay update effect (lines 181-186):

```typescript
// OLD:
// useEffect(() => {
//   const overlayState = indicatorToOverlayState(indicators);
//   if (window.squaredElectron?.updateOverlay) {
//     window.squaredElectron.updateOverlay(overlayState);
//   }
// }, [indicators]);

// NEW:
useEffect(() => {
  if (!window.squaredElectron) return;
  if (window.squaredElectron.updatePill) {
    window.squaredElectron.updatePill(indicatorToPillState(indicators, elapsed));
  }
  if (window.squaredElectron.updateSubtitles) {
    window.squaredElectron.updateSubtitles(indicatorToSubtitleState(indicators));
  }
}, [indicators, elapsed]);
```

- [ ] **Step 4: Replace cleanup effect**

Replace the existing cleanup effect (lines 188-193). Uses `mainWindowHiddenRef` to avoid re-running the effect mid-session:

```typescript
useEffect(() => {
  return () => {
    window.squaredElectron?.clearOverlay?.();
    window.squaredElectron?.setAppStatus?.({ mode: 'idle', connected: false });
    if (mainWindowHiddenRef.current) {
      window.squaredElectron?.showMainWindow?.();
    }
  };
}, []);
```

- [ ] **Step 5: Update disconnect handler**

In `handleToggleConnect`, replace `window.squaredElectron?.clearOverlay?.()` calls with:

```typescript
window.squaredElectron?.clearOverlay?.();
if (mainWindowHiddenRef.current) {
  window.squaredElectron?.showMainWindow?.();
  setMainWindowHidden(false);
  mainWindowHiddenRef.current = false;
}
```

- [ ] **Step 6: Add "Hide & Present" button to the control bar**

In the control bar (the absolute bottom bar), add a button when connected and in Electron:

After the End button, inside the control bar div, add:

```typescript
{isConnected && isElectronApp && !mainWindowHidden && (
  <button
    onClick={() => {
      window.squaredElectron?.hideMainWindow?.();
      setMainWindowHidden(true);
    }}
    className="h-10 px-4 rounded-xl font-medium text-sm flex items-center gap-2 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-all"
  >
    <Presentation className="w-3.5 h-3.5" />
    Hide & Present
  </button>
)}
```

Also add this import if not already present: `Presentation` from lucide-react (already imported).

- [ ] **Step 7: Commit**

```bash
git add src/components/PresentationMode.tsx
git commit -m "feat: wire PresentationMode to new pill + subtitles IPC"
```

---

> **Note on tray:** The existing "Show Squared" tray menu item already calls `focusMainWindow()` which does `mainWindow.show()`. No tray changes needed — it will restore the hidden window automatically.

### Task 9: Remove old overlay files and update copy-resources

**Files:**
- Delete: `electron/overlay.ts`
- Delete: `electron/overlay.html`
- Modify: `electron/paths.ts` — remove `overlayHtmlPath`
- Modify: `electron/scripts/copy-resources.mjs` — copy new HTML files instead of overlay.html
- Modify: `src/types.ts` — remove dead `indicatorToOverlayState` function

- [ ] **Step 1: Remove old overlay files**

```bash
rm electron/overlay.ts electron/overlay.html
```

- [ ] **Step 2: Clean up paths.ts**

Remove `overlayHtmlPath` from the `ElectronPaths` interface and from the return object of `getElectronPaths()`.

- [ ] **Step 3: Update copy-resources.mjs**

Replace the overlay.html copy with the two new HTML files in `electron/scripts/copy-resources.mjs`:

```javascript
// REMOVE:
// await copyResource(
//   path.resolve(projectRoot, 'electron/overlay.html'),
//   path.resolve(distResourcesDir, 'electron/overlay.html'),
// );

// ADD:
await copyResource(
  path.resolve(projectRoot, 'electron/statusPill.html'),
  path.resolve(distResourcesDir, 'electron/statusPill.html'),
);

await copyResource(
  path.resolve(projectRoot, 'electron/subtitles.html'),
  path.resolve(distResourcesDir, 'electron/subtitles.html'),
);
```

- [ ] **Step 4: Remove dead code from src/types.ts**

Remove `indicatorToOverlayState` function and the `OverlayState` import if no longer used elsewhere. Also remove the legacy `overlay:update` handler from `electron/ipc.ts` — after PresentationMode is updated in Task 8, nothing sends this channel anymore.

- [ ] **Step 5: Verify no remaining imports of old overlay**

Search for any remaining `import.*overlay` references in `electron/` files and remove them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove old overlay files and update packaging resources"
```

---

### Task 10: Build verification

- [ ] **Step 1: Run TypeScript check**

```bash
npm run lint
```

Expected: no type errors.

- [ ] **Step 2: Run full build (web + server + electron)**

```bash
npm run build
```

Expected: builds successfully (this chains `build:web`, `build:server`, `build:electron`).

- [ ] **Step 3: Run desktop resource copy and verify**

```bash
npm run copy:desktop-resources
ls dist-resources/electron/
```

Expected: `statusPill.html` and `subtitles.html` exist in `dist-resources/electron/`. `overlay.html` should NOT be present.

- [ ] **Step 4: Commit any build fixes**

If any build issues were found and fixed, commit them.

```bash
git add -A
git commit -m "fix: resolve build issues from overlay redesign"
```
