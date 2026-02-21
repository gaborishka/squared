# Rehearsal Right Panel Redesign

**Date:** 2026-02-21
**Scope:** RehearsalMode right panel only (PresentationMode unchanged)

## Problem

The current right panel in Rehearsal mode has three issues:
1. **Too empty** — only shows filler words count + one feedback message
2. **Missing metrics** — pace, eye contact, posture visible only on camera overlay, no confidence/volume/overall score
3. **No feedback history** — feedback message disappears when replaced by a new one

## Design Principle: Overlay vs Panel Split

**Camera Overlay (left, on video)** = Instant Status
- Metrics that need instant peripheral vision: eye contact, posture, pace
- Color-coded pills (green/amber/red) — readable at a glance
- No changes to CameraOverlay component

**Right Panel** = Session Insights
- Deeper analytics not on the overlay: overall score, confidence, volume
- Filler words breakdown by word (visual bubble map)
- Full feedback history timeline with timestamps
- Viewed during pauses or post-session

## Expanded Data Schema

Add 3 new fields to `updateIndicators` tool in `useLiveAPI.ts`:

| Field | Type | New? | Description |
|---|---|---|---|
| `pace` | STRING | — | "Good", "Too Fast", "Too Slow" |
| `eyeContact` | STRING | — | "Looking at camera", "Looking away" |
| `posture` | STRING | — | "Good", "Slouching" |
| `fillerWords` | OBJECT | **changed** | `{ total: number, breakdown: { [word]: count } }` |
| `feedbackMessage` | STRING | — | Short coaching feedback |
| `confidenceScore` | INTEGER | **new** | 1-100 confidence scale |
| `volumeLevel` | STRING | **new** | "Too Quiet", "Good", "Too Loud" |
| `overallScore` | INTEGER | **new** | 1-100 overall performance |

Note: `fillerWordsCount` replaced by `fillerWords` object with `total` and `breakdown`.

## Panel Layout (w-[360px])

```
+-------------------------------+
|  Session Insights             |
|                               |
|  +--- Overall Score ---------+|
|  |        78 / 100           ||
|  |   circular progress ring  ||
|  |   "Good performance"      ||
|  +---------------------------+|
|                               |
|  +----------+ +-----------+  |
|  | Volume   | | Confidence|  |
|  | Good     | |    85     |  |
|  +----------+ +-----------+  |
|                               |
|  --- Filler Words ---------- |
|  +--+ +--+ +----+ +---+     |
|  |um| |uh| |like| |so |     |
|  +--+ +--+ +----+ +---+     |
|  color = frequency           |
|  count shown on hover        |
|                               |
|  --- Coach Feedback -------- |
|  +---------------------------+|
|  | 2:34  Great eye contact!  ||
|  | 1:12  Try slowing down    ||
|  | 0:15  Session started     ||
|  +---------------------------+|
|  scrollable, newest on top   |
+-------------------------------+
```

### Section 1: Overall Score
- SVG circular progress ring
- Color: green >= 70, amber 40-69, red < 40
- Large number centered, text label below
- Updates in real-time

### Section 2: Metric Cards (2-column grid)
- Volume: **live audio waveform/equalizer** instead of static text
  - Small animated bars (5-7 vertical bars) showing real-time audio amplitude
  - Color shifts: green (good range), amber (too quiet), red (too loud)
  - Data source: tap into existing AudioContext worklet to extract amplitude
  - When no audio: bars at minimum height, subtle idle pulse
  - Gives the panel a "live/listening" feel
- Confidence: icon + numeric score + color indicator dot
- Card style: bg-zinc-950, border-zinc-800, rounded-xl
- Color dots: green (good), amber (warning), red (bad)

### Section 3: Filler Words Bubbles
- Each unique filler word = one bubble/chip
- Bubble color by frequency:
  - 1-2 occurrences: zinc-700 border, zinc-400 text (neutral)
  - 3-4 occurrences: amber-500/20 bg, amber-400 text (attention)
  - 5+ occurrences: red-500/20 bg, red-400 text (problem)
- Count shown on hover (tooltip or overlay)
- Bubble size scales slightly with frequency
- New words appear with fade-in animation
- flex-wrap layout

### Section 4: Coach Feedback Timeline
- Scrollable container (flex-1, overflow-y-auto)
- Each entry: relative timestamp + category icon + message
- Timestamp = time since session start (mm:ss)
- **Category icons** on each feedback card for fast scanning:
  - 👁 Eye icon — eye contact / visual feedback
  - 🎤 Mic icon — volume, pace, audio-related feedback
  - 🧍 User icon — posture / body language feedback
  - 💬 MessageSquare icon — general / filler words feedback
  - Icon selection based on keyword matching in feedbackMessage
- New entries appear at top with slide-in animation (motion library)
- Left border color:
  - Green: positive/encouraging feedback
  - Amber: corrective feedback
  - Red: critical issues
- Store feedback history in React state array

## Premium Idle / Waiting State

When session is connected but no data has arrived yet:
- Replace static placeholder text with animated "listening" state
- Concentric pulsing circles animation (motion library, 3 rings expanding outward)
- Text: "Analyzing your speech and presence..."
- Subtle glow effect on the rings
- Transitions smoothly to real data when first indicators arrive

## State Changes

In `RehearsalMode.tsx`:
- Change `indicators` state from single object to accumulated state
- Add `feedbackHistory` array: `{ timestamp: number, message: string }[]`
- Track `sessionStartTime` for relative timestamps
- On each `onIndicatorsUpdate`: update metrics + push new feedback to history

## Components to Modify

1. **`useLiveAPI.ts`** — expand tool schema with new fields, change fillerWords structure
2. **`Indicators.tsx`** — complete rewrite to new dashboard layout (rename to `SessionInsights.tsx`)
3. **`RehearsalMode.tsx`** — manage feedback history state, pass to new component

## Components to Create

1. **`OverallScoreRing.tsx`** — SVG circular progress component
2. **`FillerWordsBubbles.tsx`** — bubble/chip grid with hover counts
3. **`FeedbackTimeline.tsx`** — scrollable timeline with category icons
4. **`AudioWaveform.tsx`** — live audio amplitude visualizer (5-7 animated bars)
5. **`AnalyzingPulse.tsx`** — premium idle state with concentric pulsing circles
