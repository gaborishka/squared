import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DELIVERY_AGENT_STATE,
  DEFAULT_SCREEN_AGENT_STATE,
  composeDualAgentOverlayState,
  composeLegacyIndicators,
  dualAgentToPillState,
  dualAgentToSubtitleState,
  mergeDeliveryAgentState,
  mergeScreenAgentState,
} from '../src/types.ts';
import {
  buildScreenAgentContext,
  formatScreenStateForDelivery,
  shouldForwardScreenStateToDelivery,
} from '../src/lib/session.ts';

const projectFixture = {
  id: 'project-1',
  name: 'Quarterly Demo',
  description: 'Pitch deck for the launch review.',
  content: '',
  filePath: null,
  fileType: 'pptx' as const,
  slideCount: 2,
  createdAt: '2026-03-10T10:00:00.000Z',
  updatedAt: '2026-03-10T10:00:00.000Z',
  runCount: 0,
  rehearsalRunCount: 0,
  presentationRunCount: 0,
  lastOverallScore: null,
  slides: [
    {
      id: 'slide-1',
      projectId: 'project-1',
      slideNumber: 1,
      title: 'Intro',
      content: 'Opening',
      speakerNotes: 'Start strong',
    },
    {
      id: 'slide-2',
      projectId: 'project-1',
      slideNumber: 2,
      title: 'Roadmap',
      content: 'Plan',
      speakerNotes: 'Transition clearly',
    },
  ],
};

test('screen agent owns slide and timing when capture is active', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    fallbackCurrentSlide: 2,
    fallbackSlideTimeRemaining: 18,
    microPrompt: 'Slow down',
  });
  const screen = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'active',
    currentSlide: 5,
    slideTimeRemaining: 42,
    screenPrompt: 'Wrap slide',
  });

  const composed = composeLegacyIndicators(delivery, screen);

  assert.equal(composed.currentSlide, 5);
  assert.equal(composed.slideTimeRemaining, 42);
  assert.equal(composed.microPrompt, 'Slow down');
});

test('delivery fallback owns slide and timing when screen agent is inactive', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    fallbackCurrentSlide: 3,
    fallbackSlideTimeRemaining: 27,
  });
  const screen = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'inactive',
    currentSlide: 9,
    slideTimeRemaining: 99,
  });

  const composed = composeLegacyIndicators(delivery, screen);

  assert.equal(composed.currentSlide, 3);
  assert.equal(composed.slideTimeRemaining, 27);
});

test('dual overlay keeps delivery and screen lanes separate', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    agentMode: 'directive',
    microPrompt: 'Slow down',
    rescueText: 'Breathe and land the point.',
  });
  const screen = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'active',
    currentSlide: 4,
    screenPriority: 'critical',
    screenPrompt: 'Next slide',
    screenDetails: 'You are still on the intro slide.',
  });

  const overlay = composeDualAgentOverlayState(delivery, screen);
  const subtitles = dualAgentToSubtitleState(delivery, screen);

  assert.equal(overlay.delivery.prompt, 'Slow down');
  assert.equal(overlay.screen.prompt, 'Next slide');
  assert.equal(subtitles.delivery.mode, 'directive');
  assert.equal(subtitles.screen.priority, 'critical');
  assert.equal(subtitles.screen.currentSlide, 4);
});

test('pill composition retains capture health and shared metrics', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    pace: 'Good',
    eyeContact: 'Looking at camera',
    posture: 'Upright',
    overallScore: 82,
    confidenceScore: 77,
  });
  const screen = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'lost',
    currentSlide: 7,
    slideTimeRemaining: 12,
  });

  const pill = dualAgentToPillState(delivery, screen, '2:14', true);

  assert.equal(pill.currentSlide, 7);
  assert.equal(pill.screenCaptureStatus, 'lost');
  assert.equal(pill.overallScore, 82);
  assert.equal(pill.elapsed, '2:14');
});

test('dual pill stays hidden before the desktop session starts', () => {
  const pill = dualAgentToPillState(DEFAULT_DELIVERY_AGENT_STATE, DEFAULT_SCREEN_AGENT_STATE, '0:00', false);

  assert.equal(pill.visible, false);
  assert.equal(pill.screenCaptureStatus, 'inactive');
});

test('screen state forwarding only triggers on meaningful changes', () => {
  const previous = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'active',
    currentSlide: 3,
    screenPrompt: 'Hold',
  });
  const same = mergeScreenAgentState(previous, {});
  const changed = mergeScreenAgentState(previous, {
    currentSlide: 4,
    screenPrompt: 'Move on',
  });

  assert.equal(shouldForwardScreenStateToDelivery(previous, same), false);
  assert.equal(shouldForwardScreenStateToDelivery(previous, changed), true);
});

test('screen timing updates are bucketed before forwarding to delivery', () => {
  const previous = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'active',
    currentSlide: 5,
    slideTimeRemaining: 58,
  });
  const smallDelta = mergeScreenAgentState(previous, {
    slideTimeRemaining: 52,
  });
  const thresholdDelta = mergeScreenAgentState(previous, {
    slideTimeRemaining: 14,
  });

  assert.equal(shouldForwardScreenStateToDelivery(previous, smallDelta), false);
  assert.equal(shouldForwardScreenStateToDelivery(previous, thresholdDelta), true);
});

test('screen state can be serialized into a delivery note', () => {
  const screen = mergeScreenAgentState(DEFAULT_SCREEN_AGENT_STATE, {
    captureStatus: 'active',
    currentSlide: 6,
    slideTimeRemaining: 9,
    screenPrompt: 'Wrap slide',
    screenDetails: 'The shared screen still shows pricing.',
    screenPriority: 'watch',
    sourceLabel: 'Keynote',
  });

  const note = formatScreenStateForDelivery(screen);

  assert.ok(note?.includes('[ScreenAgent]'));
  assert.ok(note?.includes('slide=6'));
  assert.ok(note?.includes('prompt="Wrap slide"'));
  assert.ok(note?.includes('source="Keynote"'));
});

test('screen agent context keeps the agent tool-only', () => {
  const context = buildScreenAgentContext({
    mode: 'presentation',
    project: projectFixture,
  });

  assert.ok(context.includes('only outward action should be updateScreenState'));
  assert.ok(context.includes('do not narrate, chat, or coach directly'));
});
