# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DebateCoach — an AI-powered real-time speech coaching app built for Google AI Studio. Uses Google Gemini 2.5 Flash Live API for two modes: **Rehearsal** (interactive voice feedback with AI interruptions) and **Presentation** (silent visual-only HUD feedback during live presentations). Requires camera and microphone permissions.

## Commands

- `npm run dev` — Start dev server (port 3000, host 0.0.0.0)
- `npm run build` — Production build
- `npm run preview` — Preview production build
- `npm run lint` — TypeScript type checking (`tsc --noEmit`)
- `npm run clean` — Remove dist directory

No test framework is configured. No ESLint or Prettier.

## Environment Variables

Copy `.env.example` to `.env.local`. Required: `GEMINI_API_KEY`. Optional: `APP_URL`, `DISABLE_HMR` (used in AI Studio deployments).

## Architecture

**Stack:** React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion (animations), Lucide React (icons).

**Key path alias:** `@/*` maps to project root (configured in tsconfig.json and vite.config.ts).

### Core flow

`App.tsx` → `Home.tsx` (mode selection) → `RehearsalMode.tsx` or `PresentationMode.tsx` → `Indicators.tsx` (real-time metrics display)

### useLiveAPI hook (`src/hooks/useLiveAPI.ts`)

Central integration point with Google Gemini Live API. Handles:
- User media capture (audio via AudioWorklet + video frame capture at 0.5fps)
- PCM audio processing with a custom worklet processor
- Real-time streaming to/from Gemini
- Tool calling (`updateIndicators`) for real-time coaching feedback
- Mode-specific system instructions and behavior (voice feedback in rehearsal, silent in presentation)

### UI patterns

- Dark theme (zinc-950/zinc-900), glass-morphism effects (backdrop-blur)
- State managed with React useState hooks (no external state library)
- Functional components throughout
