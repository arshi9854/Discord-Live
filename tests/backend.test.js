import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { Client, Events, User } from 'discord.js';
import { MessageStore, normalizeMessage } from '../server/store.js';
import { createApp } from '../server/app.js';
import { startDiscord } from '../server/discord.js';

const status = { mode: 'demo', connected: true, channelName: 'test', guildName: 'test', error: null };
const message = (id, content = 'hello') => ({
  id: String(id), content, author: { name: 'Test', avatarUrl: null },
  createdAt: new Date(Number(id) * 1000).toISOString(), editedAt: null, attachments: [], url: null,
});

test('store bounds history chronologically, updates in place, and deletes', () => {
  const store = new MessageStore(status, 2);
  store.upsert(message(3));
  store.upsert(message(1));
  store.upsert(message(2));
  assert.deepEqual(store.snapshot().messages.map(m => m.id), ['2', '3']);
  store.upsert(message(2, 'edited'));
  assert.equal(store.snapshot().messages[0].content, 'edited');
  store.delete('2');
  assert.deepEqual(store.snapshot().messages.map(m => m.id), ['3']);
});

test('normalization exposes only the intended message and author fields', () => {
  const normalized = normalizeMessage({
    id: '1', content: '<script>unsafe</script>', createdTimestamp: 1000,
    editedTimestamp: 2000, member: { displayName: 'Server nickname' },
    author: { username: 'name', email: 'private@example.com', displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' },
    attachments: new Map([['a', { id: 'a', name: 'photo.png', url: 'https://cdn.discordapp.com/photo.png', contentType: 'image/png' }]]),
    url: 'https://discord.com/channels/1/2/3',
  });
  assert.equal(normalized.author.name, 'Server nickname');
  assert.equal(normalized.author.email, undefined);
  assert.equal(normalized.content, '<script>unsafe</script>');
  assert.equal(normalized.editedAt, '1970-01-01T00:00:02.000Z');
  assert.equal(normalized.attachments[0].name, 'photo.png');
});

test('messages from members with custom or default avatars normalize through the real Discord SDK', () => {
  const client = new Client({ intents: [] });
  for (const avatar of [null, '1234567890abcdef1234567890abcdef']) {
    const author = new User(client, {
      id: '123456789012345678', username: 'Member', discriminator: '0', avatar,
    });
    const normalized = normalizeMessage({
      id: '123456789012345679', author, content: 'Hello from another member',
      createdTimestamp: 1000,
    });
    assert.equal(normalized.content, 'Hello from another member');
    assert.equal(normalized.author.name, 'Member');
    assert.match(normalized.author.avatarUrl, /^https:\/\/cdn\.discordapp\.com\//);
  }
});

test('HTTP streams snapshot, live edits, deletes and statuses; reconnects reconcile', async t => {
  const store = new MessageStore(status);
  store.upsert(message(1));
  const { app, closeStreams } = createApp(store);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const abort = new AbortController();
  t.after(() => { abort.abort(); closeStreams(); server.closeAllConnections(); server.close(); });
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true });
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), status);
  const response = await fetch(`${base}/api/events`, { signal: abort.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async () => {
    while (!buffer.includes('\n\n')) {
      const part = await reader.read();
      assert.equal(part.done, false);
      buffer += decoder.decode(part.value, { stream: true });
    }
    const split = buffer.indexOf('\n\n');
    const frame = buffer.slice(0, split);
    buffer = buffer.slice(split + 2);
    const [event, data] = frame.split('\n');
    return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
  };
  assert.deepEqual(await next(), { event: 'snapshot', data: store.snapshot() });
  store.upsert(message(2, 'new'));
  assert.deepEqual(await next(), { event: 'message', data: message(2, 'new') });
  store.upsert(message(2, 'edited'));
  assert.equal((await next()).data.content, 'edited');
  store.delete('1');
  assert.deepEqual(await next(), { event: 'delete', data: { id: '1' } });
  store.setStatus({ connected: false, error: 'Disconnected' });
  assert.equal((await next()).data.connected, false);
  assert.equal((await fetch(`${base}/readyz`)).status, 503);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/api/status`)).headers.get('cache-control'), 'no-store');
  await reader.cancel();
  const reconnect = await fetch(`${base}/api/events`, { signal: abort.signal });
  const secondReader = reconnect.body.getReader();
  const fresh = decoder.decode((await secondReader.read()).value);
  assert.match(fresh, /event: snapshot/);
  assert.match(fresh, /edited/);
  assert.doesNotMatch(fresh, /"id":"1"/);
  await secondReader.cancel();
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const discordMessage = (id, content = 'hello', channelId = 'watched') => ({
  id, channelId, content, createdTimestamp: Number(id) * 1000, editedTimestamp: null,
  author: { username: 'Test', displayAvatarURL: () => null }, attachments: new Map(),
});
class FakeClient extends EventEmitter {
  constructor(fetchHistory) {
    super();
    this.destroyed = false;
    this.channels = { fetch: async () => ({
      name: 'general', guild: { name: 'Test server' }, isTextBased: () => true,
      messages: { fetch: fetchHistory },
    }) };
  }
  async login() { this.emit(Events.ClientReady); }
  destroy() { this.destroyed = true; }
}

test('Discord history reconciles concurrent create/update/delete and ignores other channels', async () => {
  const history = deferred();
  const client = new FakeClient(() => history.promise);
  const store = new MessageStore({ ...status, connected: false, mode: 'discord' });
  const stop = await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  client.emit(Events.MessageDelete, discordMessage('1'));
  client.emit(Events.MessageUpdate, {}, discordMessage('2', 'edited during history fetch'));
  client.emit(Events.MessageCreate, discordMessage('3'));
  client.emit(Events.MessageCreate, discordMessage('4', 'private', 'other'));
  history.resolve(new Map([['1', discordMessage('1')], ['2', discordMessage('2')]]));
  await tick();
  assert.equal(store.status.connected, true);
  assert.deepEqual(store.snapshot().messages.map(m => m.id), ['2', '3']);
  assert.equal(store.messages.get('2').content, 'edited during history fetch');
  client.emit(Events.MessageBulkDelete, new Map([['2', discordMessage('2')], ['3', discordMessage('3')]]));
  assert.equal(store.messages.size, 0);
  stop();
  assert.equal(client.destroyed, true);
});

test('late partial fetches cannot resurrect deletions or overwrite newer updates', async () => {
  const client = new FakeClient(async () => new Map());
  const store = new MessageStore(status);
  await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  await tick();
  const oldFetch = deferred();
  client.emit(Events.MessageUpdate, {}, { ...discordMessage('1'), partial: true, fetch: () => oldFetch.promise });
  client.emit(Events.MessageDelete, discordMessage('1'));
  oldFetch.resolve(discordMessage('1', 'deleted text'));
  const staleFetch = deferred();
  client.emit(Events.MessageUpdate, {}, { ...discordMessage('2'), partial: true, fetch: () => staleFetch.promise });
  client.emit(Events.MessageUpdate, {}, discordMessage('2', 'newest text'));
  staleFetch.resolve(discordMessage('2', 'outdated text'));
  await tick();
  assert.equal(store.messages.has('1'), false);
  assert.equal(store.messages.get('2').content, 'newest text');
});

test('gateway resume retries failed channel initialization before reporting connected', async () => {
  let attempts = 0;
  const recovered = deferred();
  const client = new FakeClient(async () => {
    if (++attempts === 1) throw new Error('Missing Access (simulated)');
    return recovered.promise;
  });
  const store = new MessageStore({ ...status, connected: false });
  await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  await tick();
  assert.equal(store.status.connected, false);
  client.emit(Events.ShardResume);
  await tick();
  assert.equal(store.status.connected, false);
  assert.equal(attempts, 2);
  recovered.resolve(new Map());
  await tick();
  assert.equal(store.status.connected, true);
});

test('startup buffer is bounded and overflow fails visibly', async () => {
  const history = deferred();
  const client = new FakeClient(() => history.promise);
  const store = new MessageStore({ ...status, connected: false });
  await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  for (let id = 1; id <= 1001; id++) client.emit(Events.MessageCreate, discordMessage(String(id)));
  assert.equal(client.destroyed, true);
  assert.match(store.status.error, /Too many messages/);
  history.resolve(new Map());
  await tick();
  assert.equal(store.status.connected, false);
  assert.equal(store.messages.size, 0);
});

test('an avatar failure does not lose message text', () => {
  const input = discordMessage('1', 'Keep this note');
  input.author.displayAvatarURL = () => { throw new Error('Bad avatar'); };
  assert.equal(normalizeMessage(input).content, 'Keep this note');
  assert.equal(normalizeMessage(input).author.avatarUrl, null);
});

test('an older REST result cannot overwrite a newer edit', () => {
  const store = new MessageStore(status);
  store.upsert({ ...message(1, 'Newest edit'), editedAt: '2026-09-12T12:00:00.000Z' });
  store.upsert({ ...message(1, 'Stale fetch'), editedAt: '2026-09-12T11:59:00.000Z' });
  assert.equal(store.messages.get('1').content, 'Newest edit');
});

test('a partial fetch from a disconnected session cannot overwrite refreshed history', async t => {
  let history = new Map([['1', discordMessage('1', 'Original')]]);
  const client = new FakeClient(async () => history);
  const store = new MessageStore(status);
  const stop = await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  t.after(stop);
  await tick();
  const pendingRead = deferred();
  client.emit(Events.MessageUpdate, {}, { ...discordMessage('1'), partial: true, fetch: () => pendingRead.promise });
  client.emit(Events.ShardDisconnect);
  history = new Map([['1', discordMessage('1', 'Current source text')]]);
  client.emit(Events.ShardResume);
  await tick();
  pendingRead.resolve(discordMessage('1', 'Old session text'));
  await tick();
  assert.equal(store.messages.get('1').content, 'Current source text');
  assert.equal(store.status.connected, true);
});

test('failed history is atomic and retries without a new gateway event', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const client = new FakeClient(async () => {
    if (++attempts === 1) return new Map([
      ['2', discordMessage('2')],
      ['3', { ...discordMessage('3'), createdTimestamp: NaN }],
    ]);
    return new Map([['2', discordMessage('2')]]);
  });
  const store = new MessageStore(status);
  store.upsert(message(1, 'Previously published note'));
  const events = [];
  store.on('event', type => events.push(type));
  const stop = await startDiscord(store, { token: 'fake', channelId: 'watched', client, retryBaseMs: 100 });
  t.after(stop);
  await tick();
  assert.deepEqual([...store.messages.keys()], ['1']);
  assert.equal(store.status.connected, false);
  assert.equal(events.includes('message'), false);
  client.emit(Events.MessageCreate, discordMessage('4', 'Queued during recovery'));
  t.mock.timers.tick(100);
  await tick();
  assert.equal(attempts, 2);
  assert.deepEqual([...store.messages.keys()], ['2', '4']);
  assert.equal(store.status.connected, true);
  assert.equal(events.filter(type => type === 'snapshot').length, 1);
  assert.equal(events.includes('message'), false);
});

test('history completing after disconnect cannot claim readiness or replace the window', async t => {
  const history = deferred();
  const client = new FakeClient(() => history.promise);
  const store = new MessageStore(status);
  store.upsert(message(1));
  const stop = await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  t.after(stop);
  client.emit(Events.ShardDisconnect);
  history.resolve(new Map([['2', discordMessage('2')]]));
  await tick();
  assert.equal(store.status.connected, false);
  assert.deepEqual([...store.messages.keys()], ['1']);
  client.emit(Events.ShardResume);
  await tick();
  assert.equal(store.status.connected, true);
  assert.deepEqual([...store.messages.keys()], ['2']);
});

test('stopping during history loading prevents late writes', async () => {
  const history = deferred();
  const client = new FakeClient(() => history.promise);
  const store = new MessageStore({ ...status, connected: false });
  store.upsert(message(1));
  const stop = await startDiscord(store, { token: 'fake', channelId: 'watched', client });
  stop();
  history.resolve(new Map([['2', discordMessage('2')]]));
  await tick();
  client.emit(Events.MessageCreate, discordMessage('3'));
  assert.equal(store.status.connected, false);
  assert.deepEqual([...store.messages.keys()], ['1']);
});

test('recovery retries back off to a cap and stop cleanly', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const client = new FakeClient(async () => { attempts++; throw new Error('Unavailable'); });
  const stop = await startDiscord(new MessageStore(status), { token: 'fake', channelId: 'watched', client, retryBaseMs: 100, retryMaxMs: 400 });
  t.after(stop);
  await tick();
  for (const [delay, expected] of [[100, 2], [200, 3], [400, 4], [400, 5]]) {
    t.mock.timers.tick(delay - 1);
    await tick();
    assert.equal(attempts, expected - 1);
    t.mock.timers.tick(1);
    await tick();
    assert.equal(attempts, expected);
  }
  stop();
  t.mock.timers.tick(200_000);
  await tick();
  assert.equal(attempts, 5);
});

test('stuck recovery triggers a single fatal restart request and ignores late history', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const history = deferred();
  const client = new FakeClient(() => history.promise);
  const store = new MessageStore({ ...status, connected: false });
  let fatalCalls = 0;
  await startDiscord(store, { token: 'fake', channelId: 'watched', client, recoveryTimeoutMs: 100, onFatal: () => { fatalCalls++; } });
  t.mock.timers.tick(100);
  assert.equal(fatalCalls, 1);
  assert.equal(client.destroyed, true);
  assert.match(store.status.error, /timed out/);
  history.resolve(new Map([['2', discordMessage('2')]]));
  await tick();
  t.mock.timers.tick(1000);
  assert.equal(fatalCalls, 1);
  assert.equal(store.status.connected, false);
  assert.equal(store.messages.size, 0);
});

test('SSE capacity is enforced, idle streams heartbeat, and closed clients release listeners', { timeout: 3000 }, async t => {
  const store = new MessageStore(status);
  const { app, closeStreams } = createApp(store, { maxClients: 1, heartbeatMs: 5 });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { closeStreams(); server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/events`;
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  const reader = response.body.getReader();
  assert.equal((await fetch(url)).status, 503);
  assert.equal(store.listenerCount('event'), 1);
  let received = '';
  while (!received.includes(': heartbeat')) received += new TextDecoder().decode((await reader.read()).value);
  const removed = once(store, 'removeListener');
  await reader.cancel();
  await removed;
  assert.equal(store.listenerCount('event'), 0);
  const replacement = await fetch(url, { signal: AbortSignal.timeout(2500) });
  assert.equal(replacement.status, 200);
  await replacement.body.cancel();
});
