import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DELIVERY_AGENT_STATE,
  DEFAULT_AUDIENCE_AGENT_STATE,
  composeDualAgentOverlayState,
  composeLegacyIndicators,
  dualAgentToPillState,
  dualAgentToSubtitleState,
  mergeDeliveryAgentState,
  mergeAudienceAgentState,
} from '../src/types.ts';
import {
  buildAudienceAgentContext,
  formatAudienceStateForDelivery,
  shouldForwardAudienceStateToDelivery,
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

test('delivery fallback always owns slide and timing (audience has no slide data)', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    fallbackCurrentSlide: 2,
    fallbackSlideTimeRemaining: 18,
    microPrompt: 'Slow down',
  });
  const audience = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'high',
    audiencePrompt: 'Audience engaged',
  });

  const composed = composeLegacyIndicators(delivery, audience);

  assert.equal(composed.currentSlide, 2);
  assert.equal(composed.slideTimeRemaining, 18);
  assert.equal(composed.microPrompt, 'Slow down');
});

test('delivery fallback owns slide and timing when audience agent is inactive', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    fallbackCurrentSlide: 3,
    fallbackSlideTimeRemaining: 27,
  });
  const audience = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'inactive',
  });

  const composed = composeLegacyIndicators(delivery, audience);

  assert.equal(composed.currentSlide, 3);
  assert.equal(composed.slideTimeRemaining, 27);
});

test('dual overlay keeps delivery and audience lanes separate', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    agentMode: 'directive',
    microPrompt: 'Slow down',
    rescueText: 'Breathe and land the point.',
  });
  const audience = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'low',
    handsRaised: 2,
    priority: 'critical',
    audiencePrompt: 'Audience disengaged',
    audienceDetails: 'Multiple participants looking away.',
  });

  const overlay = composeDualAgentOverlayState(delivery, audience);
  const subtitles = dualAgentToSubtitleState(delivery, audience);

  assert.equal(overlay.delivery.prompt, 'Slow down');
  assert.equal(overlay.audience.prompt, 'Audience disengaged');
  assert.equal(subtitles.delivery.mode, 'directive');
  assert.equal(subtitles.audience.priority, 'critical');
  assert.equal(subtitles.audience.engagement, 'low');
});

test('pill composition retains capture health and shared metrics', () => {
  const delivery = mergeDeliveryAgentState(DEFAULT_DELIVERY_AGENT_STATE, {
    pace: 'Good',
    eyeContact: 'Looking at camera',
    posture: 'Upright',
    overallScore: 82,
    confidenceScore: 77,
  });
  const audience = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'lost',
  });

  const pill = dualAgentToPillState(delivery, audience, '2:14', true);

  assert.equal(pill.audienceCaptureStatus, 'lost');
  assert.equal(pill.overallScore, 82);
  assert.equal(pill.elapsed, '2:14');
});

test('dual pill stays hidden before the desktop session starts', () => {
  const pill = dualAgentToPillState(DEFAULT_DELIVERY_AGENT_STATE, DEFAULT_AUDIENCE_AGENT_STATE, '0:00', false);

  assert.equal(pill.visible, false);
  assert.equal(pill.audienceCaptureStatus, 'inactive');
});

test('audience state forwarding only triggers on meaningful changes', () => {
  const previous = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'high',
    audiencePrompt: 'All good',
  });
  const same = mergeAudienceAgentState(previous, {});
  const changed = mergeAudienceAgentState(previous, {
    engagement: 'low',
    audiencePrompt: 'Losing them',
  });

  assert.equal(shouldForwardAudienceStateToDelivery(previous, same), false);
  assert.equal(shouldForwardAudienceStateToDelivery(previous, changed), true);
});

test('audience engagement change triggers forwarding', () => {
  const previous = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'high',
    reactions: '',
    handsRaised: 0,
  });
  const engagementChanged = mergeAudienceAgentState(previous, {
    engagement: 'moderate',
  });

  assert.equal(shouldForwardAudienceStateToDelivery(previous, engagementChanged), true);
});

test('audience hands raised change triggers forwarding', () => {
  const previous = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'high',
    handsRaised: 0,
  });
  const handsChanged = mergeAudienceAgentState(previous, {
    handsRaised: 3,
  });

  assert.equal(shouldForwardAudienceStateToDelivery(previous, handsChanged), true);
});

test('audience state can be serialized into a delivery note', () => {
  const audience = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'low',
    reactions: 'confused, bored',
    handsRaised: 2,
    audiencePrompt: 'Re-engage audience',
    audienceDetails: 'Multiple participants looking away from screen.',
    priority: 'critical',
  });

  const note = formatAudienceStateForDelivery(audience);

  assert.ok(note?.includes('[AudienceAgent]'));
  assert.ok(note?.includes('engagement=low'));
  assert.ok(note?.includes('reactions="confused, bored"'));
  assert.ok(note?.includes('hands=2'));
  assert.ok(note?.includes('prompt="Re-engage audience"'));
});

test('audience agent context sets up tool-only behavior', () => {
  const context = buildAudienceAgentContext({
    mode: 'presentation',
    project: projectFixture,
  });

  assert.ok(context.includes('updateAudienceState'));
  assert.ok(context.includes('gallery'));
});

test('merge audience state preserves existing fields when update is partial', () => {
  const base = mergeAudienceAgentState(DEFAULT_AUDIENCE_AGENT_STATE, {
    captureStatus: 'active',
    engagement: 'high',
    reactions: 'nodding',
    handsRaised: 1,
    audiencePrompt: 'Engaged',
    audienceDetails: 'Positive reactions',
    priority: 'info',
  });

  const updated = mergeAudienceAgentState(base, {
    engagement: 'moderate',
  });

  assert.equal(updated.engagement, 'moderate');
  assert.equal(updated.reactions, 'nodding');
  assert.equal(updated.handsRaised, 1);
  assert.equal(updated.audiencePrompt, 'Engaged');
  assert.equal(updated.captureStatus, 'active');
});
