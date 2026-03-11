# Session Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gemini Live API session management (context window compression, session resumption, GoAway handling, auto-reconnect) to `useLiveAPI` hook for unlimited session duration and seamless reconnection.

**Architecture:** All changes go into the existing `useLiveAPI.ts` hook plus minimal UI changes. Key refactor: extract `withOpenSession`, `isSessionTransportOpen`, and the `onmessage` handler logic out of `connect()` into hook-level functions so both `connect()` and `reconnect()` share them. A new `closeSession()` handles WebSocket-only teardown. The full config is stored in a ref so `reconnect()` reuses it exactly.

**Tech Stack:** React 19, TypeScript, `@google/genai` SDK v1.42.0

**Spec:** `docs/superpowers/specs/2026-03-12-session-management-design.md`

---

## Chunk 1: Refactor shared functions out of connect()

### Task 1: Add new refs and state

**Files:**
- Modify: `src/hooks/useLiveAPI.ts:261-298`

- [ ] **Step 1: Add `isReconnecting` state and new refs**

After line 264 (`const [error, setError] = useState<string | null>(null);`), add:

```ts
const [isReconnecting, setIsReconnecting] = useState(false);
```

After line 298 (`const lastLocalVisualSignatureRef = useRef('');`), add:

```ts
// Session management refs
const resumptionHandleRef = useRef<string | null>(null);
const isReconnectingRef = useRef(false);
const reconnectAttemptsRef = useRef(0);
const userInitiatedDisconnectRef = useRef(false);
const reconnectTimeoutRef = useRef<number | null>(null);
const aiRef = useRef<GoogleGenAI | null>(null);
const connectConfigRef = useRef<any>(null);
const workletNodeRef = useRef<AudioWorkletNode | null>(null);
```

- [ ] **Step 2: Verify build**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "feat(session): add refs and state for session management"
```

---

### Task 2: Move `isSessionTransportOpen` and `withOpenSession` to hook level

Currently these are local functions inside `connect()` (lines 494-510). They need to be accessible from both `connect()` and `reconnect()`. Making `withOpenSession` read from `sessionRef` directly (instead of closing over a local `sessionPromise`) is the key change that allows media senders to auto-target the new session after reconnect.

**Files:**
- Modify: `src/hooks/useLiveAPI.ts:494-510` (remove from connect), `src/hooks/useLiveAPI.ts:396` (add at hook level)

- [ ] **Step 1: Add hook-level functions after `clearSpeakingTimers` (after line 334)**

```ts
const isSessionTransportOpen = useCallback((session: any) => {
  const readyState = session?.conn?.ws?.readyState;
  if (typeof readyState === 'number') {
    return readyState === 1;
  }
  return isSocketOpenRef.current;
}, []);

const withOpenSession = useCallback((handler: (session: any) => void) => {
  const currentPromise = sessionRef.current;
  if (!currentPromise || !isSocketOpenRef.current) return;
  if (!isSessionReadyRef.current) return;
  currentPromise.then((session: any) => {
    if (sessionRef.current !== currentPromise || !isSocketOpenRef.current) return;
    if (!isSessionReadyRef.current) return;
    if (!isSessionTransportOpen(session)) return;
    handler(session);
  });
}, [isSessionTransportOpen]);
```

- [ ] **Step 2: Remove the old local versions from inside `connect()`**

Delete lines 494-510 (the local `isSessionTransportOpen` and `withOpenSession` definitions, plus the `let sessionPromise` declaration).

Add just the local variable right before `ai.live.connect()` (before line 729):

```ts
let sessionPromise: Promise<any>;
```

- [ ] **Step 3: Fix stale `sessionPromise` guards in long-lived callbacks**

After reconnect, `sessionRef.current` points to the new session, but the worklet handler, video interval, local visual interval, and derived indicators interval all close over the OLD `sessionPromise` from `connect()`. Their guard `sessionRef.current !== sessionPromise` will ALWAYS fail after reconnect, silently blocking all sends and computations.

Fix the following guards:

**Audio worklet `port.onmessage` (~line 830):** Remove the stale guard. `withOpenSession` already handles session identity checks:
```ts
// BEFORE:
workletNode.port.onmessage = (e) => {
  if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
  // ...send audio...
};

