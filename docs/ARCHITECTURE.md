# ARCHITECTURE.md

**System:** DCL Sales & Dispatch · **Version:** 1.0 · 19 Nov 2026
Language: **JavaScript only** (ES2023, ESM). No TypeScript files. Types are documented with **JSDoc** and checked in the editor (`jsconfig.json` with `checkJs`), and every external input is validated at runtime with **Zod**.

---

## 1. Context

```
                         ┌──────────────────────── Head office LAN / Internet ───────────────────────┐
 Sales/Finance/CFO ──▶   │  Next.js web (apps/web)  ──/api──▶  Fastify API (apps/api)  ──▶ Oracle 19c │
 (Chrome/Edge, phone)    │        ▲   SSE                         │   │                    (SALES_NEW   │
                         │        │                               │   └─▶ Redis ◀── Worker (apps/worker)│
                         │        │                               │          BullMQ: PDF, Excel,      │
                         │        │                               │          notifications, FBR,      │
                         │        │                               │          ledger recon, imports    │
                         └────────┼───────────────────────────────┼──────────────────────────────────┘
                                  │                               │  HTTPS (device key + HMAC)
 Plant (Karachi / Hattar)         │                               │
   Gate tablet / PC  ── PWA (apps/web /plant, offline: IndexedDB + service worker)
   Weighbridge PC   ── weighbridge agent (apps/weighbridge-agent) ── RS-232/TCP ── weight indicator
                       └─ ws://localhost:7071 → weighing screen; buffered upload → API
 External: FBR Digital Invoicing (PRAL) API · SMS gateway · SMTP (per-user) · WhatsApp click-to-chat
```

## 2. Technology choices (with reasons)

