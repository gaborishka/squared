# Session Management for Gemini Live API

## Problem

The current `useLiveAPI` hook has no session management:
- No context window compression — audio+video sessions cap at ~2 minutes
- No session resumption — WebSocket resets (~approx 10 min per Gemini Live API docs) kill the session
- No GoAway handling — no graceful reconnection before server-initiated termination

## Requirements

- **Seamless reconnect** — user notices nothing during server-initiated disconnects
- **Unlimited session duration** — compression + resumption remove hard time limits
- **Graceful fallback** — banner after failed retries, then manual reconnect after ~30s
- **No buffering** — audio/video lost during reconnect gap is acceptable

## Approach

Embed session management directly into `useLiveAPI.ts`. No new hooks or wrappers. The WebSocket lifecycle logic already lives here; session management is a natural extension.

## Design

### 1. Config Changes

Add two fields to `ai.live.connect()` config:

```ts
sessionResumption: {
  handle: resumptionHandleRef.current || undefined,
  transparent: false,
},
contextWindowCompression: {
  slidingWindow: {},
},
```

- `transparent: false` because we chose no buffering — `lastConsumedClientMessageIndex` is not needed
- `slidingWindow: {}` uses server-default `triggerTokens`; if the default proves too aggressive or too lenient, this can be tuned later
- Note: `SlidingWindow.targetTokens` is typed as `string` in the SDK, not `number`

### 2. Message Handling in `onmessage`

Two new handlers:

**`sessionResumptionUpdate`** — save the latest resumption token, but only when resumable:
```ts
if (message.sessionResumptionUpdate) {
  if (message.sessionResumptionUpdate.resumable !== false && message.sessionResumptionUpdate.newHandle) {
    resumptionHandleRef.current = message.sessionResumptionUpdate.newHandle;
  }
}
```
Server sends this periodically. `resumable` can be `false` during function calls or generation — in that case, we keep the previous valid handle to avoid overwriting with empty/stale state. Token is valid for ~2 hours after disconnect (per API docs, verify if behavior changes).

**`goAway`** — server warns about imminent disconnect:
```ts
if (message.goAway) {
  console.log(`[DebateCoach] GoAway received, timeLeft: ${message.goAway.timeLeft}`);
  if (!isReconnectingRef.current) {
    reconnect();
  }
}
```
Initiate reconnect immediately on GoAway (rather than waiting for `onclose`). Guard with `isReconnectingRef` to prevent duplicate reconnect if `onclose` fires while reconnect is already in progress.

### 3. Reconnect Logic

#### 3a. Lifting state for reconnect access

Currently `connect()` creates the `GoogleGenAI` instance and session config as local variables. To make them accessible to `reconnect()`:

- Store `ai` instance in `aiRef = useRef<GoogleGenAI | null>(null)` during `connect()`
- Store the full config object in `sessionConfigRef = useRef<any>(null)` during `connect()`
- `reconnect()` reads from these refs to call `aiRef.current.live.connect(sessionConfigRef.current)`

#### 3b. Rebinding media senders after reconnect

The audio worklet `port.onmessage` handler and video frame interval close over the `sessionPromise` variable from `connect()`. After reconnect creates a new session promise, these closures would still reference the old one and silently refuse to send data (because `sessionRef.current !== sessionPromise` guard fails).

Solution: Change `withOpenSession` to read from `sessionRef` directly instead of closing over a local `sessionPromise`:

```ts
const withOpenSession = (handler: (session: any) => void) => {
  const currentPromise = sessionRef.current;
  if (!currentPromise || !isSocketOpenRef.current) return;
  currentPromise.then((session: any) => {
    if (sessionRef.current !== currentPromise || !isSocketOpenRef.current) return;
    if (!isSessionReadyRef.current) return;
    handler(session);
  });
};
```

Make `withOpenSession` a stable ref-based function (not a local closure inside `connect()`). Audio worklet and video interval call `withOpenSession` which always resolves to the current session. After reconnect, `sessionRef.current` points to the new session, so all sends go to the new WebSocket.

Similarly, the guard checks `if (sessionRef.current !== sessionPromise)` scattered in callbacks should be replaced with a generation counter pattern or removed in favor of the `withOpenSession` abstraction.