// AFTER:
workletNode.port.onmessage = (e) => {
  if (!isSocketOpenRef.current) return;
  // ...send audio (withOpenSession handles session identity)...
};
```

**Video frame interval (~line 874):** Same fix — remove `sessionRef.current !== sessionPromise` check, keep `!isSocketOpenRef.current`:
```ts
// BEFORE:
if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
// AFTER:
if (!isSocketOpenRef.current) return;
```

**Derived indicators interval (~line 562):** Remove the `sessionRef.current !== sessionPromise` guard entirely. Derived indicators compute from local state (word timestamps, analyser data) and should continue regardless of which session is active:
```ts
// BEFORE:
if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) {
// AFTER:
if (!isSocketOpenRef.current) {
```

**Local visual interval (~line 623):** Same fix:
```ts
// BEFORE:
if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
// AFTER:
if (!isSocketOpenRef.current) return;
```

**Speech timing timeouts inside `handleServerMessage`** are fine — they receive `sessionPromise` as a parameter, which is the correct session for each invocation.

- [ ] **Step 4: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "refactor(session): move withOpenSession to hook level for reconnect support"
```

---

### Task 3: Extract shared `handleServerMessage` function

The `onmessage` callback in `connect()` (lines 950-1092) handles: setupComplete, transcriptions, audio playback with speech timing, interrupts, tool calls. Both `connect()` and `reconnect()` need identical behavior. Extract it to avoid duplication.

**Files:**
- Modify: `src/hooks/useLiveAPI.ts`

- [ ] **Step 1: Create refs for callback props to avoid stale closures**

After the existing refs block (around line 298), add:

```ts
const onIndicatorsUpdateRef = useRef(onIndicatorsUpdate);
onIndicatorsUpdateRef.current = onIndicatorsUpdate;
const onSlideAnalysisRef = useRef(onSlideAnalysis);
onSlideAnalysisRef.current = onSlideAnalysis;
```

- [ ] **Step 2: Create the `handleServerMessage` function at hook level**

Add after `withOpenSession` (from Task 2):

```ts
const handleServerMessage = useCallback((
  message: LiveServerMessage,
  sessionPromise: Promise<any>,
  playbackContext: AudioContext,
  sessionMode: 'rehearsal' | 'presentation',
  ingestInputTranscript: (text: string) => void,
  reconnectFn: () => void,
) => {
  if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;

  if (message.setupComplete) {
    isSessionReadyRef.current = true;
    console.log(`[DebateCoach] Session setup complete at ${new Date().toISOString()}`);
  }

  // Session resumption handle
  if (message.sessionResumptionUpdate) {
    if (message.sessionResumptionUpdate.resumable !== false && message.sessionResumptionUpdate.newHandle) {
      resumptionHandleRef.current = message.sessionResumptionUpdate.newHandle;
      console.debug(`[DebateCoach] Session resumption handle updated`);
    }
  }

  // GoAway — server will disconnect soon
  if (message.goAway) {
    console.log(`[DebateCoach] GoAway received, timeLeft: ${message.goAway.timeLeft}`);
    if (!isReconnectingRef.current) {
      reconnectFn();
    }
  }

  // Input/output transcriptions
  const sc = message.serverContent as any;
  if (sc?.inputTranscription?.text) {
    console.log(`[DebateCoach] User said: "${sc.inputTranscription.text}"`);
    ingestInputTranscript(sc.inputTranscription.text);
  }
  if (sc?.outputTranscription?.text) {
    console.debug(`[DebateCoach] Model said: "${sc.outputTranscription.text}"`);
  }

  // Audio playback with speech timing
  if (message.serverContent?.modelTurn) {
    const parts = message.serverContent.modelTurn.parts;
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data && sessionMode === 'rehearsal') {
        const base64Audio = part.inlineData.data;
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const pcm16 = new Int16Array(bytes.buffer);
        const audioBuffer = playbackContext.createBuffer(1, pcm16.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < pcm16.length; i++) {
          channelData[i] = pcm16[i] / 32768;
        }
        const sourceNode = playbackContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        if (playbackAnalyserRef.current) {
          sourceNode.connect(playbackAnalyserRef.current);
        } else {
          sourceNode.connect(playbackContext.destination);
        }

        const startTime = Math.max(playbackContext.currentTime, nextPlayTimeRef.current);
        sourceNode.start(startTime);
        nextPlayTimeRef.current = startTime + audioBuffer.duration;
        sourceNodesRef.current.push(sourceNode);

        if (speechStopTimeoutRef.current !== null) {
          clearTimeout(speechStopTimeoutRef.current);
          speechStopTimeoutRef.current = null;
        }

        const startDelayMs = Math.max(0, (startTime - playbackContext.currentTime) * 1000);
        if (startDelayMs <= 20) {
          setSpeakingState(true);
        } else {
          const timeoutId = window.setTimeout(() => {
            speechStartTimeoutsRef.current = speechStartTimeoutsRef.current.filter(id => id !== timeoutId);
            if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
            setSpeakingState(true);
          }, startDelayMs);
          speechStartTimeoutsRef.current.push(timeoutId);
        }

        sourceNode.onended = () => {
          sourceNodesRef.current = sourceNodesRef.current.filter(n => n !== sourceNode);
          if (sourceNodesRef.current.length === 0) {
            if (speechStopTimeoutRef.current !== null) {
              clearTimeout(speechStopTimeoutRef.current);
            }
            speechStopTimeoutRef.current = window.setTimeout(() => {
              speechStopTimeoutRef.current = null;
              if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
              setSpeakingState(false);
            }, 90);
          }
        };
      }
    }
  }

  // Interrupted
  if (message.serverContent?.interrupted) {
    clearSpeakingTimers();
    sourceNodesRef.current.forEach(node => {
      try { node.stop(); } catch (e) { }
    });
    sourceNodesRef.current = [];
    setSpeakingState(false);
    nextPlayTimeRef.current = playbackContext.currentTime;
  }

  // Tool calls
  if (message.toolCall) {
    for (const call of message.toolCall.functionCalls) {
      if (call.name === 'updateIndicators' && onIndicatorsUpdateRef.current) {
        console.log(`[DebateCoach] Tool call received at ${new Date().toISOString()}`, {
          pace: call.args?.pace,
          eyeContact: call.args?.eyeContact,
          overallScore: call.args?.overallScore,
          currentSlide: call.args?.currentSlide,
          agentMode: call.args?.agentMode,
          microPrompt: call.args?.microPrompt,
          rescueText: call.args?.rescueText,
        });
        if (call.args && typeof call.args === 'object') {
          const update = { ...(call.args as IndicatorUpdate) };
          if (localVisualActiveRef.current) {
            delete update.eyeContact;
            delete update.posture;
          }
          onIndicatorsUpdateRef.current(update);
        }
      }

      if (call.name === 'saveSlideAnalysis' && onSlideAnalysisRef.current && call.args && typeof call.args === 'object') {
        const payload = call.args as unknown as SlideAnalysisToolPayload;
        if (typeof payload.slideNumber === 'number' && Array.isArray(payload.issues) && typeof payload.riskLevel === 'string') {
          onSlideAnalysisRef.current({
            slideNumber: payload.slideNumber,
            issues: payload.issues,
            bestPhrase: payload.bestPhrase ?? '',
            riskLevel: payload.riskLevel,
          });
        }
      }

      withOpenSession((session) => {
        try {
          session.sendToolResponse({
            functionResponses: [{
              id: call.id,
              name: call.name,
              response: { result: "ok" },
              scheduling: FunctionResponseScheduling.SILENT,
            }]
          });
        } catch (err) { }
      });
    }
  }
}, [withOpenSession, setSpeakingState, clearSpeakingTimers]);
```

- [ ] **Step 3: Replace `onmessage` in `connect()` to use `handleServerMessage`**

Replace the entire `onmessage` callback (lines 950-1092) with:

```ts
onmessage: async (message: LiveServerMessage) => {
  handleServerMessage(message, sessionPromise, playbackContext, mode, ingestInputTranscript, reconnect);
},
```

Note: `reconnect` doesn't exist yet. Add a placeholder before `connect()`:

```ts
// Placeholder — replaced after reconnect is defined
let reconnect = () => { console.warn('[DebateCoach] reconnect not yet initialized'); };
```

- [ ] **Step 4: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "refactor(session): extract handleServerMessage for shared use by connect and reconnect"
```

---

## Chunk 2: Session management and reconnect

### Task 4: Add `contextWindowCompression` and `sessionResumption` to connect config, store full config

**Files:**
- Modify: `src/hooks/useLiveAPI.ts:729-813` (inside `ai.live.connect()`)

- [ ] **Step 1: Extract tool declarations into a variable**

Before the `ai.live.connect()` call (~line 729), extract the tools array:

```ts
const toolDeclarations = [{
  functionDeclarations: [{
    name: "updateIndicators",
    // ... (keep the existing tool declaration exactly as-is)
  }, {
    name: "saveSlideAnalysis",
    // ... (keep the existing tool declaration exactly as-is)
  }]
}];
```

Then replace the inline `tools: [...]` in the config with `tools: toolDeclarations`.

- [ ] **Step 2: Add session management config fields**

In the `ai.live.connect()` config, after `outputAudioTranscription: {},`, add:

```ts
sessionResumption: {
  handle: resumptionHandleRef.current || undefined,
  transparent: false,
},
contextWindowCompression: {
  slidingWindow: {},
},
```

- [ ] **Step 3: Store `ai` instance and full config in refs**

After `const ai = new GoogleGenAI(...)` (line 408), add:
```ts
aiRef.current = ai;
```

After `sessionRef.current = sessionPromise;` (~line 1122), add:
```ts
connectConfigRef.current = {
  model: "gemini-2.5-flash-native-audio-latest",
  config: {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      activityHandling: mode === 'presentation'
        ? ActivityHandling.NO_INTERRUPTION
        : ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
      turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
      automaticActivityDetection: {
        disabled: false,
        silenceDurationMs: mode === 'presentation' ? 500 : 200,
        prefixPaddingMs: 20,
      },
    },
    proactivity: { proactiveAudio: true },
    enableAffectiveDialog: true,
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
    },
    systemInstruction,
    sessionResumption: {
      handle: resumptionHandleRef.current || undefined,
      transparent: false,
    },
    contextWindowCompression: {
      slidingWindow: {},
    },
    tools: toolDeclarations,
  },
  mode,
};
```

Also store workletNode ref after its creation (~line 467):
```ts
workletNodeRef.current = workletNode;
```

- [ ] **Step 4: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "feat(session): add compression/resumption config and store for reconnect"
```

