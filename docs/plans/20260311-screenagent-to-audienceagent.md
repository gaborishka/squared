# Convert ScreenAgent to AudienceAgent

## Overview
Convert the existing ScreenAgent (which watches presentation slides) into an AudienceAgent that watches the Zoom/Meet gallery view to detect audience engagement, reactions, and hand raises. This gives the speaker "eyes on the audience" during screen share when they can't see the gallery.

- **Presentation mode only** — AudienceAgent toggle button, off by default, lazy connect
- **Rehearsal mode** — remove second agent entirely, single DeliveryAgent only
- Key signals: engagement level, facial reactions, hands raised

## Context (from discovery)

**Architecture:** Two Gemini Live API sessions — DeliveryAgent (camera+mic) and ScreenAgent (screen capture). Model `gemini-2.5-flash-native-audio-latest` only supports Audio modality.

**Web versions** (`RehearsalMode.tsx`, `PresentationMode.tsx`) use `useLiveAPI` single-agent hook — no second agent, no changes needed for rehearsal web.

**Desktop versions** (`DesktopRehearsalMode.tsx`, `DesktopPresentationMode.tsx`) use `useDesktopDualLiveSession` — this is where the dual agent logic lives.

**Files involved (14 total):**
- `shared/types.ts` — ScreenAgentState, ScreenAgentUpdate, ScreenCueLaneState, DualAgentOverlayState, PillState, SubtitleState
- `src/types.ts` — DEFAULT_SCREEN_AGENT_STATE, mergeScreenAgentState, composeLegacyIndicators, composeDualAgentOverlayState, dualAgentToPillState, dualAgentToSubtitleState
- `src/lib/session.ts` — buildScreenAgentContext, formatScreenStateForDelivery, shouldForwardScreenStateToDelivery, currentSlideForFeedback, DeliveryAgent prompt mentions [ScreenAgent]
- `src/hooks/useScreenLiveAPI.ts` → rename to `src/hooks/useAudienceLiveAPI.ts`
- `src/hooks/useDesktopDualLiveSession.ts` — orchestrator (auto-connects screen, forwarding logic)
- `src/hooks/useDeliveryLiveAPI.ts` — [ScreenAgent] in system prompt
- `src/components/DualAgentOverlay.tsx` — screen section rendering
- `src/components/DesktopPresentationMode.tsx` — screen lane in sidebar, control bar
- `src/components/DesktopRehearsalMode.tsx` — uses dual session, screen lane
- `electron/statusPill.html` — screen-badge, screenCaptureStatus
- `electron/subtitles.html` — screen-lane, "Screen agent" label
- `electron/ipc.ts` — ScreenCueLaneState in SubtitleState, hiddenPill/hiddenSubtitle constants
- `electron/main.ts` — dialog title "Choose screen for ScreenAgent"
- `tests/dual-agent-state.test.ts` — imports all Screen types/functions, assertions reference [ScreenAgent]

## Development Approach
- **Testing approach**: Existing tests in `tests/dual-agent-state.test.ts` use `node:test` runner. These must be updated to match renamed types and functions. Verify via `npm run lint` (tsc --noEmit) and `npm run dev`.
- Complete each task fully before moving to the next
- Make small, focused changes
- Run `npm run lint` after each task to catch type errors

## Implementation Steps

### Task 1: Rename types — ScreenAgent → AudienceAgent

**Files:**
- Modify: `shared/types.ts`
- Modify: `src/types.ts`
- Modify: `electron/ipc.ts`

