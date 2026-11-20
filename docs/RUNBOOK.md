# RUNBOOK — DCL Sales & Dispatch

Operations notes. Started in P0; completed in P6-08 (deployment, backups, monitoring).

## Processes

| Process | Command                             | Port | Notes                                                             |
| ------- | ----------------------------------- | ---- | ----------------------------------------------------------------- |
| API     | `pnpm --filter @dcl/api start`      | 4000 | Fastify; `/health/live`, `/health/ready` (DB + Redis), `/metrics` |
| Worker  | `pnpm --filter @dcl/worker start`   | —    | Outbox relay, BullMQ processors, approval expiry                  |
| Web     | `pnpm --filter @dcl/web start`      | 3200 | Next.js; forwards `/api/v1` to `API_URL` at runtime               |
| Redis   | Memurai service (Windows) / Redis 7 | 6379 | Queues only; rebuildable                                          |

## Reverse proxy

Route `/api/v1/` **directly to the API** (not through Next.js) so client IPs reach the API's rate limits and
`X-Forwarded-For` is trusted. Route everything else to the web app. Block `/metrics` from outside the
internal network. Enable TLS and set `COOKIE_SECURE=true`.

## Environment

All variables are documented in `.env.example`. Required on every host that talks to Oracle in Thick mode:
`ORACLE_LIB_DIR` and `UV_THREADPOOL_SIZE ≥ DB_POOL_MAX + 4` (set before Node starts).

## Database changes

- New migration = new file `db/migrations/NNN_name.sql`, re-runnable ("already exists" errors are ignored).
- Apply with `pnpm db:migrate` as the schema owner (refuses SYS/SYSTEM). Check with `--dry-run` first.
- A failed migration is not recorded; fix the file and run again.
- XE test server: no DROP, no `ALTER … MODIFY`, no comment after `;` (damaged dictionary, SCHEMA §2.5).

## Health checks and failures

- `GET /health/ready` → 503 lists which dependency failed (`db`, `redis`).
- Failed or dead notifications/jobs: Admin → Outbox & jobs (`NOTIFICATION_OUTBOX` status FAILED/DEAD).
- Rows stuck in PROCESSING are put back to PENDING by the worker after the 5-minute lease.
- Every request has an `X-Request-Id`; error responses show it as "Reference" — search the logs by it.

## Accounts

- First admin: created by `pnpm db:seed` (one-time password printed once; change at first sign-in).
- Locked user: Admin → Users → Unlock (or wait `LOGIN_LOCK_MIN`).
- Lost admin access: run `pnpm db:seed` only creates an admin when `APP_USER` is empty; otherwise reset
  a SYS_ADMIN's password from another SYS_ADMIN account.