---

### Task 5: Add `closeSession()` function

**Files:**
- Modify: `src/hooks/useLiveAPI.ts` (add between `disconnect` and `connect`)

- [ ] **Step 1: Add `closeSession` after `disconnect`**

After the `disconnect` function (after line 396):

```ts
const closeSession = useCallback(() => {
  const currentSessionPromise = sessionRef.current;
  sessionRef.current = null;
  isSocketOpenRef.current = false;
  isSessionReadyRef.current = false;
  if (currentSessionPromise) {
    currentSessionPromise.then((session: any) => {
      try { session.close(); } catch (e) { }
    });
  }
}, []);
```

- [ ] **Step 2: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "feat(session): add closeSession for WebSocket-only teardown"
```

---

### Task 6: Implement `reconnect()` and wire up GoAway

The core reconnect function. Uses `closeSession()` for WebSocket teardown, `connectConfigRef` for config, `aiRef` for the API instance, and `handleServerMessage` for message processing. No code duplication with `connect()`.

**Files:**
- Modify: `src/hooks/useLiveAPI.ts`

- [ ] **Step 1: Replace the placeholder `reconnect` with the real implementation**

Replace the placeholder `let reconnect = ...` (from Task 3 Step 3) with:

```ts
const reconnectRef = useRef<() => void>(() => {});
```

Then after `closeSession` and before `connect`, add:

```ts
const doReconnect = useCallback(async () => {
  if (isReconnectingRef.current) return;
  if (!aiRef.current || !connectConfigRef.current) return;

  isReconnectingRef.current = true;
  setIsReconnecting(true);
  console.log(`[DebateCoach] Reconnecting (attempt ${reconnectAttemptsRef.current + 1})...`);

  closeSession();

  const ai = aiRef.current;
  const storedConfig = connectConfigRef.current;
  const playbackContext = playbackContextRef.current;

  if (!playbackContext) {
    console.error('[DebateCoach] Cannot reconnect: playback context missing');
    isReconnectingRef.current = false;
    setIsReconnecting(false);
    setError('Connection lost. Please reconnect.');
    return;
  }

  // Update the session resumption handle in stored config
  const config = {
    ...storedConfig.config,
    sessionResumption: {
      handle: resumptionHandleRef.current || undefined,
      transparent: false,
    },
  };

  try {
    const sessionPromise = ai.live.connect({
      model: storedConfig.model,
      config,
      callbacks: {
        onopen: () => {
          if (sessionRef.current !== sessionPromise) return;
          console.log(`[DebateCoach] Reconnected at ${new Date().toISOString()}`);
          isSocketOpenRef.current = true;
          isSessionReadyRef.current = false;
          reconnectAttemptsRef.current = 0;
          isReconnectingRef.current = false;
          setIsReconnecting(false);
          // Do NOT toggle isConnected — keep it true throughout reconnect
          // Push current local visual state to maintain indicator continuity
          onIndicatorsUpdateRef.current?.({
            eyeContact: eyeStatusRef.current.current,
            posture: postureStatusRef.current.current,
          });
        },
        onmessage: async (message: LiveServerMessage) => {
          handleServerMessage(message, sessionPromise, playbackContext, storedConfig.mode, ingestInputTranscriptRef.current, reconnectRef.current);
        },
        onclose: (event: CloseEvent) => {
          if (sessionRef.current !== sessionPromise) return;
          if (userInitiatedDisconnectRef.current) return;
          console.debug(`[DebateCoach] Reconnected session closed`, { code: event.code, reason: event.reason });
          isSocketOpenRef.current = false;
          isSessionReadyRef.current = false;
          if (reconnectAttemptsRef.current < 3) {
            reconnectAttemptsRef.current++;
            isReconnectingRef.current = false;
            const delay = 500 * Math.pow(2, reconnectAttemptsRef.current - 1);
            console.log(`[DebateCoach] Will reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
            reconnectTimeoutRef.current = window.setTimeout(() => reconnectRef.current(), delay);
          } else {
            isReconnectingRef.current = false;
            setIsReconnecting(false);
            setError('Connection lost. Please reconnect.');
            disconnect({ skipSessionClose: true });
          }
        },
        onerror: (err: any) => {
          if (sessionRef.current !== sessionPromise) return;
          console.error('[DebateCoach] Reconnect error:', err);
          isSocketOpenRef.current = false;
          isSessionReadyRef.current = false;
          if (reconnectAttemptsRef.current < 3) {
            reconnectAttemptsRef.current++;
            isReconnectingRef.current = false;
            const delay = 500 * Math.pow(2, reconnectAttemptsRef.current - 1);
            reconnectTimeoutRef.current = window.setTimeout(() => reconnectRef.current(), delay);
          } else {
            isReconnectingRef.current = false;
            setIsReconnecting(false);
            setError('Connection lost. Please reconnect.');
            disconnect({ skipSessionClose: true });
          }
        },
      },
    });

    sessionRef.current = sessionPromise;
  } catch (err: any) {
    console.error('[DebateCoach] Reconnect failed:', err);
    isReconnectingRef.current = false;
    if (reconnectAttemptsRef.current < 3) {
      reconnectAttemptsRef.current++;
      const delay = 500 * Math.pow(2, reconnectAttemptsRef.current - 1);
      reconnectTimeoutRef.current = window.setTimeout(() => reconnectRef.current(), delay);
    } else {
      setIsReconnecting(false);
      setError('Connection lost. Please reconnect.');
      disconnect({ skipSessionClose: true });
    }
  }
}, [closeSession, disconnect, handleServerMessage]);
```

Then add a ref sync right after:

```ts
reconnectRef.current = doReconnect;
```

Also add `ingestInputTranscriptRef` alongside the other callback refs (from Task 3 Step 1). The `ingestInputTranscript` function is defined inside `connect()`, so we need a ref for it:

```ts
const ingestInputTranscriptRef = useRef<(text: string) => void>(() => {});
```

Inside `connect()`, after `ingestInputTranscript` is defined (~line 560), add:

```ts
ingestInputTranscriptRef.current = ingestInputTranscript;
```

- [ ] **Step 2: Update `handleServerMessage` and `connect()`'s `onmessage` to use `reconnectRef`**

In `connect()`'s `onmessage` (now a one-liner from Task 3 Step 3), update to use `reconnectRef.current`:

```ts
onmessage: async (message: LiveServerMessage) => {
  handleServerMessage(message, sessionPromise, playbackContext, mode, ingestInputTranscript, reconnectRef.current);
},
```

Remove the old placeholder `let reconnect = ...`.

- [ ] **Step 3: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "feat(session): implement reconnect with shared message handler"
```

---

### Task 7: Modify `disconnect()` and `connect()` for session management

**Files:**
- Modify: `src/hooks/useLiveAPI.ts:336-396` (disconnect), `src/hooks/useLiveAPI.ts:398` (connect)

- [ ] **Step 1: Add session management cleanup to `disconnect()`**

At the start of `disconnect()`, after line 337 (`const shouldCloseSession = !options?.skipSessionClose;`), add:

```ts
userInitiatedDisconnectRef.current = true;
if (reconnectTimeoutRef.current !== null) {
  clearTimeout(reconnectTimeoutRef.current);
  reconnectTimeoutRef.current = null;
}
isReconnectingRef.current = false;
setIsReconnecting(false);
reconnectAttemptsRef.current = 0;
resumptionHandleRef.current = null;
```

- [ ] **Step 2: Reset `userInitiatedDisconnectRef` in `connect()`**

At the start of `connect()` (after `setIsConnecting(true);`), add:

```ts
userInitiatedDisconnectRef.current = false;
reconnectAttemptsRef.current = 0;
```

- [ ] **Step 3: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "feat(session): add session management cleanup to disconnect and connect"
```

---

### Task 8: Modify `onclose` and `onerror` in `connect()` for auto-reconnect

**Files:**
- Modify: `src/hooks/useLiveAPI.ts:1094-1118` (onclose and onerror callbacks in connect)

- [ ] **Step 1: Replace `onclose` callback in `connect()`**

Replace the existing `onclose` (lines 1094-1109) with:

```ts
onclose: (event: CloseEvent) => {
  if (sessionRef.current !== sessionPromise) return;
  const wasReady = isSessionReadyRef.current;
  console.debug(`[DebateCoach] Session closed at ${new Date().toISOString()}`, {
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
    wasReady,
  });
  isSocketOpenRef.current = false;
  isSessionReadyRef.current = false;

  if (userInitiatedDisconnectRef.current) return;

  // Session was never ready — likely auth/config error, don't retry
  if (!wasReady && event.code !== 1000) {
    const closeReason = event.reason?.trim();
    setError(closeReason ? `Session closed before setup: ${closeReason}` : `Session closed before setup (code ${event.code})`);
    disconnect({ skipSessionClose: true });
    return;
  }

  // GoAway already triggered reconnect
  if (isReconnectingRef.current) return;

  // Auto-reconnect with exponential backoff
  if (reconnectAttemptsRef.current < 3) {
    reconnectAttemptsRef.current++;
    const delay = 500 * Math.pow(2, reconnectAttemptsRef.current - 1);
    console.log(`[DebateCoach] Will reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
    reconnectTimeoutRef.current = window.setTimeout(() => reconnectRef.current(), delay);
  } else {
    setError('Connection lost. Please reconnect.');
    disconnect({ skipSessionClose: true });
  }
},
```

- [ ] **Step 2: Replace `onerror` callback in `connect()`**

Replace the existing `onerror` (lines 1111-1118) with:

```ts
onerror: (err: any) => {
  if (sessionRef.current !== sessionPromise) return;
  console.error("Live API Error:", err);
  isSocketOpenRef.current = false;
  isSessionReadyRef.current = false;

  if (userInitiatedDisconnectRef.current) return;

  if (reconnectAttemptsRef.current < 3) {
    reconnectAttemptsRef.current++;
    isReconnectingRef.current = false;
    const delay = 500 * Math.pow(2, reconnectAttemptsRef.current - 1);
    reconnectTimeoutRef.current = window.setTimeout(() => reconnectRef.current(), delay);
  } else {
    setError(err.message || "An error occurred");
    disconnect({ skipSessionClose: true });
  }
},
```

- [ ] **Step 3: Update hook return value**

Replace the return statement (~line 1131):

```ts
return { isConnected, isConnecting, isReconnecting, error, connect, disconnect, analyserRef, playbackAnalyserRef, isSpeaking };
```

- [ ] **Step 4: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLiveAPI.ts
git commit -m "feat(session): add auto-reconnect to onclose/onerror, expose isReconnecting"
```

---

## Chunk 3: UI and verification

### Task 9: Add reconnecting indicator to RehearsalMode

**Files:**
- Modify: `src/components/RehearsalMode.tsx`

- [ ] **Step 1: Destructure `isReconnecting` from hook**

Find the `useLiveAPI` destructuring (around line 144-160) and add `isReconnecting`:

```ts
const {
  isConnected,
  isConnecting,
  isReconnecting,
  error,
  connect,
  disconnect,
  analyserRef,
  playbackAnalyserRef,
  isSpeaking,
} = useLiveAPI({
```

- [ ] **Step 2: Update status indicator**

Find the status dot and text in the header. Update:

Status dot:
```tsx
<div className={`w-1.5 h-1.5 rounded-full ${isReconnecting ? 'bg-amber-400 animate-pulse' : isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-zinc-700'}`} />
```

Status text:
```tsx
<span className="text-xs text-zinc-500">
  {isReconnecting ? 'Reconnecting...' : isConnecting ? 'Connecting' : isConnected ? (isSpeaking ? 'Coach speaking' : 'Live') : 'Ready'}
</span>
```

- [ ] **Step 3: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/RehearsalMode.tsx
git commit -m "feat(session): add reconnecting indicator to RehearsalMode"
```

---

### Task 10: Add reconnecting indicator to PresentationMode

**Files:**
- Modify: `src/components/PresentationMode.tsx`

- [ ] **Step 1: Destructure `isReconnecting` from hook**

Find the `useLiveAPI` destructuring (around line 132) and add `isReconnecting`:

```ts
const { isConnected, isConnecting, isReconnecting, error, connect, disconnect } = useLiveAPI({
```

- [ ] **Step 2: Update status indicator**

Status dot:
```tsx
<div className={`w-1.5 h-1.5 rounded-full ${isReconnecting ? 'bg-amber-400 animate-pulse' : isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-zinc-700'}`} />
```

Status text:
```tsx
<span className="text-xs text-zinc-500">
  {isReconnecting ? 'Reconnecting...' : isConnecting ? 'Connecting' : isConnected ? 'Live' : 'Ready'}
</span>
```

- [ ] **Step 3: Verify build**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/PresentationMode.tsx
git commit -m "feat(session): add reconnecting indicator to PresentationMode"
```

---

### Task 11: Final build and manual verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build completes successfully

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`

Verify in browser:
- App loads, connects to Gemini Live API
- Console shows `Session resumption handle updated` messages
- Session survives beyond 2 minutes (context window compression working)
- Console shows GoAway handling if session runs ~10 min
- Status dot shows amber pulse during any reconnect
- User Stop button cleanly disconnects without zombie reconnects
- Indicators and metrics survive reconnect (not reset)
- No console errors during normal operation

- [ ] **Step 3: Commit any fixes**

```bash
git add src/hooks/useLiveAPI.ts src/components/RehearsalMode.tsx src/components/PresentationMode.tsx
git commit -m "fix(session): address issues found during smoke test"
```
