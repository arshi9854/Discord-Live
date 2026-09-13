import { renderBrief } from './insights.js';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
};
let busy = false;
const initial = $('recap-log').firstElementChild.cloneNode(true);
$('recap-send').disabled = true;
let providerReady = false;
fetch('/api/summary/config').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(config => {
  const ai = config.provider === 'openrouter' && config.configured;
  $('recap-provider').textContent = ai ? `Optional AI via OpenRouter · ${config.model}` : config.provider === 'openrouter' ? 'OpenRouter needs configuration · local fallback available' : 'Local recaps · OpenRouter integration ready to configure';
  $('insight-provider').textContent = ai ? 'OPENROUTER / READY' : 'LOCAL / AI NOT CONFIGURED';
  $('insight-intro').textContent = ai ? 'An optional AI synthesis of selected excerpts, with source references.' : 'Local recaps work now. Add an OpenRouter key and model on the server to enable AI.';
  $('ai-consent').hidden = !ai;
  providerReady = true; $('recap-send').disabled = false;
}).catch(() => { $('recap-provider').textContent = 'Cannot verify provider settings. Refresh before requesting a recap.'; });

export function updateRecapMembers(members) {
  const unique = new Map(members.map(m => [m.id || m.name, m]));
  $('recap-members').replaceChildren(...[...unique.values()].map(member => {
    const option = node('option', member.name);
    option.value = member.id || member.name; option.label = member.name;
    return option;
  }));
}
function appendBubble(bubble) {
  const log = $('recap-log'); log.append(bubble);
  while (log.children.length > 12) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}
function bubble(label, text, className = '') {
  const el = node('article', '', 'recap-bubble ' + className);
  el.append(node('span', label, 'eyebrow'), node('p', text));
  return el;
}
function renderResult(result) {
  const el = bubble('RECAP / ' + (result.source === 'demo' ? 'DEMO DATA' : 'SOURCE-LINKED'), result.overview);
  if (result.aiWarning) el.append(node('p', result.aiWarning, 'recap-coverage partial'));
  if (result.aiPoints) {
    el.append(node('p', 'AI SYNTHESIS / ' + result.model, 'eyebrow'));
    for (const point of result.aiPoints) {
      el.append(node('p', point.text));
      const references = node('div', '', 'recap-meta');
      for (const id of point.sources) {
        const source = result.excerpts.find(e => e.id === id);
        if (!source) continue;
        try {
          const url = new URL(source.url);
          if (url.protocol !== 'https:' || url.hostname !== 'discord.com') continue;
          const a = node('a', `Source: ${source.author} ↗ `); a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; references.append(a);
        } catch { /* No external link for synthetic examples. */ }
      }
      el.append(references);
    }
    el.append(node('small', result.aiNote));
  }
  el.append(node('p', `${new Date(result.start).toLocaleString()} → ${new Date(result.end).toLocaleString()} · ${result.member || 'Everyone'}`, 'recap-meta'));
  el.append(node('p', result.coverage, result.complete ? 'recap-coverage' : 'recap-coverage partial'));
  if (result.terms.length) el.append(node('p', 'Repeated terms: ' + result.terms.join(' / '), 'recap-meta'));
  if (!result.excerpts.length) el.append(node('p', result.count ? 'No matching text excerpts. Try highlights instead of questions, or another range.' : 'Try a different range or exact member name / ID.'));
  for (const excerpt of result.excerpts) {
    const quote = node('blockquote', '');
    quote.append(node('p', excerpt.text));
    const citation = node('div', `${excerpt.author} · ${new Date(excerpt.createdAt).toLocaleString()} `, 'recap-meta');
    try {
      const url = new URL(excerpt.url);
      if (url.protocol === 'https:' && url.hostname === 'discord.com') {
        const link = node('a', 'View source ↗');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; citation.append(link);
      }
    } catch { /* Demo excerpts have no source URL. */ }
    quote.append(citation); el.append(quote);
  }
  el.append(node('small', result.note));
  appendBubble(el); updateRecapMembers(result.members); renderBrief(result);
}
$('sidebar-recap').addEventListener('submit', event => {
  event.preventDefault();
  if ($('insight-request').value.trim()) $('recap-prompt').value = $('insight-request').value.trim();
  $('recap-dialog').showModal(); $('recap-prompt').focus();
});
$('recap-close').addEventListener('click', () => $('recap-dialog').close());
$('recap-clear').addEventListener('click', () => {
  if (!busy) { $('recap-log').replaceChildren(initial.cloneNode(true)); $('insight-brief').replaceChildren(); $('recap-progress').textContent = 'Conversation cleared from this page.'; }
});
document.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => {
  $('recap-days').value = button.dataset.days; $('recap-prompt').value = '';
}));
$('recap-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !providerReady || !$('recap-days').reportValidity()) return;
  const request = { days: Number($('recap-days').value), member: $('recap-member').value.trim(), prompt: $('recap-prompt').value.trim(), allowExternal: !$('ai-consent').hidden && $('allow-external').checked };
  busy = true; $('recap-send').disabled = true; $('recap-clear').disabled = true;
  appendBubble(bubble('YOU', request.prompt || `Summarize ${request.member || 'everyone'} · past ${request.days} days`, 'recap-user'));
  $('recap-progress').textContent = 'Reading channel history… this can take up to 40 seconds.';
  $('recap-log').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create the recap. Please retry.');
    renderResult(result);
    $('recap-days').value = result.days; $('recap-member').value = result.member;
    $('recap-prompt').value = '';
    $('recap-progress').textContent = 'Recap ready. Change the filters or ask for “questions”.';
  } catch (error) {
    const message = ['TimeoutError', 'AbortError'].includes(error.name) ? 'The request timed out. Try again shortly with a shorter range.' : error.message;
    appendBubble(bubble('COULD NOT SUMMARIZE', message, 'recap-error'));
    $('recap-progress').textContent = 'No recap generated. Your filters and request are preserved for retry.';
  } finally {
    busy = false; $('recap-send').disabled = false; $('recap-clear').disabled = false;
    $('recap-log').setAttribute('aria-busy', 'false');
  }
});
