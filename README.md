# DCL Sales & Dispatch

Sales, order and plant-dispatch system for Dewan Cement Limited (Karachi = BRNCH 1, Islamabad/Hattar = BRNCH 2).
Node.js + Next.js, **JavaScript only**, Oracle (19c target, 11g-compatible SQL). Specification: [`docs/`](docs/) — start with [`CLAUDE.md`](CLAUDE.md).

## Layout

| Path                     | What                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`               | Fastify 5 REST API (`/api/v1`), OpenAPI at `/api/v1/docs` (non-production)                                                            |
| `apps/worker`            | Outbox relay + BullMQ processors (SMS, PDF, …)                                                                                        |
| `apps/web`               | Next.js 15 web app (staff UI; plant PWA later)                                                                                        |
| `apps/weighbridge-agent` | Weighbridge PC service (P3-02; placeholder)                                                                                           |
| `packages/shared`        | Business rules and schemas shared by API, worker and web (money, dates, state machines, permissions, roles, settings, QR, validators) |
| `packages/pdf-templates` | Print layouts (letterhead, QR, barcode)                                                                                               |
| `db/`                    | Unified schema scripts 01–05, `migrations/NNN_*.sql`, reports                                                                         |
| `docs/`                  | BRD, PRD, business rules, architecture, schema, API, permissions, tasks, runbook                                                      |

## Prerequisites (build/test server)

- Node.js ≥ 22 (26 in use), pnpm 10 (`npm i -g pnpm@10`)
- Oracle Instant Client (Thick mode; required for 11g) — `ORACLE_LIB_DIR`
- Redis 7 compatible server — Memurai Developer on Windows (`winget install Memurai.MemuraiDeveloper`)
- Playwright Chromium for PDFs and e2e (`pnpm --filter @dcl/web exec playwright install chromium`)

## Setup

```bash
pnpm i
cp .env.example .env          # fill DATABASE_*, TEST_DB_*, secrets (see comments in the file)
pnpm db:migrate               # applies db/05 + db/migrations in order (no-op when up to date)
pnpm db:seed                  # roles, permissions, settings, approval rules, numbering, first admin
```

The first `db:seed` prints a one-time password for user `admin` (must be changed at first sign-in).

## Run

```bash
pnpm --filter @dcl/api dev      # API on :4000
pnpm --filter @dcl/worker dev   # worker (needs Redis/Memurai)
pnpm --filter @dcl/web dev      # web on :3200 (3000/3100 are used by other apps on the test server)
```

## Quality gates

```bash
pnpm lint && pnpm format:check
pnpm test            # unit + Oracle integration tests (TEST_DB_*). Every test rolls back.
pnpm --filter @dcl/web build && pnpm test:e2e   # Playwright against a sandbox API that never commits
```

Integration tests never commit: services run in transactions that are rolled back, and API tests run the
whole app on one connection with savepoints (`apps/api/test/helpers/app.js`). The e2e sandbox
(`apps/api/test/e2e-server.js`) creates its test user inside an uncommitted transaction.

## Rules that bite

- `UV_THREADPOOL_SIZE` must be ≥ `DB_POOL_MAX + 4` in Thick mode (set in `.env`), otherwise sessions waiting on
  `FOR UPDATE` starve the lock holder and the pool deadlocks. The API refuses to start otherwise.
- Oracle reserved words cannot be bind names (`:by`, `:at` …).
- Document numbers come only from `DOC_SEQUENCE … FOR UPDATE` (`nextNumber`), never from sequences.
- Route code must not open a second unit of work inside its transaction (authorisation data is preloaded).
