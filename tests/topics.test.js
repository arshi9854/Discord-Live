import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTopics } from '../public/topics.js';
const m = content => ({ content, createdAt: '2026-09-12T00:00:00.000Z' });
test('topic clusters count messages rather than repetitions and expose supporting examples', () => {
  assert.deepEqual(detectTopics([m('deployment deployment deployment')]), []);
  const topics = detectTopics([m('railway deployment ready'), m('railway deployment failed'), m('birthday cake'), m('birthday cake party')]);
  assert.equal(topics.length, 2);
  assert.ok(topics.some(topic => topic.label.includes('deployment') && topic.count === 2));
  assert.equal(topics[0].examples.length, 2);
});
test('topics ignore filler/URLs, handle empty data and recompute after deletion', () => {
  assert.deepEqual(detectTopics([]), []);
  assert.deepEqual(detectTopics([m('hello there https://example.com'), m('hello there https://example.com')]), []);
  assert.equal(detectTopics([m('deployment'), m('deployment')]).length, 1);
  assert.equal(detectTopics([m('deployment')]).length, 0);
});
