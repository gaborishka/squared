# Visual Metrics Redesign: Posture & Eye Contact

## Problem

Current posture and eye contact metrics have three issues:
1. **Flickering** — `advanceStableStatus` uses streak-based stabilization that deadlocks when readings alternate (e.g., Upright/Slouching/Upright/Slouching — streak never reaches threshold)
2. **Fixed thresholds** — posture thresholds (headDrop, shoulderTilt, lateralOffset) and eye contact faceRatio depend on camera angle, distance, and individual face/body proportions, causing false positives
3. **Binary output** — only "good"/"bad" with no intermediate state for gentle feedback

## Design

### 1. Stabilization: Majority Voting

Replace `advanceStableStatus` (consecutive-streak) with a **sliding window majority vote**.

- Window: last 12 readings (12 × 120ms tick = ~1.44s)
- Transition threshold: 60% majority (8/12)
- If no clear majority: hold previous state
- Applies to both eye contact and posture independently

This eliminates both flickering (single bad frame can't flip state) and deadlock (alternating readings produce a clear majority for whichever appears more often).

### 2. Calibration Phase (first 3 seconds)

During the first ~25 readings after session start:
- Collect raw metric values (headDrop, shoulderTilt, lateralOffset for posture; faceRatio for eye contact)
- Compute median as neutral baseline
- Compute MAD (median absolute deviation) as spread measure, with a minimum floor to prevent over-sensitivity from very stable calibration

After calibration, thresholds are expressed as deviations from the user's own neutral baseline.

During calibration, indicators show "Calibrating..." status and don't produce good/bad judgments.

### 3. Three-Level Posture

Levels based on deviation from calibrated neutral:

| Level | Condition | UI Color |
|-------|-----------|----------|
| **Upright** | All metrics within 1.5× MAD of neutral | Green |
| **Watch posture** | Any metric beyond 1.5× MAD but none beyond 3× MAD | Amber |
| **Slouching** | Any metric beyond 3× MAD of neutral | Red |

### 4. Three-Level Eye Contact

| Level | Condition | UI Color |
|-------|-----------|----------|
| **Looking at camera** | No gaze/pose signal deviates | Green |
| **Glancing away** | Mild yaw, mild iris offset, or borderline faceRatio deviation | Amber |
| **Looking away** | Strong yaw, large iris offset, or significant faceRatio deviation | Red |

faceRatio uses calibrated baseline + deviation thresholds (same as posture).
Iris horizontal/vertical thresholds remain fixed (already normalized to eye geometry).
Yaw gets a two-tier split: mild (>0.25) and strong (>0.45).

### 5. CameraOverlay Updates

Add color mapping for new intermediate statuses:
- "Watch posture" → amber
- "Glancing away" → amber

## Files to Modify

- `src/hooks/useLiveAPI.ts` — stabilization logic, evaluation functions, calibration state
- `src/components/CameraOverlay.tsx` — color mapping for new statuses
