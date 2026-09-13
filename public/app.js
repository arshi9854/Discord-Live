import { updateRecapMembers } from './summary-ui.js';
import { renderPulse } from './insights.js';
const $ = id => document.getElementById(id);
const state = { messages: [], status: null, connected: false, paused: false, savedOnly: false, query: '', saved: new Set(), storageKey: '', storageError: false };
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let announcementTimer;
let lastReceived = null;

function recordDelivery() {
  lastReceived = new Date();
  $('last-update').textContent = 'Last update received ' + lastReceived.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

// Message IDs are globally unique in Discord. Names and text never enter localStorage.
function loadHearts() {
  const key = 'pocket-post:v1:' + (state.status?.mode || '') + ':' + (state.status?.guildName || '') + ':' + (state.status?.channelName || '');
  if (key === state.storageKey) return;
  state.storageKey = key;
  try {
    const ids = JSON.parse(localStorage.getItem(key) || '[]');
    state.saved = new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string').slice(-200) : []);
  } catch { state.saved = new Set(); state.storageError = true; }
}
function persistHearts() {
  try { localStorage.setItem(state.storageKey, JSON.stringify([...state.saved])); }
  catch { state.storageError = true; }
}
function reconcileHearts() {
  const ids = new Set(state.messages.map(message => message.id));
  const removed = [...state.saved].some(id => !ids.has(id));
  state.saved = new Set([...state.saved].filter(id => ids.has(id)));
  if (removed) persistHearts();
}
function bounded(messages) {
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-200);
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}
function link(url, className, text) {
  const node = element('a', className, text);
  node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer';
  return node;
}
function announce(text) {
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => { $('announcement').textContent = text; }, 250);
}
function card(message) {
  const name = message.author?.name || 'A friend';
  const color = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  const node = element('article', 'postcard message paper-' + color);
  node.dataset.id = message.id;
  const heading = element('div', 'card-heading');
  const stamp = element('span', 'stamp', ['✿', '♡', '✧', '☀', '❀'][color]);
  stamp.setAttribute('aria-hidden', 'true');
  heading.append(element('span', 'postmark', 'A LITTLE NOTE FOR YOU'), stamp);
  node.append(heading, element('div', 'message-content', message.content || (message.attachments?.length ? 'A little something to share.' : 'A note without text.')));
  for (const attachment of message.attachments || []) {
    const url = safeUrl(attachment.url);
    if (url) node.append(link(url, 'attachment', '↗ ' + (attachment.name || 'Open attachment')));
  }
  const meta = element('div', 'message-meta');
  const byline = element('div');
  byline.append(element('span', 'author', 'From ' + name));
  const date = new Date(message.createdAt);
  const valid = !Number.isNaN(date.getTime());
  const time = element('time', 'card-time', (valid ? dateFormat.format(date) : '') + (message.editedAt ? ' · edited' : ''));
  if (valid) time.dateTime = date.toISOString();
  byline.append(time);
  const saved = state.saved.has(message.id);
  const heart = element('button', 'heart', saved ? 'BOOKMARKED' : 'BOOKMARK');
  heart.type = 'button'; heart.dataset.heartId = message.id;
  heart.setAttribute('aria-pressed', String(saved));
  heart.setAttribute('aria-label', (saved ? 'Remove bookmark for' : 'Bookmark') + ' message from ' + name);
  heart.title = saved ? 'Remove bookmark' : 'Bookmark this message';
  heart.disabled = state.paused;
  heart.addEventListener('click', () => {
    if (state.saved.has(message.id)) state.saved.delete(message.id); else state.saved.add(message.id);
    persistHearts(); render(); renderStatus();
    [...document.querySelectorAll('.heart')].find(button => button.dataset.heartId === message.id)?.focus({ preventScroll: true });
    announce(state.saved.has(message.id) ? 'Message bookmarked.' : 'Bookmark removed.');
  });
  meta.append(byline, heart); node.append(meta);
  const url = safeUrl(message.url);
  if (url) node.append(link(url, 'source-link', 'OPEN IN DISCORD ↗'));
  return node;
}

