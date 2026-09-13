# ↳ Pocket Post
### One channel. Less scrolling. More context.

![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-339933?style=flat-square)
![Live stream](https://img.shields.io/badge/Live_stream-SSE-38BDF8?style=flat-square)
![Optional AI](https://img.shields.io/badge/AI-OpenRouter_optional-A78BFA?style=flat-square)

A terminal-inspired window into a Discord channel. Follow conversations live, spot recurring topics, and catch up without scrolling through everything.

## ✨ At a glance

- **Live feed** — messages, edits, and deletions arrive without refreshing.
- **Channel pulse** — activity counts and expandable keyword clusters.
- **Catch me up** — 1–30-day recaps, optionally filtered by member; local summaries or opt-in AI.
- **Your view** — bookmarks, text exports, search, pause, and light/dark themes.

Built for a community event display or a focused public-announcements feed—not a replacement for Discord.

## ⚡ Try it

Requires Node.js **22.12+**.

```bash
npm ci
npm run demo
```

Open **http://localhost:3000**. Demo messages are synthetic and visibly labeled.

For real messages, create `.env` from [.env.example](.env.example), set your bot token and channel ID, and use `DEMO_MODE=false`. Enable **Message Content Intent** and grant **View Channel / Read Message History**, then stop demo mode and run `npm start`.

**Never commit `.env` or API keys.** [Discord and optional AI setup →](docs/implementation-guide.md)

## 🧩 Under the hood

```mermaid
flowchart LR
  D[Discord channel] -->|Gateway| B[Node + discord.js]
  B --> S[Bounded message store]
  S -->|SSE| W[Web interface]
  style D fill:#5865F2,color:#fff
  style B fill:#286335,color:#fff
  style S fill:#34566F,color:#fff
  style W fill:#70529A,color:#fff
```

One backend serves the page, protects the bot token, and streams every source message. It retains up to **200 messages**, refreshes recent history atomically, and reconciles browser reconnects with snapshots. Recovery uses bounded retries; `/healthz` checks HTTP and `/readyz` reports source readiness.

## ↔ Why these choices?

| Choice | Tradeoff |
| --- | --- |
| SSE over WebSockets | Fits one-way delivery; no bidirectional protocol needed. |
| One service, in-memory state | Simple to deploy; no durable archive or horizontal scaling. |
| Local recaps + optional OpenRouter | Works without a key; AI adds synthesis, cost, and external sharing. |

## ⚠ Know the limits

- **Public by design:** no viewer authentication. Use only an intentionally public/test channel.
- **Bounded history:** recaps scan at most 3,000 messages and label incomplete coverage.
- **Estimates, not certainty:** topics are keyword clusters. AI sees up to six selected excerpts, can be wrong, and requires opt-in.
- **Not permanent storage:** bookmarks depend on retained messages; exports and existing recaps do not automatically retract after source deletion.

## 🚀 Verify & ship

```bash
npm test
npm run check
npm run test:browser
```

**30 unit/backend tests + 9 browser tests.** Browser tests require Google Chrome; AI tests use mocked responses.

Deploy this repository on Railway using the included `Dockerfile` and `railway.json`. Add Discord variables, keep one replica, generate a public domain, and verify real messages before sharing the URL.

**Deployment and a live OpenRouter call remain unverified.**

[Setup guide](docs/implementation-guide.md) · [Reliability](docs/reliability.md) · [Deployment checklist](docs/deployment-checklist.md)
