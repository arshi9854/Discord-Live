import express from 'express';
import { fileURLToPath } from 'node:url';
import { SummaryError } from './summary.js';

export function createApp(store, { heartbeatMs = 20_000, maxClients = 100, summarize, summaryConfig = { provider: 'local', configured: false, model: null } } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const clients = new Set();
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/readyz', (_req, res) => res.set('Cache-Control', 'no-store').status(store.status.connected ? 200 : 503).json({ ready: store.status.connected, mode: store.status.mode }));
  app.get('/api/status', (_req, res) => res.set('Cache-Control', 'no-store').json(store.status));
  app.get('/api/summary/config', (_req, res) => res.set('Cache-Control', 'no-store').json(summaryConfig));
  app.post('/api/summary', express.json({ limit: '2kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Browser cross-origin form submissions must not trigger expensive history reads.
    if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
    if (!summarize) return res.status(503).json({ error: 'The recap service is not ready.' });
    try { res.json(await summarize(req.body)); }
    catch (error) {
      const status = error instanceof SummaryError ? error.status : 502;
      if (status === 429) res.set('Retry-After', '10');
      res.status(status).json({ error: error instanceof SummaryError ? error.message : 'Could not retrieve channel history. Check bot access and try again.' });
    }
  });
  app.use((error, _req, res, next) => {
    if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') return res.status(error.status).json({ error: 'Send a valid JSON request under 2 KB.' });
    next(error);
  });
  app.get('/api/events', (req, res) => {
    if (clients.size >= maxClients) return res.status(503).json({ error: 'Viewer capacity reached; try again shortly.' });
    res.status(200).set({
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let drainTimer;
    const write = chunk => {
      if (res.writableLength > 1_048_576) return res.destroy();
      if (!res.write(chunk) && !drainTimer) {
        drainTimer = setTimeout(() => res.destroy(), 10_000);
        drainTimer.unref();
      }
    };
    res.on('drain', () => {
      clearTimeout(drainTimer);
      drainTimer = undefined;
    });
    const send = (event, data) => {
      // A blocked client is disconnected and receives a fresh snapshot when it reconnects.
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      write(': heartbeat\n\n');
    }, heartbeatMs);
    heartbeat.unref();
    clients.add(res);
    store.on('event', send);
    res.on('close', () => {
      clearTimeout(drainTimer);
      clearInterval(heartbeat);
      clients.delete(res);
      store.off('event', send);
    });
    send('snapshot', store.snapshot());
  });
  // There is one store listener per viewer, explicitly bounded above.
  store.setMaxListeners(maxClients + 5);
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  return { app, closeStreams: () => { for (const res of clients) res.end(); } };
}