function render(preserveReading = false) {
  if (state.paused) return;
  renderPulse(state.messages, state.status);
  // Anchor a visible card when new arrivals are inserted above the reader.
  const anchor = preserveReading ? [...document.querySelectorAll('.postcard')].find(node => {
    const box = node.getBoundingClientRect(); return box.top >= 0 && box.top < innerHeight;
  }) : null;
  const anchorId = anchor?.dataset.id;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const query = state.query.toLocaleLowerCase();
  const shown = [...state.messages].reverse().filter(message =>
    (!state.savedOnly || state.saved.has(message.id)) &&
    [message.content, message.author?.name, ...(message.attachments || []).map(file => file.name)].join(' ').toLocaleLowerCase().includes(query)
  );
  $('messages').replaceChildren(...shown.map(card));
  $('all-count').textContent = state.messages.length;
  $('saved-count').textContent = state.messages.filter(message => state.saved.has(message.id)).length;
  $('all-tab').setAttribute('aria-pressed', String(!state.savedOnly));
  $('saved-tab').setAttribute('aria-pressed', String(state.savedOnly));
  $('keepsake-tools').hidden = !state.savedOnly;
  $('download-button').disabled = !state.saved.size;
  $('wall-title').textContent = state.savedOnly ? 'Bookmarked messages' : 'Incoming messages';
  $('message-count').textContent = shown.length + (shown.length === 1 ? ' message' : ' messages') + (query ? ' found' : state.savedOnly ? ' bookmarked' : ' retained');
  $('empty-state').hidden = shown.length > 0;
  $('empty-state').querySelector('h3').textContent = query ? 'No matching messages' : state.savedOnly ? 'No bookmarked messages.' : 'Waiting for messages.';
  $('empty-state').querySelector('p').textContent = query ? 'Try another word or a friend’s name.' : state.savedOnly ? 'Choose Bookmark on a message to find it here.' : 'Post in the connected Discord channel. Your message will appear here.';
  if (anchorId) {
    const replacement = [...document.querySelectorAll('.postcard')].find(node => node.dataset.id === anchorId);
    if (replacement) window.scrollBy(0, replacement.getBoundingClientRect().top - anchorTop);
  }
}
function renderStatus() {
  const status = state.status;
  const live = state.connected && status?.connected;
  $('connection').classList.toggle('connected', Boolean(live));
  $('connection-text').textContent = !state.connected ? 'Reconnecting' : live ? 'Live connection' : 'Source offline';
  $('browser-state').textContent = 'Browser stream: ' + (state.connected ? 'connected' : 'reconnecting');
  $('browser-state').dataset.ok = String(state.connected);
  $('discord-state').textContent = status?.mode === 'demo' ? 'Source: generated demo' : 'Discord: ' + (status?.connected ? 'connected' : 'offline / connecting');
  $('discord-state').dataset.ok = String(Boolean(status?.connected));
  $('mode-badge').hidden = status?.mode !== 'demo';
  $('channel-title').textContent = status?.channelName ? '#' + status.channelName : 'your channel';
  $('guild-name').textContent = status?.guildName ? '· ' + status.guildName : '';
  $('footer-status').textContent = state.paused ? 'View paused · receiving in background' : live ? 'Receiving live message updates.' : 'Waiting for the connection to return.';
  const notices = [];
  if (!state.connected) notices.push('Browser stream disconnected. Reconnecting and refreshing the message window automatically.');
  else if (status?.error) notices.push(status.error);
  else if (!status?.connected) notices.push('The page is ready. Waiting for Discord to connect.');
  if (state.paused) notices.push('View paused. Receiving updates in the background; choose Resume to catch up.');
  if (state.storageError) notices.push('This browser cannot retain bookmarks permanently. You can still export them during this visit.');
  $('notice').textContent = notices.join(' ');
  $('notice').hidden = notices.length === 0;
  // A channel link comes from an actual Discord message, never a guessed channel ID.
  const source = state.messages.map(message => safeUrl(message.url)).find(url => url && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+/.test(url));
  if (source && status?.mode === 'discord') {
    $('write-note').href = source.replace(/\/\d+$/, '');
    $('write-note').target = '_blank'; $('write-note').rel = 'noopener noreferrer';
    $('write-note').textContent = 'Open Discord ↗';
  } else {
    $('write-note').href = '#how-it-works';
    $('write-note').removeAttribute('target');
    $('write-note').textContent = 'How to post ↗';
  }
}

