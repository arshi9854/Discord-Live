import { createApp } from './app.js';
import { MessageStore } from './store.js';
import { startDiscord } from './discord.js';
import { startDemo } from './demo.js';
import { createSummaryService, SummaryError } from './summary.js';
import { createLLMProvider } from './llm.js';

const demo = process.env.DEMO_MODE === 'true';
if (!demo && (!process.env.DISCORD_BOT_TOKEN || !/^\d{17,20}$/.test(process.env.DISCORD_CHANNEL_ID ?? ''))) {
  console.error('Set DISCORD_BOT_TOKEN and a valid DISCORD_CHANNEL_ID, or set DEMO_MODE=true explicitly.');
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const store = new MessageStore({
  mode: demo ? 'demo' : 'discord', connected: false,
  channelName: null, guildName: null, error: null,
});
let readHistory;
const llm = createLLMProvider();
const summarize = createSummaryService({ generate: llm.generate, readHistory: options => {
  if (demo) return { messages: store.snapshot().messages, complete: false, source: 'demo' };
  if (!readHistory) throw new SummaryError('Discord is still connecting. Try again shortly.', 503);
  return readHistory(options);
} });
const { app, closeStreams } = createApp(store, { summarize, summaryConfig: llm.status });
const server = app.listen(port, '0.0.0.0', () => console.log(`Discord Live listening on port ${port} (${store.status.mode} mode)`));
let stopSource = () => {};
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  stopSource();
  closeStreams();
  server.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
try {
  stopSource = demo ? startDemo(store) : await startDiscord(store, {
    token: process.env.DISCORD_BOT_TOKEN, channelId: process.env.DISCORD_CHANNEL_ID,
    onFatal: () => { process.exitCode = 1; shutdown(); },
    onHistoryReady: reader => { readHistory = reader; },
  });
  if (stopping) stopSource();
} catch (error) {
  console.error('Discord login failed:', error.message);
  process.exitCode = 1;
  shutdown();
}
