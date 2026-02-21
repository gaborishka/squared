# AGENT.md

## Purpose
This file is guidance for coding agents working in this repository.

## Project Summary
- App name: `DebateCoach`
- Type: Vite + React + TypeScript single-page app
- Primary feature: Real-time speech coaching using Google Gemini Live API
- Modes:
  - `rehearsal`: AI can speak and provide live feedback
  - `presentation`: AI must stay silent and provide visual feedback only

## Tech Stack
- React 19
- TypeScript 5
- Vite 6
- Tailwind CSS 4
- Motion (`motion/react`) and Lucide icons
- Google GenAI SDK (`@google/genai`)

## Runbook
1. Install dependencies:
   - `npm install`
2. Configure env:
   - copy `.env.example` to `.env.local` (or use `.env`)
   - set `GEMINI_API_KEY`
3. Start dev server:
   - `npm run dev`
4. Validate before finishing changes:
   - `npm run lint`
   - `npm run build`

## NPM Scripts
- `npm run dev`: runs Vite on `0.0.0.0:3000`
- `npm run lint`: TypeScript check (`tsc --noEmit`)
- `npm run build`: production build
- `npm run preview`: preview built app
- `npm run clean`: remove `dist/`

## Environment Variables
- Required:
  - `GEMINI_API_KEY`
- Optional:
  - `APP_URL`
  - `DISABLE_HMR` (`true` disables HMR in `vite.config.ts`)

## Architecture Map
- App shell: `src/App.tsx`
- Entry point: `src/main.tsx`
- Mode selection UI: `src/components/Home.tsx`
- Rehearsal UI: `src/components/RehearsalMode.tsx`
- Presentation UI: `src/components/PresentationMode.tsx`
- Metrics display: `src/components/Indicators.tsx`
- Live API integration: `src/hooks/useLiveAPI.ts`

## Critical Implementation Details
- Path alias: `@/*` maps to project root (`tsconfig.json`, `vite.config.ts`).
- API key wiring: Vite injects `process.env.GEMINI_API_KEY` at build/dev time.
- `useLiveAPI` handles:
  - `getUserMedia` for camera/mic
  - audio capture via `AudioWorklet` (16k PCM)
  - frame capture every 2s (0.5 fps) as JPEG
  - Live API session/tool calls (`updateIndicators`)
  - audio playback queue for rehearsal mode (24k output)
- Mode behavior must stay strict:
  - rehearsal: spoken coaching + indicators
  - presentation: no spoken output, indicators only
- Cleanup safety: keep disconnect logic that closes session, audio contexts, media tracks, and intervals.

## Editing Guidelines
- Preserve permission assumptions: app expects camera and microphone (`metadata.json`).
- If you change `useLiveAPI`, verify:
  - connection can start/stop repeatedly without leaked streams/audio contexts
  - interruption handling still stops queued playback
  - tool response acknowledgements are still sent after `updateIndicators`
- Prefer explicit types over `any` when touching indicators/state.
- Keep UI changes consistent with current dark/glass visual language unless a redesign is requested.

## Testing and Verification
There is no automated test framework in this repo right now.

Minimum verification for feature/code changes:
1. `npm run lint`
2. `npm run build`
3. Manual smoke test in browser:
   - both modes render
   - start/stop session works
   - camera/microphone permissions flow works
   - indicators update while connected

## Known Observations
- Build currently warns that the main JS chunk is larger than 500 kB.
- `express`, `dotenv`, and `better-sqlite3` are present in dependencies but not used by the current frontend code paths.