const events = new EventSource('/api/events');
events.onopen = () => { state.connected = true; renderStatus(); };
events.onerror = () => { state.connected = false; renderStatus(); };
function subscribe(name, handler) {
  events.addEventListener(name, event => {
    try { handler(JSON.parse(event.data)); }
    catch { announce('A note could not be displayed. Refresh the page to try again.'); }
  });
}
subscribe('snapshot', snapshot => {
  recordDelivery();
  state.messages = bounded(Array.isArray(snapshot.messages) ? snapshot.messages : []);
  state.status = snapshot.status; state.connected = true;
  updateRecapMembers(state.messages.map(message => message.author));
  loadHearts(); reconcileHearts(); render(true); renderStatus();
});
subscribe('message', message => {
  if (!message || typeof message.id !== 'string') return;
  recordDelivery();
  const index = state.messages.findIndex(item => item.id === message.id);
  if (index < 0) state.messages.push(message); else state.messages[index] = message;
  state.messages = bounded(state.messages); reconcileHearts(); render(true); renderStatus();
  if (index < 0) announce(state.paused ? 'A new message arrived. Resume to read it.' : 'New message received.');
});
subscribe('delete', ({ id }) => {
  recordDelivery();
  state.messages = state.messages.filter(message => message.id !== id);
  reconcileHearts(); render(true);
});
subscribe('status', status => { state.status = status; renderStatus(); });
$('search').addEventListener('input', event => { state.query = event.target.value; render(); });
for (const [id, savedOnly] of [['all-tab', false], ['saved-tab', true]]) {
  $(id).addEventListener('click', () => { state.savedOnly = savedOnly; state.query = ''; $('search').value = ''; render(); });
}
$('pause-button').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pause-button').setAttribute('aria-pressed', String(state.paused));
  $('pause-label').textContent = state.paused ? 'Resume' : 'Pause';
  for (const id of ['search', 'all-tab', 'saved-tab', 'download-button']) $(id).disabled = state.paused;
  document.querySelectorAll('.heart').forEach(button => { button.disabled = state.paused; });
  if (!state.paused) render();
  renderStatus();
});
function openHelp() {
  $('how-it-works').open = true;
  $('how-it-works').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('how-it-works').querySelector('summary').focus({ preventScroll: true });
}
$('help-button').addEventListener('click', openHelp);
$('write-note').addEventListener('click', event => {
  if ($('write-note').getAttribute('href') === '#how-it-works') { event.preventDefault(); openHelp(); }
});
$('download-button').addEventListener('click', () => {
  const saved = state.messages.filter(message => state.saved.has(message.id));
  if (!saved.length) return;
  const lines = ['POCKET POST — BOOKMARKS', 'From ' + (state.status?.guildName || 'our community'), 'Exported on ' + new Date().toLocaleDateString(), ''];
  for (const message of saved) {
    lines.push('From ' + (message.author?.name || 'A friend'), new Date(message.createdAt).toLocaleString(), message.content || '');
    for (const attachment of message.attachments || []) {
      const url = safeUrl(attachment.url); if (url) lines.push((attachment.name || 'Attachment') + ': ' + url);
    }
    if (safeUrl(message.url)) lines.push(message.url);
    lines.push('', '------------------------------', '');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const download = element('a'); download.href = url; download.download = 'pocket-post-bookmarks.txt';
  document.body.append(download); download.click(); download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('Your bookmarked messages are downloading.');
});
render();