- [ ] In `shared/types.ts`: rename `ScreenCaptureStatus` → `AudienceCaptureStatus`, `ScreenPriority` → `AudiencePriority`
- [ ] In `shared/types.ts`: rename `ScreenAgentState` interface → `AudienceAgentState` with new fields: `engagement` ('high'|'moderate'|'low'|null), `reactions` (string), `handsRaised` (number|null). Keep `captureStatus`, `audiencePrompt` (was screenPrompt), `audienceDetails` (was screenDetails), `priority` (was screenPriority), `sourceLabel`. Remove `currentSlide`, `slideTimeRemaining`
- [ ] In `shared/types.ts`: rename `ScreenAgentUpdate` → `AudienceAgentUpdate` matching new fields
- [ ] In `shared/types.ts`: rename `ScreenCueLaneState` → `AudienceCueLaneState`, update fields (remove currentSlide, add engagement/reactions/handsRaised)
- [ ] In `shared/types.ts`: update `DualAgentOverlayState` — rename `screen` field → `audience`, remove `currentSlide`/`slideTimeRemaining` from top level (those stay in DeliveryAgent fallback only)
- [ ] In `shared/types.ts`: update `PillState` — rename `screenCaptureStatus` → `audienceCaptureStatus`. Note: `currentSlide` and `slideTimeRemaining` remain on PillState for DeliveryAgent fallback, but are never populated by AudienceAgent
- [ ] In `shared/types.ts`: update `SubtitleState` — rename `screen` field → `audience`
- [ ] In `src/types.ts`: rename `DEFAULT_SCREEN_AGENT_STATE` → `DEFAULT_AUDIENCE_AGENT_STATE` with new default fields
- [ ] In `src/types.ts`: rename `mergeScreenAgentState` → `mergeAudienceAgentState`, update merge logic for new fields
- [ ] In `src/types.ts`: update `composeLegacyIndicators` — audience no longer provides currentSlide/slideTimeRemaining, use delivery fallback always
- [ ] In `src/types.ts`: update `composeDualAgentOverlayState` — use audience fields instead of screen fields
- [ ] In `src/types.ts`: update `dualAgentToPillState` — use `audienceCaptureStatus`
- [ ] In `src/types.ts`: update `dualAgentToSubtitleState` — pass audience instead of screen
- [ ] In `electron/ipc.ts`: rename ScreenCueLaneState → AudienceCueLaneState, update SubtitleState `screen` → `audience` field, update `hiddenPill.screenCaptureStatus` → `audienceCaptureStatus`, update `hiddenSubtitle.screen` → `audience` with AudienceCueLaneState fields
- [ ] Run `npm run lint` — expect errors in files not yet updated (hooks, components)

### Task 2: Update session utilities

**Files:**
- Modify: `src/lib/session.ts`

- [ ] Rename `buildScreenAgentContext()` → `buildAudienceAgentContext()` — rewrite context to focus on audience watching (engagement, reactions, hand raises) instead of slide tracking
- [ ] Rename `formatScreenStateForDelivery()` → `formatAudienceStateForDelivery()` — format as `[AudienceAgent] engagement=... | reactions=... | hands=... | prompt=... | priority=...`
- [ ] Rename `shouldForwardScreenStateToDelivery()` → `shouldForwardAudienceStateToDelivery()` — compare engagement, reactions, handsRaised, audiencePrompt, priority changes instead of slide/timing changes
- [ ] Update `buildDeliveryContext()` — change `[ScreenAgent]` references to `[AudienceAgent]`, update description to mention audience observations instead of screen observations
- [ ] Simplify `currentSlideForFeedback()` — AudienceAgent no longer tracks slides, so this function should always return `delivery.fallbackCurrentSlide`. Update parameter type from `ScreenAgentState` to `AudienceAgentState`
- [ ] Run `npm run lint` — expect fewer errors now

### Task 3: Convert useScreenLiveAPI → useAudienceLiveAPI

**Files:**
- Rename: `src/hooks/useScreenLiveAPI.ts` → `src/hooks/useAudienceLiveAPI.ts`

- [ ] `git mv src/hooks/useScreenLiveAPI.ts src/hooks/useAudienceLiveAPI.ts`
- [ ] Rename internal constants: `SCREEN_FRAME_INTERVAL_MS` → `AUDIENCE_FRAME_INTERVAL_MS`, `SCREEN_LIVE_MODEL` → `AUDIENCE_LIVE_MODEL`, `screen-pcm-processor` → `audience-pcm-processor`
- [ ] Rename `getScreenBaseInstruction()` → `getAudienceBaseInstruction()` — rewrite system prompt: "You are AudienceAgent, a specialist that watches the video call gallery view showing audience participants. Watch for: engagement (attentive vs distracted), reactions (confused, nodding, bored), hands raised (Zoom/Meet hand-raise or physical). Report via updateAudienceState only."
- [ ] Replace `updateScreenState` tool declaration → `updateAudienceState` with new parameter schema: engagement (enum high/moderate/low), reactions (string), handsRaised (integer), audiencePrompt (string), audienceDetails (string), priority (enum info/watch/critical)
- [ ] Update `onmessage` handler — parse `updateAudienceState` tool call args with new field names
- [ ] Update `onUpdate` calls throughout (disconnect, connect, onopen, track-ended) — use new field names (audiencePrompt, audienceDetails, etc.)
- [ ] Rename export: `useScreenLiveAPI` → `useAudienceLiveAPI`
- [ ] Run `npm run lint`

