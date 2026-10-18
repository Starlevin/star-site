# QQ Mail SMTP sending service

Production Cloudflare Worker: `qinghan-qq-mail-sender`, formal account `7c4db00da8528f2c88fb9073a3c60e1d`.
This service replaces the fixed-recipient, one-shot experiment in `test-mail.mjs`. The experiment is not deployed.

## Endpoints

- `GET /health`: public service/version only; no credentials or mail data.
- `POST /probe`: authenticated TLS and SMTP login verification, never sends mail.
- `POST /send`: authenticated plain-text message submission.

Both POST endpoints require `Authorization: Bearer <server-secret>`. The hostname, SMTP port, TLS requirement and sender are server-controlled.

`POST /send` requires JSON:

```json
{"request_id":"unique_stable_id_000001","to":["recipient@example.com"],"subject":"Subject","text":"Plain text body"}
```

Limits: 1–10 unique recipients, 200 subject characters, 50,000 body characters/150,000 UTF-8 bytes; reject header injection, invalid addresses and unrecognized properties. Sender must be a QQ address from Secrets. No delete-mail operation.

## Server Secrets

Set `QQ_EMAIL_ACCOUNT`, `QQ_EMAIL_AUTH_CODE`, `RELAY_TOKEN` through `wrangler secret bulk` stdin. Never put values in source, command arguments, local configuration, Git or logs. `enter-secrets.ps1` is a masked GUI input helper; its stdout must be an anonymous pipe to a trusted provisioning parent, never a console/log.

The existing Site keeps its IMAP URL/token; sending uses separate `QQ_SMTP_URL` and `QQ_SMTP_TOKEN` server Secrets. Keep the original Site ID, private audience and ChatGPT authentication.

## Delivery and deduplication

Each stable `request_id` names a SQLite-backed Durable Object. Before opening SMTP it persists a reservation containing a content fingerprint, generated Message-ID and timestamp. It does not persist body or recipient lists. The same ID/content never re-enters SMTP; different content returns HTTP 409. Tombstones are retained without TTL or reset API, including failed and uncertain attempts.

An SMTP 250 after DATA means `accepted`, not final delivery. Network failure after DATA, interrupted reservations or persistence failures after acceptance mean `unknown`, `automaticRetry:false`. Never change an ID to work around uncertainty. Check the destination and QQ Sent/rejection notices manually before authorizing a distinct new send. There are no SMTP retries, queue consumers or alarms. At-most-one attempt sacrifices availability after interruption; it cannot guarantee exactly-once Internet mail delivery.

Use implicit verified TLS to `smtp.qq.com:465`. Never set insecure certificate flags. No automatic plan upgrades. Uses SQLite Durable Objects available on Workers Free; quotas can stop requests.

## Validation/deployment

```sh
npm ci
node --test service.test.mjs
npx wrangler whoami
npx wrangler deploy --dry-run
npx wrangler deploy
```

Local tests inject scripted SMTP responses and simulate persistent object restarts; they do not send email. Wrangler OAuth credentials are managed in its standard user configuration, outside this repository. Production SMTP and delivery need explicit authorization and separate live checks.
