import assert from 'node:assert/strict';
import test from 'node:test';
import { getLiveModelForKind, isLiveSessionKind } from '../server/services/liveAuth.ts';

test('isLiveSessionKind accepts only supported session kinds', () => {
  assert.equal(isLiveSessionKind('coach'), true);
  assert.equal(isLiveSessionKind('delivery'), true);
  assert.equal(isLiveSessionKind('audience'), true);
  assert.equal(isLiveSessionKind('other'), false);
});

test('getLiveModelForKind resolves the expected model', () => {
  assert.equal(getLiveModelForKind('coach'), 'gemini-2.5-flash-native-audio-latest');
  assert.equal(getLiveModelForKind('delivery'), 'gemini-2.5-flash-native-audio-latest');
  assert.equal(getLiveModelForKind('audience'), 'gemini-2.5-flash-native-audio-latest');
});
