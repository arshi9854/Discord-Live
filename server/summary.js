import { normalizeMessage } from './store.js';

export class SummaryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function parseSummaryRequest(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SummaryError('Invalid summary request.');
  const { days = 7, member = '', prompt = '', focus = 'highlights' } = body;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new SummaryError('Choose between 1 and 30 days.');
  if (typeof member !== 'string' || member.length > 100 || typeof prompt !== 'string' || prompt.length > 300) throw new SummaryError('Keep member names under 100 characters and requests under 300.');
  if (!['highlights', 'questions'].includes(focus)) throw new SummaryError('Choose highlights or questions.');
  let result = { days, member: member.trim(), focus };
  if (prompt.trim()) {
    // A small explicit command grammar, not a language model pretending to understand anything.
    const match = prompt.trim().match(/^(?:summari[sz]e|recap|highlights|questions)(?:\s+(?:chat|the chat))?(?:\s+(?:from|by|for)\s+(.+?))?(?:\s+(?:for\s+)?(?:the\s+)?(?:last|past)\s+(\d+)\s+(days?|weeks?))?[.!?]?$/i);
    if (!match) throw new SummaryError('Try “summarize last 2 weeks”, “recap from Arshiya last 7 days”, or “questions”. You can also leave the request empty and use the filters.');
    result.focus = /^questions/i.test(prompt.trim()) ? 'questions' : 'highlights';
    if (match[1]) result.member = match[1].trim();
    if (match[2]) result.days = Number(match[2]) * (/week/i.test(match[3]) ? 7 : 1);
    if (result.days < 1 || result.days > 30) throw new SummaryError('Choose between 1 and 30 days.');
  }
  return result;
}

// Fetch independently of the 200-message live store; never mutate the live window.
export async function readChannelHistory(channel, { start, end, signal, maxPages = 30 }) {
  let before = ((BigInt(Date.parse(end)) - 1420070400000n) << 22n).toString();
  const messages = new Map();
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted();
    const batch = [...(await channel.messages.fetch({ limit: 100, before, cache: false })).values()];
    signal?.throwIfAborted();
    if (!batch.length) { complete = true; break; }
    let oldest = batch[0];
    for (const source of batch) {
      if (BigInt(source.id) < BigInt(oldest.id)) oldest = source;
      const message = normalizeMessage(source);
      if (message.createdAt >= start && message.createdAt < end) messages.set(message.id, message);
    }
    if (batch.length < 100 || oldest.createdTimestamp < Date.parse(start)) { complete = true; break; }
    if (BigInt(oldest.id) >= BigInt(before)) throw new SummaryError('History pagination did not advance. Please retry.', 502);
    before = oldest.id;
  }
  return { messages: [...messages.values()], complete, source: 'discord' };
}

const stopWords = new Set('about after again also because before being could doing from have hello here into just like more some that their them then there these they this those very were what when where which will with would your you the and for are but not was all can has had our out how its'.split(' '));
const words = text => text.toLowerCase().replace(/https?:\/\/\S+/g, '').match(/[\p{L}]{3,}/gu)?.filter(word => !stopWords.has(word)) ?? [];

export function summarize(history, request, { start, end }) {
  const messages = history.messages.filter(m => m.createdAt >= start && m.createdAt < end);
  const people = new Map();
  for (const m of messages) {
    const id = m.author.id ?? m.author.name;
    const person = people.get(id) ?? { id, name: m.author.name, count: 0 };
    person.count++; people.set(id, person);
  }
  const members = [...people.values()].sort((a, b) => b.count - a.count);
  const target = request.member.replace(/^@/, '').toLocaleLowerCase();
  const matches = target ? members.filter(p => p.id === request.member || p.name.toLocaleLowerCase() === target) : [];
  if (matches.length > 1) throw new SummaryError('More than one member has that name. Choose their unique member ID from the suggestions.');
  const selected = target ? messages.filter(m => (m.author.id ?? m.author.name) === matches[0]?.id) : messages;
  const textMessages = selected.filter(m => m.content.trim());
  const frequencies = new Map();
  for (const m of textMessages) for (const word of new Set(words(m.content))) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  const terms = [...frequencies].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word]) => word);
  const candidates = request.focus === 'questions' ? textMessages.filter(m => /[?？]/.test(m.content)) : textMessages;
  const seen = new Set();
  const excerpts = candidates.map(m => ({ m, score: words(m.content).reduce((sum, word) => sum + (frequencies.get(word) ?? 0), 0) / Math.sqrt(Math.max(1, words(m.content).length)) }))
    .sort((a, b) => b.score - a.score || b.m.createdAt.localeCompare(a.m.createdAt))
    .filter(({ m }) => { const key = m.content.trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 6).sort((a, b) => a.m.createdAt.localeCompare(b.m.createdAt))
    .map(({ m }) => ({ id: m.id, author: m.author.name, text: m.content.slice(0, 500) + (m.content.length > 500 ? '…' : ''), url: m.url, createdAt: m.createdAt }));
  const participantCount = new Set(selected.map(m => m.author.id ?? m.author.name)).size;
  return {
    ...request, start, end, generatedAt: new Date().toISOString(), mode: 'extractive', source: history.source,
    complete: history.complete, scanned: messages.length, count: selected.length, textCount: textMessages.length, members, terms, excerpts,
    overview: selected.length ? `${selected.length} messages from ${participantCount} member${participantCount === 1 ? '' : 's'} in the retrieved window. ${textMessages.length} contain text. ${excerpts.length} ${request.focus === 'questions' ? 'question-containing' : 'representative'} excerpts selected.` : `No messages found${request.member ? ' for this member' : ''} in the retrieved window.`,
    coverage: history.source === 'demo' ? 'Demo only: this recap uses the retained synthetic feed, not a week of Discord history.' : history.complete ? 'Reached the requested start or the end of accessible channel history.' : 'Partial coverage: stopped after 3,000 scanned messages. This is not a complete recap of the requested period.',
    note: 'Local extractive recap, not an AI-written interpretation. Repeated words and excerpts may miss context; question marks do not prove a question is unanswered. Attachments, threads, and deleted messages are not summarized. This is a point-in-time result; rerun after edits or deletions.',
  };
}

export function createSummaryService({ readHistory, generate, now = Date.now, cooldownMs = 10_000, timeoutMs = 40_000 }) {
  let active = false;
  let lastStarted = -Infinity;
  return async body => {
    const request = parseSummaryRequest(body);
    if (active || now() - lastStarted < cooldownMs) throw new SummaryError('A recap is running or was just requested. Wait a few seconds and try again.', 429);
    active = true; lastStarted = now();
    const range = { start: new Date(now() - request.days * 86_400_000).toISOString(), end: new Date(now()).toISOString() };
    const controller = new AbortController();
    let timer;
    const work = Promise.resolve().then(() => readHistory({ ...range, signal: controller.signal }))
      .then(history => { controller.signal.throwIfAborted(); return summarize(history, request, range); })
      .then(recap => generate ? generate(recap, controller.signal, body.allowExternal === true) : recap)
      .finally(() => { active = false; clearTimeout(timer); });
    // Keep the concurrency slot occupied until an outstanding SDK request settles,
    // even if the HTTP deadline has already expired. No background request pileup.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new SummaryError('History retrieval timed out. Try a shorter range shortly.', 504)); }, timeoutMs);
      timer.unref();
    });
    return Promise.race([work, timeout]);
  };
}
