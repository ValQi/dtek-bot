# Cloudflare deployment

The Worker handles Telegram webhooks and stores subscriptions in a SQLite Durable Object. GitHub Actions collects DTEK data in Chromium. Cloudflare's five-minute cron dispatches the GitHub workflow. Source data is a schedule, not a physical electricity sensor.

Deployment order matters:

1. Deploy `worker/wrangler.jsonc` using Node 22 or newer. The Worker can be deployed before its secrets exist; `/health` must report `ready: false` until they are configured.
2. Configure Worker secrets: `TELEGRAM_BOT_TOKEN`, `DTEK_ADDRESSES_JSON`, `STATE_KEY`, `WORKER_SECRET`, `WEBHOOK_SECRET`, `GITHUB_DISPATCH_TOKEN`. Use the existing state key, a random key for each of the two Worker secrets, and a GitHub fine-grained token restricted to this repository with Actions write permission. Never commit a secrets file.
3. Import the existing encrypted `bot.enc` from the `bot-state` branch by POSTing its JSON to `/admin/import`, authenticated by `X-Worker-Key`. Check `/admin/status` for the expected subscriptions before switching Telegram. Import is permitted only once.
4. Configure repository secrets `WORKER_URL` and `WORKER_SECRET`. Change the workflow collector to `node src/run-cloud.cjs` and pass these secrets to it. Stop the previous local polling service. Do not run `src/run.cjs` after switching to a webhook.
5. Set Telegram's webhook to the Worker `/telegram` URL, using `WEBHOOK_SECRET` as `secret_token`, `max_connections: 1`, and `allowed_updates: ["message", "callback_query"]`. Preserve pending updates. One webhook connection preserves update order across retries.
6. Verify `getWebhookInfo` has the expected URL and no delivery errors, and `/health` reports ready. Test the real group and private address menus, saving selections, and `/status`. Confirm Cloudflare's cron creates a successful GitHub workflow_dispatch run without a manual trigger.

Keep addresses and subscribers out of public logs. Only the encrypted migration snapshot may be read from GitHub publicly; subscription state subsequently lives in the Durable Object. Protect administrative and result routes with the separate Worker secret. Telegram webhooks use their own secret. Rotate the GitHub token before expiry to keep scheduled checks running.
