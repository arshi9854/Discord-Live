# Interview preparation

## What to demonstrate first

The assignment is a Discord bot that streams a channel into a backend-dependent web page. Pocket Post is the presentation layer. Lead with the working message path, not hearts or downloads.

Suggested 60-second introduction:

> Pocket Post displays one Discord channel as a live channel monitor. A Node backend owns the bot connection and token, keeps a bounded message window, and streams updates to the browser using Server-Sent Events. Messages, edits, and deletes appear without refreshing. I chose one service and in-memory storage to keep this small deployment easy to understand, with the tradeoff that it is not a durable archive.

Practice this in your own words. Be able to locate and explain the implementation, including code developed with assistance.

Optional extension: **Catch me up** retrieves up to 3,000 historical messages separately from the live feed for a 1–30-day, optionally member-specific extractive recap. It is not an LLM chatbot: explain exact source excerpts, honest coverage labels, no external AI disclosure, and why adding historical access increases the need for viewer authentication. Keep this demonstration secondary to the assignment's message stream.

## A five-minute demonstration and code tour

1. **First minute:** open the Railway URL. Show real mode, channel name, browser connection, and Discord connection. Post a unique test note in the channel and watch it arrive in two windows.
2. **Second minute:** edit then delete the note. Reload one window and explain its fresh snapshot. Do not describe a reload as proof of Discord reconnection.
3. **Third minute:** open `server/discord.js` and follow the event handler into `normalizeMessage` and `MessageStore.upsert` in `server/store.js`.
4. **Fourth minute:** show `/api/events` in `server/app.js`, then the `snapshot`, `message`, and `delete` listeners in `public/app.js`. Explain that the bot token stays on the backend.
5. **Fifth minute:** state the limits: one configured channel, initial 100 messages, up to 200 retained, one replica, no viewer authentication, no durable event log. Keep the hearts/download demo optional and short.

Leave most of the 25-minute code segment for questions rather than narrating every line.

## Questions worth rehearsing

| Question | What a solid answer should cover |
| --- | --- |
| Why SSE instead of WebSockets? | The browser receives a one-way stream. EventSource offers built-in reconnect. WebSockets become useful if bidirectional features are needed. |
| Why is a backend necessary? | It protects the bot token, maintains the Gateway connection, filters the configured channel, and fans out messages to browsers. |
| What happens after a disconnect? | Browser reconnects receive a replacement snapshot. Gateway recovery refreshes recent history atomically. Failed syncs retry with capped backoff; a two-minute recovery deadline requests process restart. Older events outside the window are not guaranteed. |
| How do you avoid duplicate messages? | Upsert by message ID, rather than append blindly. Fresh snapshots replace the browser's retained window. |
| What about an edit or deletion during history loading? | Buffer/coalesce Gateway changes while fetching history, then apply them. Revision checks reject stale asynchronous fetch completions. |
| Why no database? | It keeps the assignment small. Restarted processes recover recent history; durable retention/replay would justify a database and explicit deletion policy. |
| Can you run multiple replicas? | Not safely with independent in-memory stores and duplicate bot connections. Add coordinated ingestion and shared storage/pub/sub first. |
| Is this secure? | Token stays on server, text uses safe DOM APIs, links require HTTPS, and headers restrict content. The feed is still public and lacks viewer authentication and per-IP limits. |
| What does the healthcheck prove? | `/healthz` means HTTP is serving; `/readyz` returns 503 while the source is not ready. `/api/status` and the UI expose source state. Neither endpoint independently verifies end-to-end message delivery. |
| What would you do with more time? | Prioritize deployment monitoring and access control, then durable recovery if the use case needs it. Avoid inventing unnecessary features. |

You do not need a perfect answer to every hypothetical. State what the current code does, identify the tradeoff, and explain how you would investigate or extend it. If unsure, say so and inspect the relevant code instead of bluffing.

## A concrete debugging story

During local testing, messages from one member appeared while another member's did not. Comparing Discord history with the backend snapshot showed two messages missing from the backend. Logs revealed that requesting avatar size 80 threw for custom avatars. Changing it to a supported size (128), testing with real Discord SDK user objects, and restarting recovered messages from both members.

This is useful evidence of diagnosis: compare the source and destination, inspect logs, reproduce the failure, fix the cause, and add a regression test. The initial mocked avatar function had hidden the SDK validation failure.

## The support discussion

Their agenda includes about 15 minutes discussing support. For a report such as “my friend's message is missing,” explain how you would:

1. Clarify the channel, affected person, approximate time, and expected behavior. Ask for a message link if useful; never request the bot token.
2. Check whether the browser is paused/filtered, whether its stream is connected, and whether Discord is connected.
3. Compare the source message with backend history and browser rendering to isolate the failing layer.
4. Communicate what is confirmed, what is still uncertain, and the next check.
5. Verify with the affected user and record a reproducible test.

The purpose is not just fixing code: show that you can communicate clearly while investigating an unfamiliar issue.

## Before the interview, in order

1. **Deploy:** connect this repository to Railway, add Discord variables privately, keep one replica, disable sleeping, and generate a public domain. The project includes a Dockerfile and `railway.json`.
2. **Verify the public URL:** use the checklist in `deployment-checklist.md`, particularly real notes from two Discord accounts and two browser windows. Automated mocked tests are not a substitute for this acceptance check.
3. **Submit:** send the verified URL in the existing interview thread, with repository access as appropriate. Use `submission-email.md` only after replacing its placeholders.
4. **Rehearse:** deliver the five-minute walkthrough without reading a script. Locate each important handler quickly. Practice three failure scenarios.
5. **Prepare your questions:** ask what support engineers own, how escalations work, what a strong first 90 days looks like, and how the team balances customer communication with engineering work.

Based on the stated agenda, prepare for a practical code review and discussion of choices. The company's exact questioning style is unknown; depth is expected, hostility is not implied by the assignment.
