# Squared v0.1

An AI app for real-time public speaking coaching powered by Gemini Live API.

## What's Included in v0.1

- Two operating modes: `Rehearsal Mode` and `Presentation Mode`.
- Real-time analysis of speaking and delivery using camera and microphone input.
- Live visual indicators of presentation quality.
- Session insights panel with scores, filler-word tracking, and feedback history.

## Feature Overview

### 1. Rehearsal Mode

- The AI coach can provide short voice feedback during practice.
- Live analysis includes:
  - speaking pace (`pace`)
  - eye contact (`eye contact`)
  - posture (`posture`)
  - filler words (`filler words`)
  - volume (`volume level`)
  - confidence (`confidence score`)
  - overall performance (`overall score`)
- Feedback timeline with timestamps for the active session.

### 2. Presentation Mode

- No voice interruptions from AI (silent coach).
- Guidance and metrics are shown through a HUD overlay and side panel.
- Suitable for live presentations and video calls where discreet visual coaching is needed.

### 3. Session Insights

- Overall score ring.
- `Volume` and `Confidence` metric cards.
- Filler-word visualization with per-word breakdown.
- Coach feedback history for the active session.

## How to Run Locally

### Prerequisites

- `Node.js` 18+ (LTS recommended)
- `npm`
- Access to a Gemini API key
- A browser with camera and microphone permissions

### Setup Steps

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local env file:
   ```bash
   cp .env.example .env
   ```
3. Set `GEMINI_API_KEY` in `.env`.
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open the app in your browser: `http://localhost:3000`

### Useful Commands

- `npm run dev` - run local dev server.
- `npm run build` - create production build.
- `npm run preview` - preview production build locally.
- `npm run lint` - run TypeScript checks (`tsc --noEmit`).

## Permissions

- Both modes require:
  - `camera`
  - `microphone`

## Image Placeholders (format: `[description]`)

[Home screen]
[Rehearsal Mode - session start]
[Rehearsal Mode - active session with feedback]
[Presentation Mode - HUD overlay]
[Session Insights - metrics panel]
