# Reliability: behavior, evidence, and limits

The goal is predictable failure behavior in a small single-service application, not an exactly-once messaging system.

| Failure | Behavior | Test evidence |
| --- | --- | --- |
| Browser loses connection | EventSource reconnects and receives a replacement snapshot | HTTP reconnect and browser stream-error tests |
| History refresh fails halfway | Retain the previously published window; publish the replacement atomically only after normalization succeeds | Failed-history atomicity test |
| Source disconnects during an outstanding request | Reject completions from the old connection generation | Late history and partial-fetch tests |
| Delete or newer edit races an older fetch | Per-message revision guards and edit timestamps reject stale updates | Deletion and stale-edit tests |
| History service temporarily fails | Retry with exponential backoff, capped at 30 seconds | Fake-clock retry/backoff test |
| Recovery stalls | Two-minute deadline stops ingestion and requests nonzero process exit | Recovery deadline and late-completion test |
| Too many or slow browsers | Cap streams at 100; disconnect excessive output buffering/blocked writes | Stream capacity, heartbeat, and cleanup test; slow-write policy is not load-tested |
| Cosmetic avatar lookup throws | Preserve the actual message with no avatar | Avatar failure and real SDK regression tests |

`/healthz` means HTTP is alive. `/readyz` reflects source synchronization and returns 503 while disconnected. Neither proves that an individual Discord message reached a viewer. The UI separates browser transport and Discord source status; its last-update time is receipt time, not measured latency. Logs identify synchronization/recovery events without logging message contents or bot credentials.

Railway is configured to restart on nonzero exit, with at most ten retries. Its deployment healthcheck is not a continuous monitor. Add external readiness monitoring for a real public service; permanent bad credentials or permissions require an operator, not endless retries. A fatal exit under local `npm start` requires manually starting it again.

## Deliberate limits

- One process and one replica; no shared state or durable event log.
- Up to 200 messages in memory; a source resynchronization replaces that window with up to 100 recent messages plus concurrent buffered events. Older retained messages may disappear after recovery.
- Missed events beyond the recoverable window are not guaranteed. Browser snapshots reconcile current retained state, not every historical event.
- The feed is public. Production access control, per-IP abuse controls, load testing, and deployed outage drills remain work to do.
- Mocked lifecycle tests exercise race conditions reproducibly, but do not substitute for a two-member real Discord test on the deployed URL.

## Interview explanation

“I tested failures as well as the happy path: an old request cannot declare a disconnected bot healthy, and a failed refresh cannot replace good data with partial history. Recovery is bounded, status distinguishes the failing layer, and resource limits are explicit. I can show the regression tests and explain what the app still cannot guarantee.”

That gives the interviewer concrete engineering decisions to discuss without overstating production readiness.