| Concern | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | Shared rules/schemas between API, web, worker, agent; cached builds |
| Runtime | **Node.js 22 LTS** | Current LTS, native fetch, test runner fallback |
| API | **Fastify 5** + `@fastify/cookie`, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/multipart`, `@fastify/swagger` + `@fastify/swagger-ui`, `fastify-type-provider-zod` | Fast, schema-first, plugin model, first-class OpenAPI |
| Validation | **Zod** (shared schemas in `packages/shared`) | One schema for API validation, OpenAPI and React Hook Form |
| Oracle driver | **node-oracledb 6** — **Thin mode** for 19c; **Thick mode** (Instant Client) when `ORACLE_CLIENT_MODE=thick` (required for 11g) | Thin needs no client install; 11g still possible |
| Data access | **Knex** (oracledb dialect) as query builder + hand-written SQL for reports; repository per aggregate | ORMs (Prisma etc.) do not support Oracle/legacy keys well; Knex gives transactions and safe binds |
| DB migrations | Plain numbered **SQL files** in `db/migrations` applied by `pnpm db:migrate` (tracks `SCHEMA_VERSION`) | DBA-reviewable, 11g-compatible, same files run by SQL*Plus if needed |
| Money/decimal | **decimal.js** | No float errors in tax/ledger |
| Dates | **date-fns** + `date-fns-tz` (Asia/Karachi) | Small, tree-shakeable |
| Auth | Own JWT (`jose`) access token 15 min + rotating refresh token (DB) in **httpOnly Secure SameSite=Lax cookies**; passwords **argon2id** (`@node-rs/argon2`); TOTP (`otplib`) optional | Full control, no external IdP needed on LAN |
| Authorization | Permission keys (`module.action`) + branch scope, checked by a Fastify `preHandler` and again in services | See PERMISSIONS.md |
| Jobs | **BullMQ + Redis 7** | Retries, scheduling, rate-limited queues (FBR, SMS) |
| PDF | HTML templates (React server components rendered to HTML string) → **Playwright Chromium** PDF in worker; `qrcode` for QR, `bwip-js` for barcodes | Pixel-accurate prints (DO, permit, DC, invoice, reports) |
| Excel | **ExcelJS** | Styled exports, streaming for big reports |
| Email | **Nodemailer** using the user's SMTP account (encrypted at rest) | Spec 10.4 |
| SMS | Adapter interface (`console`, `http-generic` driver configured by URL template) | Provider not chosen yet |
| Logging | **pino** (+ `pino-pretty` in dev), request id, user, branch | Structured logs |
| Metrics/health | `prom-client` `/metrics`, `/health/live`, `/health/ready` (DB + Redis ping) | Ops |
| Errors | RFC 7807 `application/problem+json`; optional Sentry | Consistent errors |
| Web | **Next.js 15 (App Router, JS/JSX)**, **Tailwind CSS v4**, **shadcn/ui** (generated as `.jsx`), **TanStack Query v5**, **TanStack Table v8** (+ `@tanstack/react-virtual`), **React Hook Form** + `@hookform/resolvers/zod`, **Recharts**, **sonner** toasts, **cmdk** command palette, `lucide-react` icons, `nuqs` URL state | Modern, fast, accessible components |
| PWA/offline | **Serwist** (service worker) + **Dexie** (IndexedDB) outbox | Gate/weighing offline |
| QR scanning | `@zxing/browser` (camera) + keyboard-wedge USB scanners | Works on tablets and PCs |
| Real-time | Server-Sent Events from API (`/api/v1/events`) | Dashboards, plant board; simpler than WebSockets through proxies |
| Weighbridge agent | Node 22 + **serialport** + `net` + **better-sqlite3** buffer + `ws` local server; packaged as Windows service with **node-windows** (or NSSM) | Runs beside indicator |
| Tests | **Vitest** (unit/integration), `fastify.inject` for API, **Testcontainers** `gvenzl/oracle-free` (23ai Free, run in 19c-compatible mode by only using 11g features) or a shared test schema, **Playwright** e2e, **MSW** for web mocks | |
| Lint/format | ESLint 9 flat config (`eslint-plugin-n`, `eslint-plugin-react`, `react-hooks`, `jsx-a11y`, `import`), Prettier, `lint-staged` + **husky**, commitlint (Conventional Commits) | |
| CI | GitHub Actions: install → lint → unit → integration (Oracle container) → build → e2e (smoke) | |
| Deploy | Windows Server or Linux; **PM2** (or Docker Compose) for api/worker/web; **Nginx/Apache reverse proxy** with TLS (`sales.dewancement.com`) | Matches existing infra (Apache reverse proxy used today) |

## 3. Repository layout

```
dcl-sales/
├─ CLAUDE.md
├─ docs/  (BRD, PRD, ARCHITECTURE, SCHEMA, API_SPEC, PERMISSIONS, BUSINESS_RULES, TASKS, reference/)
├─ db/
│  ├─ 01_DCL_SALES_TABLES.sql … 04_CLEANUP_DUPLICATES.sql   (existing, do not edit casually)
│  ├─ 05_NEW_SYSTEM_TABLES.sql                              (new tables + columns, see SCHEMA.md)
│  ├─ migrations/NNN_description.sql                         (all later changes)
│  └─ seed/ (roles, permissions, settings, approval rules, templates, print texts)
├─ apps/
│  ├─ api/            Fastify
│  │  └─ src/
│  │     ├─ server.js, app.js (plugin registration)
│  │     ├─ plugins/   (db, redis, auth, rbac, branch-scope, audit, idempotency, errors, swagger, sse)
│  │     ├─ modules/<module>/ routes.js · service.js · repo.js · schemas.js (re-export from shared) · *.test.js
│  │     │    modules: auth, users, roles, settings, approvals, audit, numbering, masters, customers,
│  │     │             pricing, srf, oc, brv, balance, permits, dos, plant (gate, weighing, dc, exit, sync),
│  │     │             invoices, fbr, ledger, notes, incentives, targets, reports, share, notifications,
│  │     │             dashboards, devices, files
│  │     └─ lib/ (oracle helpers, money, errors, pagination, pdf client, crypto)
│  ├─ worker/         BullMQ processors: pdf, excel, notify-sms, notify-email, fbr-submit, ledger-recon,
│  │                   rate-import, incentive-run, link-cleanup
│  ├─ web/            Next.js
│  │  └─ src/app/(auth)/login · (app)/[module]/… · plant/… (PWA) · share/[token] (public PDF link)
│  │     src/components/ui (shadcn), src/components/<domain>, src/lib (api client, query keys, format)
│  └─ weighbridge-agent/
├─ packages/
│  ├─ shared/         zod schemas, enums/status machines, permission keys, rule functions
│  │                  (tax.js, balance.js, weight.js, numbering-format.js, qr.js), constants
│  ├─ pdf-templates/  print layouts (DO, permit, DC/gate pass, invoice, CRF, notes, reports)
│  └─ config/         eslint, prettier, vitest presets
└─ tools/ (scripts: gen-legacy-docs, seed-dev, fake-weighbridge, load-test)
```

## 4. Layering rules (API)

```
route (HTTP, auth, validation)  →  service (business rules, transactions, state machine)  →  repo (SQL only)
                                      ↘ packages/shared rule functions (pure)
                                      ↘ outbox (notifications/jobs) written in the same transaction