#### 3c. Light disconnect vs full teardown

The current `disconnect()` tears down everything — MediaStream, AudioContext, MediaPipe landmarkers, all intervals. This is correct for user-initiated Stop but wrong for reconnect.

Split into two paths:
- **`closeSession()`** (new, internal) — closes only the WebSocket session. Does not stop media stream, AudioContext, worklets, or MediaPipe. Used during reconnect.
- **`disconnect()`** (existing, modified) — calls `closeSession()` then tears down the full media pipeline. Sets `userInitiatedDisconnectRef.current = true`. Cancels any pending reconnect timeout. Resets `resumptionHandleRef`, `reconnectAttemptsRef`, `isReconnectingRef`.

#### 3d. New refs

```ts
const resumptionHandleRef = useRef<string | null>(null);
const isReconnectingRef = useRef(false);
const reconnectAttemptsRef = useRef(0);
const userInitiatedDisconnectRef = useRef(false);
const reconnectTimeoutRef = useRef<number | null>(null);
const aiRef = useRef<GoogleGenAI | null>(null);
const sessionConfigRef = useRef<any>(null);
```

#### 3e. `reconnect()` function

- Guards: if `isReconnectingRef.current` already true, skip (prevent double reconnect from GoAway + onclose race)
- Sets `isReconnectingRef.current = true`, `setIsReconnecting(true)`
- Calls `closeSession()` to close old WebSocket only
- Updates `sessionConfigRef` with current `resumptionHandleRef.current` as handle
- Calls `aiRef.current.live.connect(sessionConfigRef.current)` with same callbacks
- New `onopen`: resets `reconnectAttemptsRef = 0`, `isReconnectingRef = false`, `setIsReconnecting(false)`. Media streaming continues automatically via `withOpenSession`.

#### 3f. `onclose` change

Instead of immediately calling `disconnect()`:
```ts
onclose: (event) => {
  if (userInitiatedDisconnectRef.current) return;
  if (isReconnectingRef.current && reconnectAttemptsRef.current > 0) {
    // Already reconnecting, this is the old session closing — ignore
    return;
  }
  if (reconnectAttemptsRef.current < 3) {
    reconnectAttemptsRef.current++;
    const delay = 500 * Math.pow(2, reconnectAttemptsRef.current - 1);
    reconnectTimeoutRef.current = window.setTimeout(() => reconnect(), delay);
  } else {
    isReconnectingRef.current = false;
    setIsReconnecting(false);
    setError('Connection lost. Please reconnect.');
    disconnect({ skipSessionClose: true });
  }
}
```

### 4. UI State

New `isReconnecting` state returned from hook:
```ts
const [isReconnecting, setIsReconnecting] = useState(false);
return { isConnected, isConnecting, isReconnecting, error, ... };
```

**Critical: `isConnected` must NOT toggle during reconnect.** The callers (`RehearsalMode.tsx`, `PresentationMode.tsx`) have effects that reset all session state (metrics, feedback, indicators) when `isConnected` transitions to `true`. If `isConnected` briefly flips to `false` during reconnect, all accumulated data is wiped.

Solution: Keep `isConnected = true` throughout reconnect. Only set it to `false` when all retries fail or user disconnects. The `isReconnecting` state is the only signal for UI to show a banner.

UI changes:
- During reconnect: indicators stay visible, no error shown
- If reconnect takes >2 seconds: show small "Reconnecting..." banner (zinc-900, backdrop-blur)
- Banner disappears on successful reconnection
- After 3 failed attempts: existing error handling activates

UI change is minimal — one conditional banner in RehearsalMode/PresentationMode.

## Files to Modify

- `src/hooks/useLiveAPI.ts` — all session management logic
- `src/components/RehearsalMode.tsx` — reconnecting banner
- `src/components/PresentationMode.tsx` — reconnecting banner

## Manual Verification

Since no test framework is configured, verify manually:
- Session lasts >10 minutes without disconnecting (compression working)
- Console shows `SessionResumptionUpdate` messages with handles
- Console shows GoAway handling and reconnect logs
- User-initiated Stop during reconnect does not leave zombie sessions
- Indicators and accumulated metrics survive reconnect
- Reconnect banner appears briefly during server-initiated reconnect
