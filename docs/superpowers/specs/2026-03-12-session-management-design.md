# Session Management for Gemini Live API

## Problem

The current `useLiveAPI` hook has no session management:
- No context window compression — audio+video sessions cap at ~2 minutes
- No session resumption — WebSocket resets (~10 min) kill the session
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
- `slidingWindow: {}` uses default `targetTokens = triggerTokens/2`

### 2. Message Handling in `onmessage`

Two new handlers:

**`sessionResumptionUpdate`** — save the latest resumption token:
```ts
if (message.sessionResumptionUpdate?.newHandle) {
  resumptionHandleRef.current = message.sessionResumptionUpdate.newHandle;
}
```
Server sends this periodically. Token is valid for 2 hours after disconnect.

**`goAway`** — server warns about imminent disconnect:
```ts
if (message.goAway) {
  reconnect();
}
```
Initiate reconnect immediately on GoAway rather than waiting for `onclose`.

### 3. Reconnect Logic

**New refs:**
```ts
const resumptionHandleRef = useRef<string | null>(null);
const isReconnectingRef = useRef(false);
const reconnectAttemptsRef = useRef(0);
const userInitiatedDisconnectRef = useRef(false);
```

**`reconnect()` function:**
- Closes current WebSocket session (without triggering error state)
- Calls `ai.live.connect()` with same config but `sessionResumption.handle` = saved token
- Media pipeline (AudioWorklet, MediaPipe, video stream) is NOT recreated — only WebSocket
- Audio/video sending resumes automatically once new session opens

**`onclose` change:**
Instead of immediately disconnecting + showing error:
- If `userInitiatedDisconnectRef.current` — do nothing (user pressed Stop)
- If `reconnectAttemptsRef.current < 3` — retry with exponential backoff (500ms, 1s, 2s)
- If all 3 attempts fail — set error state, show "Connection lost"

**`disconnect()` change:**
Set `userInitiatedDisconnectRef.current = true` to distinguish user Stop from server disconnect. Reset `resumptionHandleRef` and `reconnectAttemptsRef`.

**`onopen` on reconnect:**
Reset `reconnectAttemptsRef = 0`, `isReconnectingRef = false`. Media streaming continues automatically since worklet port and video interval were never stopped.

### 4. UI State

New `isReconnecting` state returned from hook:
```ts
const [isReconnecting, setIsReconnecting] = useState(false);
return { isConnected, isConnecting, isReconnecting, error, ... };
```

- During reconnect: indicators stay visible, no error shown
- If reconnect takes >2 seconds: show small "Reconnecting..." banner (zinc-900, backdrop-blur)
- Banner disappears on successful reconnection
- After 3 failed attempts: existing error handling activates

UI change is minimal — one conditional banner in RehearsalMode/PresentationMode.

## Files to Modify

- `src/hooks/useLiveAPI.ts` — all session management logic (~80-100 lines added)
- `src/pages/RehearsalMode.tsx` — reconnecting banner
- `src/pages/PresentationMode.tsx` — reconnecting banner