```
- Routes never contain SQL or rules. Repos never contain rules. Services never touch `req`/`reply`.
- **One DB transaction per command** (`withTx(async (tx) => …)`), including: number allocation, document rows, ledger rows, audit rows, outbox rows. Commit or nothing.
- **Optimistic locking**: every editable new-style row has `ROW_VER`; updates use `WHERE ROW_VER = :ver` and the API requires `If-Match`. Conflicts → 409.
- **Pessimistic locks** only for: `DOC_SEQUENCE` row, customer balance check (`CUSTOMER_INFO` row), DO/permit line during dispatch allocation. Always lock in a fixed order (customer → document → sequence) to avoid deadlocks.
- **Idempotency**: all POST commands accept `Idempotency-Key` (required for plant/offline endpoints); stored in `IDEMPOTENCY_KEY` with the response for 7 days.

## 5. Data access to the legacy schema

- Tables keep legacy names and columns (`docs/reference/LEGACY_TABLES.md`). The repo layer maps them to clear JS names (e.g. `DEL_ORDER_NO → doNo`, `DO_QUANTITY → qtyTon`) in one mapping file per table.
- Composite keys always include `BRNCH`. Helper `keyOf(row)` builds `{ brnch, … }`.
- New status column `DOC_STATUS` (added by 05) is the source of truth; legacy flags (`CANCEL_CODE`, `POST`, `APPROVED`, `CANCEL_FLAG`) are written alongside for old reports.
- No Oracle 12c+ syntax: use `ROWNUM` pagination wrappers, `NVL`, sequences + triggers only for technical ids of new tables, `CLOB` for JSON text.
- Bind variables everywhere; `oracledb.fetchAsString = [oracledb.CLOB]`; numbers that are money fetched as strings and wrapped in `Decimal`.
- Connection pool: `poolMin 4, poolMax 30, poolIncrement 2, stmtCacheSize 50`; `CLIENT_IDENTIFIER` and `MODULE/ACTION` set per request for DBA tracing.

## 6. Key flows (sequence)

### 6.1 OC confirmation
```
POST /oc/{brnch}/{no}/confirm
 └ tx:
    lock CUSTOMER_INFO(brnch, customer) FOR UPDATE
    load OC (check state APPROVED, ROW_VER)
    available = BalanceService.available(tx, customer)          // BR-BAL
    if available < value and no approved override → 422 with shortfall
    for each schedule line: allocate DO no (DOC_SEQUENCE FOR UPDATE), insert DELIVERY_ORDER (+QR token)
    post DO ledger Dr per DO; update OC status CONFIRMED; audit; outbox(DO_ISSUED → dealer, PDF job)
 commit → enqueue jobs from outbox (worker polls outbox; at-least-once, idempotent handlers)
```

### 6.2 Plant
```
Gate-in (scan QR) → POST /plant/gate-passes  [Idempotency-Key]
   validate QR sig, doc state, branch, remaining qty, same customer/type/destination
   insert GATE_PASS(IN) + DC (ISSUED, number allocated) + DC lines (planned)
Weighing  → POST /plant/gate-passes/{id}/tare | /gross   (reading id from agent or manual+reason)
   gross: net, variance, allocate net to lines (largest remainder)
   |variance| ≤ tolerance → finalise invoices (tx: INV numbers, tax, DO/permit dispatched, DC ledger, outbox FBR)
   else → status VARIANCE_BLOCKED (approval request WEIGHT_OVERRIDE)
Worker fbr-submit → FBR API → store IRN/QR → SSE update to plant board
Exit → POST /plant/gate-passes/{id}/exit  (checklist BR-EXIT-02) → EXITED, outbox(TRUCK_EXITED)
```

### 6.3 Offline sync
```
PWA Dexie outbox: [{clientId(UUID v7), type, payload, deviceTime}]
online → POST /plant/sync (batch ≤ 50, ordered) → per event: idempotent apply | conflict → SYNC_CONFLICT queue
server response maps clientId → server ids (gate pass id, DC no) → PWA updates local records
```

### 6.4 Weighbridge agent
```
indicator --(serial/TCP frames)--> parser profile (regex) --> reading {kg, stable, ts}
  → ws://localhost:7071 broadcast (weighing screen shows live digits)
  → on "capture" from screen: agent signs {deviceId, readingId, kg, ts} with device secret (HMAC)
     and POSTs /plant/weigh-readings (or buffers in SQLite and retries)
