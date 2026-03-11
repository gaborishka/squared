# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Squared — an AI-powered real-time speech coaching app built for Google AI Studio. Uses Google Gemini 2.5 Flash Live API for two modes: **Rehearsal** (interactive voice feedback with AI interruptions) and **Presentation** (silent visual-only HUD feedback during live presentations). Requires camera and microphone permissions.

## Commands

- `npm run dev` — Start dev server (port 3000, host 0.0.0.0)
- `npm run build` — Production build
- `npm run preview` — Preview production build
- `npm run lint` — TypeScript type checking (`tsc --noEmit`)
- `npm run clean` — Remove dist directory

No test framework is configured. No ESLint or Prettier.

## Deployment (GCP Cloud Run)

**Prerequisites:** gcloud CLI, Terraform >= 1.5, Docker

**Quick deploy:**
```bash
./scripts/deploy.sh --project=YOUR_GCP_PROJECT
```

The script reads `GEMINI_API_KEY` from `.env` or `.env.local`, builds a Docker image, pushes to Artifact Registry, and deploys via Terraform to Cloud Run.

**Infrastructure:** Terraform IaC in `infra/` — manages Artifact Registry, Cloud Run service, and IAM. SQLite is ephemeral on Cloud Run (data resets on container restart).

**Current deployment:** https://squared-j2gx3ygtta-uc.a.run.app (project: `agile-stratum-486012-v3`, region: `us-central1`)

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