### Task 4: Update useDesktopDualLiveSession — lazy audience connect

**Files:**
- Modify: `src/hooks/useDesktopDualLiveSession.ts`

- [ ] Update imports: useScreenLiveAPI → useAudienceLiveAPI, all Screen types → Audience types
- [ ] Change state: `screenState` → `audienceState`, use DEFAULT_AUDIENCE_AGENT_STATE
- [ ] Update forwarding useEffect — use `shouldForwardAudienceStateToDelivery`, `formatAudienceStateForDelivery`, rename ref to `previousAudienceStateRef`
- [ ] **Make audience lazy**: remove automatic `connectScreen()` from `connect()` — the `connect()` function should only start DeliveryAgent
- [ ] Add separate `connectAudience()` function — requests `getDisplayMedia`, gets mirrored mic, calls the audience hook's `connect()` method (currently destructured as `connectScreen` — rename alias to `connectAudienceSession`). Returns boolean
- [ ] Add `disconnectAudience()` function — stops audience agent only, keeps delivery running
- [ ] Update `disconnect()` — also disconnect audience if active
- [ ] Update return object: expose `connectAudience`, `disconnectAudience`, `isAudienceConnected`, `audienceState` instead of screen equivalents
- [ ] Run `npm run lint`

### Task 5: Update useDeliveryLiveAPI — AudienceAgent references

**Files:**
- Modify: `src/hooks/useDeliveryLiveAPI.ts`

- [ ] Find all `[ScreenAgent]` string references in system prompt construction → replace with `[AudienceAgent]`
- [ ] Update descriptive text: "screen observations" → "audience observations"
- [ ] Run `npm run lint`

### Task 6: Update DualAgentOverlay for audience data

**Files:**
- Modify: `src/components/DualAgentOverlay.tsx`

- [ ] Update imports: ScreenAgentState → AudienceAgentState
- [ ] Rename `screenToneClasses()` → `audienceToneClasses()` — adapt color logic: critical when handsRaised > 0, watch when engagement is low
- [ ] Rename `captureLabel()` → `audienceLabel()` — return "Audience" when active, "Audience lost" when lost, etc.
- [ ] Update props: `screen` → `audience` (AudienceAgentState)
- [ ] Update audience section rendering — show engagement level, reactions, handsRaised count, audiencePrompt/audienceDetails instead of slide info
- [ ] Run `npm run lint`

### Task 7: Update DesktopPresentationMode — add Audience toggle button

**Files:**
- Modify: `src/components/DesktopPresentationMode.tsx`

- [ ] Add `Users` import from lucide-react
- [ ] Destructure `connectAudience`, `disconnectAudience`, `isAudienceConnected`, `audienceState` from hook
- [ ] Add Audience toggle button in control bar (between clock and Start/End): `Users` icon, w-10 h-10 rounded-xl, zinc when off, indigo-500/20 when on. Only visible when `isConnected`
- [ ] Button onClick: if audience not connected → `connectAudience()`, else → `disconnectAudience()`
- [ ] Update sidebar "Screen lane" section → "Audience lane": show engagement, reactions, handsRaised, audiencePrompt
- [ ] Update `screenStatusLabel()` → `audienceStatusLabel()` with audience-appropriate labels
- [ ] Update DualAgentOverlay prop: `screen=` → `audience=`
- [ ] Update pill/subtitle state calls with audience instead of screen
- [ ] Remove old screen-specific dialog text references
- [ ] Run `npm run lint`

### Task 8: Simplify DesktopRehearsalMode — remove audience UI

**Files:**
- Modify: `src/components/DesktopRehearsalMode.tsx`

Note: Keep `useDesktopDualLiveSession` hook — Task 4's lazy-connect means rehearsal simply never calls `connectAudience()`, so AudienceAgent never starts. No hook swap needed.

- [ ] Remove audience lane section from sidebar (was "Screen lane")
- [ ] Remove `screenStatusLabel` function (no longer needed)
- [ ] Remove audience-related state displays (audience prompt, details, source label)
- [ ] Remove DualAgentOverlay or pass null/default audience state so audience section never renders
- [ ] Update user-facing text: remove "DeliveryAgent and ScreenAgent side-by-side" references, replace with single-agent messaging
- [ ] Run `npm run lint`

