import { detectTopics } from './topics.js';
const $ = id => document.getElementById(id);
const el = (tag, text, className) => {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
};
export function renderPulse(messages, status) {
  const people = new Map();
  for (const message of messages) {
    const key = message.author.id || message.author.name;
    const person = people.get(key) || { name: message.author.name, count: 0 };
    person.count++; people.set(key, person);
  }
  $('pulse-count').textContent = messages.length;
  $('pulse-members').textContent = people.size;
  $('pulse-questions').textContent = messages.filter(m => /[?？]/.test(m.content)).length;
  $('insights-scope').textContent = `${status?.mode === 'demo' ? 'Demo data · ' : ''}Current retained window only · not weekly totals`;
  const rows = [...people.values()].sort((a, b) => b.count - a.count).slice(0, 5).map(person => {
    const row = el('div', '', 'pulse-person'); row.append(el('span', person.name), el('span', person.count)); return row;
  });
  $('pulse-people').replaceChildren(...(rows.length ? rows : [el('p', 'Waiting for messages.', 'insights-scope')]));
  const topics = detectTopics(messages);
  const expanded = new Set([...$('pulse-topics').querySelectorAll('details[open]')].map(detail => detail.dataset.topic));
  $('pulse-topics').replaceChildren(...topics.map(topic => {
    const detail = el('details', '', 'topic-cluster'); detail.dataset.topic = topic.label; detail.open = expanded.has(topic.label);
    const summary = el('summary', ''); summary.append(el('span', topic.label), el('small', `${topic.count} messages`)); detail.append(summary);
    for (const message of topic.examples) {
      const quote = el('blockquote', message.content.slice(0, 180) + (message.content.length > 180 ? '…' : ''));
      quote.append(el('small', message.author.name));
      try {
        const url = new URL(message.url);
        if (url.protocol === 'https:' && url.hostname === 'discord.com') {
          const a = el('a', 'View message ↗'); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; quote.append(a);
        }
      } catch { /* Synthetic messages have no source URL. */ }
      detail.append(quote);
    }
    return detail;
  }));
  if (!topics.length) $('pulse-topics').append(el('p', 'No recurring topics yet. As words repeat across messages, clusters will appear here.', 'insights-scope'));
}
export function renderBrief(result) {
  const container = $('insight-brief');
  const parts = [el('p', `${result.mode === 'llm' ? 'AI brief' : 'Local recap'} · ${result.days} days · ${result.member || 'Everyone'}`, 'brief-label'), el('p', result.overview)];
  if (result.aiPoints) {
    for (const point of result.aiPoints) parts.push(el('p', point.text));
    parts.push(el('small', result.aiNote));
  } else if (result.terms.length) parts.push(el('p', 'Repeated terms: ' + result.terms.join(' / ')));
  parts.push(el('p', result.coverage, 'insights-scope'));
  if (result.aiWarning) parts.push(el('p', result.aiWarning, 'insights-scope'));
  parts.push(el('small', 'Point-in-time recap. Open chat for sources; rerun after edits or deletions.'));
  container.replaceChildren(...parts);
}