API verifies HMAC + device registered to the branch → WEIGH_TICKET(SOURCE=DEVICE)
```

## 7. Security

- TLS everywhere (reverse proxy); HSTS; secure cookies; CSRF double-submit token for state-changing requests from the web app; CORS limited to the web origin.
- Rate limits: login 10/min/IP; public share links 30/min/IP; FBR/SMS queues provider-limited.
- Device auth for weighbridge agents and gate tablets: device id + secret (rotatable) → short-lived device token; device bound to branch.
- Secrets: `.env` (never committed) / Windows credential store in prod; encryption key `APP_ENC_KEY` (32 bytes) for SMTP/FBR credentials (AES-256-GCM, `crypto`).
- DB: app connects as `SALES_APP` with grants on SALES_NEW objects (no DDL, no DELETE on business tables, INSERT-only on `AUDIT_LOG`, `CUSTOMER_LEDGER`, `WEIGH_TICKET`). Migrations run as schema owner.
- Public share links: random 32-byte token, expiry, single file, no listing, logged.
- Dependency scanning (`pnpm audit` in CI), lockfile committed.

## 8. Performance

- Indexes for every list filter (SCHEMA.md §6). Reports run as SQL with bind params; heavy reports in worker with streaming to Excel/PDF.
- Balance: computed from `CUSTOMER_LEDGER` (indexed by customer/type) + open commitments query; cached per request only (never across requests).
- Web: server components for read-heavy pages, TanStack Query cache for client screens, virtualised tables.

## 9. Environments & configuration

| Env | DB | Notes |
|---|---|---|
| local | Oracle Free container or shared dev schema | `pnpm dev` runs api, worker, web, fake weighbridge |
| test/CI | Oracle container, schema built from db/01 + 05 + seed | |
| staging | copy of SALES_NEW with Sep 2026 data | FBR sandbox |
| production | Oracle 19c, `SALES_NEW` (rename per DBA) | FBR production per branch |

Required env vars (documented in `.env.example`): `DATABASE_USER/PASSWORD/CONNECT_STRING`, `ORACLE_CLIENT_MODE`, `ORACLE_LIB_DIR`, `REDIS_URL`, `JWT_SECRET`, `QR_SECRET`, `APP_ENC_KEY`, `WEB_ORIGIN`, `PUBLIC_BASE_URL`, `FBR_*` (per branch), `SMS_DRIVER`, `SMS_URL_TEMPLATE`, `PDF_CHROMIUM_PATH`.

## 10. Architecture decisions (ADR summary)

| # | Decision | Alternatives rejected |
|---|---|---|
| ADR-1 | Keep the unified legacy-named schema; add new tables/columns | Clean-room schema (would break migration & old reports) |
| ADR-2 | Fastify over Express/NestJS | Express (slower, no schema-first), NestJS (TS-centric, decorators awkward in JS) |
| ADR-3 | Knex + SQL, no ORM | Prisma/TypeORM (Oracle/legacy composite keys support poor) |
| ADR-4 | Gap-free numbers via `DOC_SEQUENCE … FOR UPDATE` in the business tx | Oracle sequences (gaps on rollback) |
| ADR-5 | Posted ledger table, written atomically | Ledger by query only (slow, can miss entries) |
| ADR-6 | Transactional outbox for notifications/FBR/PDF | Direct calls inside requests (lost on crash) |
| ADR-7 | Signed QR (HMAC) verified offline | Plain doc number (forgeable) |
| ADR-8 | DC allocated at gate-in, invoice number at finalisation | Invoice at gate-in (gaps when aborted) |
| ADR-9 | SSE for live boards | WebSockets (proxy complexity) |
| ADR-10 | Oracle 19c target, 11g-compatible SQL, Thin/Thick switch | 11g-only (Thick mandatory, EOL) |
| ADR-11 | JavaScript + JSDoc + Zod (no TS) | TypeScript (client decision) |
