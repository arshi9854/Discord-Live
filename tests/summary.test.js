import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { parseSummaryRequest, readChannelHistory, summarize, createSummaryService } from '../server/summary.js';
import { createApp } from '../server/app.js';
import { MessageStore } from '../server/store.js';

const end = '2026-09-12T12:00:00.000Z';
const start = '2026-09-05T12:00:00.000Z';
const msg = (id, name, content, createdAt = '2026-09-10T12:00:00.000Z') => ({ id, author: { id, name }, content, createdAt, url: `https://discord.com/channels/1/2/${id}` });

test('summary command grammar handles ranges, members and questions; rejects unsupported requests', () => {
  assert.deepEqual(parseSummaryRequest({ prompt: 'summarize last 2 weeks' }), { days: 14, member: '', focus: 'highlights' });
  assert.deepEqual(parseSummaryRequest({ prompt: 'recap from Arshiya last 7 days' }), { days: 7, member: 'Arshiya', focus: 'highlights' });
  assert.equal(parseSummaryRequest({ prompt: 'questions', days: 14, member: '123' }).focus, 'questions');
  for (const body of [{ days: 0 }, { days: 31 }, { days: '7' }, { prompt: 'summarize last 5 weeks' }, { prompt: 'tell me a joke' }, { member: [] }, null]) assert.throws(() => parseSummaryRequest(body));
});

test('recap filters by timestamp and stable member ID, with exact source excerpts', () => {
  const history = { complete: true, source: 'discord', messages: [msg('1', 'Arshiya', 'The deployment is ready. Any questions?'), msg('2', 'Sam', 'Review the deployment.'), msg('3', 'Old', 'excluded', '2026-09-01T00:00:00.000Z'), msg('4', 'Future', 'excluded', end)] };
  const result = summarize(history, { days: 7, member: '1', focus: 'questions' }, { start, end });
  assert.equal(result.count, 1); assert.equal(result.scanned, 2);
  assert.equal(result.excerpts[0].text, history.messages[0].content);
  assert.equal(result.excerpts[0].url, history.messages[0].url);
  assert.equal(result.mode, 'extractive');
  assert.equal(summarize(history, { member: 'Nobody', focus: 'highlights' }, { start, end }).count, 0);
});

test('duplicate names require IDs and partial/demo coverage is never called complete', () => {
  const history = { complete: false, source: 'discord', messages: [msg('1', 'Sam', 'first'), msg('2', 'Sam', 'second')] };
  assert.throws(() => summarize(history, { member: 'Sam' }, { start, end }), /unique member ID/);
  assert.match(summarize(history, { member: '1' }, { start, end }).coverage, /Partial coverage/);
  assert.match(summarize({ ...history, source: 'demo' }, { member: '' }, { start, end }).coverage, /Demo only/);
});

function raw(id, timestamp) { return { id: String(id), createdTimestamp: timestamp, author: { id: '10', username: 'Member' }, content: 'History message' }; }
test('history reads pages beyond live-window size and respects cutoff, cap and abort', async () => {
  let calls = 0;
  const channel = { messages: { fetch: async options => {
    assert.equal(options.cache, false);
    calls++;
    return new Map(Array.from({ length: calls < 4 ? 100 : 1 }, (_, i) => {
      const m = raw(10000 - calls * 100 - i, calls < 4 ? Date.parse(end) - calls * 1000 : Date.parse(start) - 1000); return [m.id, m];
    }));
  } } };
  const result = await readChannelHistory(channel, { start, end });
  assert.equal(result.messages.length, 300); assert.equal(result.complete, true); assert.equal(calls, 4);
  calls = 0;
  assert.equal((await readChannelHistory(channel, { start, end, maxPages: 1 })).complete, false);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readChannelHistory(channel, { start, end, signal: abort.signal }), { name: 'AbortError' });
});

test('summary failures do not return partial output and concurrency/cooldown are bounded', async () => {
  let resolve;
  const service = createSummaryService({ now: () => Date.parse(end), readHistory: () => new Promise(r => { resolve = r; }) });
  const first = service({ days: 7 });
  await Promise.resolve();
  await assert.rejects(service({ days: 7 }), e => e.status === 429);
  resolve({ messages: [], complete: true, source: 'discord' });
  assert.equal((await first).count, 0);
  await assert.rejects(service({ days: 7 }), e => e.status === 429);
  const failed = createSummaryService({ readHistory: async () => { throw new Error('source failed'); } });
  await assert.rejects(failed({ days: 7 }), /source failed/);
});

test('summary timeout responds promptly but holds its slot until the SDK settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve;
  const service = createSummaryService({ cooldownMs: 0, timeoutMs: 100, readHistory: () => new Promise(r => { resolve = r; }) });
  const pending = service({ days: 7 });
  const rejection = assert.rejects(pending, e => e.status === 504);
  await Promise.resolve();
  t.mock.timers.tick(100);
  await rejection;
  await assert.rejects(service({ days: 7 }), e => e.status === 429);
  resolve({ messages: [], complete: true, source: 'discord' });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const next = service({ days: 7 });
  await Promise.resolve();
  resolve({ messages: [], complete: true, source: 'discord' });
  assert.equal((await next).count, 0);
});

test('HTTP summary validates bodies, blocks cross-site reads and hides provider failures', async t => {
  const store = new MessageStore({ connected: true });
  const summarize = createSummaryService({ cooldownMs: 0, readHistory: async () => { throw new Error('private upstream details'); } });
  const { app } = createApp(store, { summarize });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/summary`;
  const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(JSON.stringify({ prompt: 'x'.repeat(3000) }))).status, 413);
  assert.equal((await post('{}', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('{"days":31}')).status, 400);
  const failed = await post('{}'); assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private upstream/);
});
