# Deployment and real-channel acceptance

These are completion criteria, not a claim that deployment has happened. Leave each unchecked until observed against the public URL.

## Account and deployment setup

- [ ] Push the project to the intended GitHub repository. Confirm `.env` is excluded and give reviewers repository access if it is private.
- [ ] In Railway, create a service from that repository. Its Dockerfile packages the frontend and backend together.
- [ ] Privately set `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, and `DEMO_MODE=false`. Let Railway supply `PORT`.
- [ ] Keep one replica and disable Serverless/app sleeping for the persistent Gateway connection.
- [ ] Confirm the `/healthz` deployment check succeeds and generate a public HTTPS domain.

Railway documents [repository-backed services and Dockerfile detection](https://docs.railway.com/services), [public networking](https://docs.railway.com/networking/public-networking), and [deployment healthchecks](https://docs.railway.com/deployments/healthchecks). Healthchecks gate deployment; they do not provide ongoing application monitoring.

## Verify using a purpose-made public test channel

- [ ] Open the public URL in two browser windows. Both show the intended server/channel and Discord connected. No demo badge appears.
- [ ] Account A posts a uniquely identifiable note. It appears in both windows without refresh.
- [ ] Account B posts a different note. It appears under the correct name in both windows.
- [ ] Edit one test note. Both windows update that same note without adding a duplicate.
- [ ] Delete it. Both windows remove it.
- [ ] Post in another channel. It does not appear.
- [ ] Disconnect the browser from the network, then reconnect. Its connection indicator changes and the next snapshot reconciles the current window.
- [ ] Pause one view, post a note, then resume. The other window continues updating; the paused one catches up on resume.
- [ ] Restart the Railway service. Recent channel history returns and source connectivity recovers. Do not interpret this as durable archival replay.
- [ ] Confirm the browser never receives the bot token. Do not include tokens in screenshots or the submission email.
- [ ] Send the verified URL through the interview email thread.

## Keep an evidence record

Record the tested deployment URL, date, repository commit, and any limitations. A short screen recording of the two-person live demo can be useful as a backup, but the live URL remains the required deliverable.

Current local evidence: HTTP/SSE and mocked Discord lifecycle tests, browser tests, and prior local recovery of messages from two members. Public deployment and full real-account acceptance must still be completed.
