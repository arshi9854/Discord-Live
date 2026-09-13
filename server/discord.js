import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { MessageStore, normalizeMessage } from './store.js';
import { readChannelHistory, SummaryError } from './summary.js';

export async function startDiscord(store, {
  token, channelId, client: injectedClient, retryBaseMs = 1000,
  retryMaxMs = 30_000, recoveryTimeoutMs = 120_000, onFatal = () => {}, onHistoryReady = () => {},
}) {
  const client = injectedClient ?? new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel],
  });
  let syncing = true;
  const pending = new Map();
  let stopped = false;
  let transportReady = false;
  let channelReady = false;
  let generation = 0;
  let syncPromise;
  let retryTimer;
  let recoveryTimer;
  let retryAttempt = 0;
  const revisions = new Map();
  let revision = 0;

  onHistoryReady(async options => {
    if (stopped || !channelReady || !transportReady) throw new SummaryError('Discord is not ready. Wait for the source to reconnect.', 503);
    const channel = await client.channels.fetch(channelId, { force: true });
    options.signal?.throwIfAborted();
    if (!channel?.guild || !channel.messages || !channel.permissionsFor(client.user)?.has(['ViewChannel', 'ReadMessageHistory'])) {
      throw new SummaryError('The bot needs View Channel and Read Message History permissions.', 503);
    }
    const history = await readChannelHistory(channel, options);
    if (stopped || !channelReady || !transportReady) throw new SummaryError('Discord disconnected during retrieval. Retry after reconnection.', 503);
    return history;
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    generation += 1;
    clearTimeout(retryTimer);
    clearTimeout(recoveryTimer);
    pending.clear();
    client.destroy();
  }
  function fatal(reason) {
    if (stopped) return;
    store.setStatus({ connected: false, error: reason });
    console.error(JSON.stringify({ event: 'discord_recovery_exhausted' }));
    stop();
    onFatal();
  }
  function armRecoveryDeadline() {
    if (recoveryTimer || stopped) return;
    recoveryTimer = setTimeout(() => fatal('Discord recovery timed out. The service must restart to reconnect.'), recoveryTimeoutMs);
    recoveryTimer.unref();
  }
  function scheduleRetry() {
    if (stopped || !transportReady || retryTimer) return;
    const delay = Math.min(retryBaseMs * 2 ** Math.min(retryAttempt++, 10), retryMaxMs);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      synchronize();
    }, delay);
    retryTimer.unref();
  }
  const mark = id => {
    revisions.delete(id);
    revisions.set(id, ++revision);
    if (revisions.size > 1000) revisions.delete(revisions.keys().next().value);
    return revision;
  };
  const apply = (type, value) => {
    if (stopped) return;
    if (syncing) {
      const id = type === 'delete' ? value : value.id;
      pending.set(id, [type, value]);
      if (pending.size > 1000) fatal('Too many messages arrived during recovery. Restart the service to resynchronize.');
    } else if (type === 'delete') store.delete(value);
    else store.upsert(value);
  };
  const upsert = async message => {
    if (stopped || message.channelId !== channelId) return;
    const currentRevision = mark(message.id);
    const eventGeneration = generation;
    try {
      const full = message.partial ? await message.fetch() : message;
      if (stopped || eventGeneration !== generation || revisions.get(message.id) !== currentRevision) return;
      apply('message', normalizeMessage(full));
    } catch (error) {
      if (stopped || eventGeneration !== generation || revisions.get(message.id) !== currentRevision) return;
      if (error.code === 10008) {
        // The source was deleted before an uncached edit could be fetched.
        apply('delete', message.id);
        return;
      }
      channelReady = false;
      store.setStatus({ connected: false, error: 'A message could not be read. Recovering recent channel history.' });
      console.error(JSON.stringify({ event: 'discord_message_failed', code: error.code ?? error.name }));
      armRecoveryDeadline();
      scheduleRetry();
    }
  };
  client.on(Events.MessageCreate, upsert);
  client.on(Events.MessageUpdate, (_old, updated) => upsert(updated));
  client.on(Events.MessageDelete, message => {
    if (!stopped && message.channelId === channelId) {
      mark(message.id);
      apply('delete', message.id);
    }
  });
  client.on(Events.MessageBulkDelete, messages => {
    for (const message of messages.values()) {
      if (!stopped && message.channelId === channelId) {
        mark(message.id);
        apply('delete', message.id);
      }
    }
  });

  const runSync = async () => {
    const currentGeneration = generation;
    syncing = true;
    channelReady = false;
    armRecoveryDeadline();
    try {
      // Force channel metadata refresh to detect changed access/configuration.
      const channel = await client.channels.fetch(channelId, { force: true });
      if (!channel?.isTextBased() || !channel.guild || !channel.messages) {
        throw new Error('Configured channel is not an accessible guild text channel.');
      }
      const history = await channel.messages.fetch({ limit: 100, cache: false });
      if (stopped || currentGeneration !== generation || !transportReady) return;

      const next = new MessageStore(store.status, store.limit);
      for (const message of history.values()) next.upsert(normalizeMessage(message));
      for (const [type, value] of pending.values()) {
        if (type === 'delete') next.delete(value); else next.upsert(value);
      }
      // No intermediate messages escape: one replacement snapshot is the commit.
      store.replace(next.snapshot().messages, {
        connected: true, channelName: channel.name, guildName: channel.guild.name,
        error: null, lastSyncedAt: new Date().toISOString(),
      });
      pending.clear();
      syncing = false;
      channelReady = true;
      retryAttempt = 0;
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
      console.info(JSON.stringify({ event: 'discord_history_synced', retainedMessages: store.messages.size }));
    } catch (error) {
      if (stopped || currentGeneration !== generation) return;
      // Keep both the previous published window and queued changes for retry.
      store.setStatus({ connected: false, error: 'Cannot read the configured channel. Retrying; check channel access and bot permissions.' });
      console.error(JSON.stringify({ event: 'discord_sync_failed', code: error.code ?? error.name }));
    }
  };
  function synchronize() {
    if (stopped || !transportReady) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!syncPromise) {
      syncPromise = runSync().finally(() => {
        syncPromise = undefined;
        if (!channelReady) scheduleRetry();
      });
    }
    return syncPromise;
  }
  function disconnected(reason) {
    if (stopped) return;
    transportReady = false;
    generation += 1; // Invalidate a history request started on the previous connection.
    clearTimeout(retryTimer);
    retryTimer = undefined;
    store.setStatus({ connected: false, error: reason });
    armRecoveryDeadline();
  }
  client.on(Events.ClientReady, () => {
    if (stopped) return;
    transportReady = true;
    synchronize();
  });
  client.on(Events.ShardDisconnect, () => disconnected('Discord connection lost; reconnecting.'));
  client.on(Events.ShardReconnecting, () => disconnected('Reconnecting to Discord.'));
  client.on(Events.ShardResume, () => {
    if (stopped) return;
    transportReady = true;
    // Reconcile with the source even after successful replay; an in-flight REST
    // read may have been invalidated by the disconnect.
    channelReady = false;
    store.setStatus({ connected: false, error: 'Refreshing recent channel history after reconnect.' });
    synchronize();
  });
  client.on(Events.Error, error => {
    if (stopped) return;
    channelReady = false;
    store.setStatus({ connected: false, error: 'Discord source error. Attempting recovery.' });
    console.error(JSON.stringify({ event: 'discord_client_error', code: error.code ?? error.name }));
    armRecoveryDeadline();
    scheduleRetry();
  });
  armRecoveryDeadline();
  try {
    await client.login(token);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
