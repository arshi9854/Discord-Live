import { EventEmitter } from 'node:events';

export class MessageStore extends EventEmitter {
  constructor(status, limit = 200) {
    super();
    this.limit = limit;
    this.messages = new Map();
    this.status = status;
  }

  snapshot() {
    return { messages: [...this.messages.values()], status: this.status };
  }

  // Build off to the side: observers get either the old window or the whole new one.
  replace(messages, statusPatch = {}) {
    const next = new MessageStore({ ...this.status, ...statusPatch }, this.limit);
    for (const message of messages) next.upsert(message);
    this.messages = next.messages;
    this.status = next.status;
    this.emit('event', 'snapshot', this.snapshot());
  }

  upsert(message) {
    const existing = this.messages.get(message.id);
    if (existing && (existing.editedAt ?? existing.createdAt) > (message.editedAt ?? message.createdAt)) return;
    this.messages.set(message.id, message);
    this.messages = new Map([...this.messages.entries()].sort((a, b) =>
      a[1].createdAt.localeCompare(b[1].createdAt) || a[0].localeCompare(b[0])));
    while (this.messages.size > this.limit) {
      this.messages.delete(this.messages.keys().next().value);
    }
    if (this.messages.has(message.id)) this.emit('event', 'message', message);
  }

  delete(id) {
    this.messages.delete(id);
    this.emit('event', 'delete', { id });
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('event', 'status', this.status);
  }
}

export function normalizeMessage(message) {
  // A cosmetic avatar failure must not discard the message itself.
  let avatarUrl = null;
  try { avatarUrl = message.author?.displayAvatarURL({ size: 128 }) ?? null; } catch { /* Use the text fallback. */ }
  return {
    id: message.id,
    author: {
      id: message.author?.id ?? null,
      name: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? 'Unknown user',
      avatarUrl,
    },
    content: message.content ?? '',
    createdAt: new Date(message.createdTimestamp).toISOString(),
    editedAt: message.editedTimestamp ? new Date(message.editedTimestamp).toISOString() : null,
    attachments: [...(message.attachments?.values() ?? [])].map(attachment => ({
      id: attachment.id, name: attachment.name, url: attachment.url,
      contentType: attachment.contentType ?? null,
    })),
    url: message.url ?? null,
  };
}