### Task 9: Update Electron overlay files

**Files:**
- Modify: `electron/statusPill.html`
- Modify: `electron/subtitles.html`
- Modify: `electron/main.ts`

- [ ] In `statusPill.html`: rename `screen-badge` → `audience-badge`, update status text mapping (active → "Audience live", lost → "Audience lost", etc.), update `screenCaptureStatus` references → `audienceCaptureStatus`
- [ ] In `subtitles.html`: rename screen-lane → audience-lane, "Screen agent" → "Audience agent", remove slide number display, add engagement/reactions display
- [ ] In `electron/main.ts`: update dialog title "Choose screen for ScreenAgent" → "Choose window for AudienceAgent" and related text
- [ ] Run `npm run lint`

### Task 10: Update tests

**Files:**
- Modify: `tests/dual-agent-state.test.ts`

- [ ] Rename all Screen imports → Audience equivalents (DEFAULT_SCREEN_AGENT_STATE → DEFAULT_AUDIENCE_AGENT_STATE, mergeScreenAgentState → mergeAudienceAgentState, etc.)
- [ ] Update fixture data to use new fields (engagement, reactions, handsRaised, audiencePrompt instead of currentSlide, slideTimeRemaining, screenPrompt)
- [ ] Update string assertions: `[AudienceAgent]` instead of `[ScreenAgent]`, `updateAudienceState` instead of `updateScreenState`
- [ ] Update import paths: `useScreenLiveAPI` → `useAudienceLiveAPI` if referenced
- [ ] Run tests: `npx tsx --test tests/dual-agent-state.test.ts`

### Task 11: Verify and clean up

- [ ] Run `npm run lint` — zero errors
- [ ] Run `npm run build` — clean build
- [ ] Grep entire codebase for remaining "ScreenAgent", "screenAgent", "screen_agent" references — fix any missed
- [ ] Grep for old type names (ScreenAgentState, ScreenCaptureStatus, etc.) — fix any missed
- [ ] Test `npm run dev` — app loads without errors
- [ ] Manual verification: start presentation mode, verify audience button appears, verify rehearsal mode works without second agent

## Technical Details

### New AudienceAgentState
```typescript
interface AudienceAgentState {
  captureStatus: AudienceCaptureStatus; // 'inactive'|'requesting'|'active'|'lost'|'denied'|'unsupported'
  engagement: 'high' | 'moderate' | 'low' | null;
  reactions: string; // "confused", "nodding", "bored", "attentive", ""
  handsRaised: number | null;
  audiencePrompt: string; // short actionable cue
  audienceDetails: string; // longer context
  priority: AudiencePriority; // 'info'|'watch'|'critical'
  sourceLabel: string;
}
```

### New updateAudienceState tool schema
```typescript
{
  name: 'updateAudienceState',
  description: 'Update audience engagement observations from the video call gallery view.',
  parameters: {
    type: OBJECT,
    properties: {
      captureStatus: { type: STRING, enum: ['inactive','requesting','active','lost','denied','unsupported'] },
      engagement: { type: STRING, enum: ['high','moderate','low'] },
      reactions: { type: STRING, description: 'Observed audience reactions: confused, nodding, bored, attentive, laughing' },
      handsRaised: { type: INTEGER, description: 'Number of participants with raised hands' },
      audiencePrompt: { type: STRING, description: 'Short actionable cue for the speaker' },
      audienceDetails: { type: STRING, description: 'Longer context about audience state' },
      priority: { type: STRING, enum: ['info','watch','critical'] },
    }
  }
}
```

### Forwarding format to DeliveryAgent
```
[AudienceAgent] capture=active | engagement=low | reactions="confused" | hands=1 | prompt="Pause for question" | priority=critical
```

### Lazy connect flow
```
PresentationMode start → DeliveryAgent only
User clicks Audience button → getDisplayMedia (gallery window) + getUserMedia (mic mirror) → AudienceAgent session
User clicks Audience button again → disconnectAudience() → DeliveryAgent continues alone
```

## Post-Completion

**Manual verification:**
- Start presentation mode, verify Audience button visible in control bar
- Click Audience button, select Zoom/Meet gallery window
- Verify audience metrics appear in sidebar and overlay
- Verify DeliveryAgent receives [AudienceAgent] context notes
- Toggle Audience off, verify DeliveryAgent continues working
- Verify Rehearsal mode works with single agent only
- Test Electron overlay (pill + subtitles) shows audience data correctly
