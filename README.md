# ↳ Pocket Post

**One channel. Less scrolling. More context.**

![Node.js](https://img.shields.io/badge/Node.js-22.12%2B-339933?style=flat-square)
![Live](https://img.shields.io/badge/Messages-Live-38BDF8?style=flat-square)
![AI](https://img.shields.io/badge/OpenRouter-Optional-A78BFA?style=flat-square)

A clean, live view of a Discord channel—for community events, announcements, and catching up.

## ✨ Features

- Live messages, edits, and deletions.
- Topic estimates and channel activity.
- 1–30-day recaps, with optional member filtering and AI.
- Bookmarks, search, exports, and light/dark themes.

## ⚡ Run locally

Requires Node.js **22.12+**.

```bash
npm ci
npm run demo
```

Open **http://localhost:3000**. Demo mode uses labeled sample messages.

For real Discord messages, configure [.env.example](.env.example) as `.env`, set `DEMO_MODE=false`, stop the demo, and run `npm start`. Never commit tokens or API keys. [Setup instructions →](docs/implementation-guide.md)

## 🧩 How it works

**Discord → Node backend → live web feed**

The backend keeps the bot token private, reads the configured channel, and sends updates to the browser using Server-Sent Events (SSE). It retains up to 200 messages and refreshes the feed after reconnection.

**Why this approach?** SSE suits one-way updates better than a two-way WebSocket connection here. In-memory storage keeps deployment simple, while a database would provide durable history. Local recaps work without an AI account; OpenRouter is optional.

## ⚠ Limitations

The feed has no viewer login—use a public/test channel. History is temporary; recaps scan up to 3,000 messages and flag gaps. Topic estimates can miss context. Optional AI summarizes only six selected excerpts and may be wrong.

## 🚀 Test & deploy

```bash
npm test
npm run check
npm run test:browser
```

Browser tests require Google Chrome. Deploy on Railway with the included Dockerfile and service variables. [Deployment checklist →](docs/deployment-checklist.md)
