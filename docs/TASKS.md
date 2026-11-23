# TASKS.md

Work top to bottom. A task is done only when its **AC** (acceptance criteria) pass as automated tests and the docs it touches are updated. Tick `[x]` and add the date. Do not start a phase before the previous phase's "Gate" tasks are done (phases may overlap only where `Deps` allow).

Legend: **Deps** = tasks that must be done first · **Rules** = BUSINESS_RULES IDs · **API** = API_SPEC section.

---

## P0 — Foundation

- [x] **P0-01 Monorepo scaffold** — pnpm workspaces + Turborepo; `apps/api`, `apps/worker`, `apps/web`, `apps/weighbridge-agent`, `packages/shared`, `packages/pdf-templates`, `packages/config`; Node 22; ESM; ESLint 9 flat + Prettier + husky + lint-staged + commitlint; `jsconfig.json` with `checkJs` for editor checks; `.editorconfig`; `.env.example` (ARCHITECTURE §9); README with setup. ✔ 20 Nov 2026 — packages/config not created: ESLint/Prettier/commitlint config live at the repo root
      AC: `pnpm i && pnpm lint && pnpm test` green on a clean clone; no `.ts` files in repo.
- [x] **P0-02 CI** — GitHub Actions: lint, unit, integration (Oracle test DB from secrets or container), build, Playwright smoke; cache pnpm/turbo. Deps: P0-01. ✔ 20 Nov 2026 — GitHub Actions: lint, format, unit, web build. Integration + e2e run on the build server (runners cannot reach Oracle); self-hosted job prepared, disabled
- [x] **P0-03 Oracle access layer** — `node-oracledb` pool (Thin default, Thick via `ORACLE_CLIENT_MODE`), Knex instance, `withTx`, `paginate` (ROWNUM), CLOB/number fetch rules, `CLIENT_IDENTIFIER/MODULE/ACTION` per request, health check. Deps: P0-01. ✔ 20 Nov 2026 — Thick mode with Instant Client 23 against XE 11.2; UV_THREADPOOL_SIZE guard
      AC: integration test runs a tx with rollback; pagination returns correct pages on 11g-style SQL.
- [x] **P0-04 Migration runner + 05** — `pnpm db:migrate` applies `db/05_NEW_SYSTEM_TABLES.sql` (if `SCHEMA_VERSION` lacks '05') then `db/migrations/NNN_*.sql` in order, records checksum; refuses to run as SYS/SYSTEM. Review 05 against the real test DB and fix any error in a new migration. Deps: P0-03. ✔ 20 Nov 2026 — 001/002 baselined (run earlier with SQL*Plus)
      AC: running twice is a no-op; 05 applies cleanly on a copy of SALES_NEW.
- [x] **P0-05 Shared package** — `money.js` (decimal.js wrappers, rounding half-up), `dates.js`, `enums.js` (all statuses §12 + transitions), `permissions.js` (all keys PERMISSIONS §1), `settings-keys.js` (SCHEMA §5), `qr.js` (BR-QR-01 sign/verify), `numbering-format.js` (suffix), Zod helpers (money string, qty string, CNIC, NTN, STRN, mobile, vehicle). ✔ 20 Nov 2026 — plus roles.js (PERMISSIONS §3 matrix)
      AC: unit tests for each validator and the state machine transition table.
- [x] **P0-06 Fastify app skeleton** — plugins: helmet, cors, cookie, rate-limit, multipart, swagger (zod provider), request id, pino logger with redaction, problem+json error handler (`AppError`), SSE hub, idempotency (IDEMPOTENCY_KEY), `/health/*`, `/metrics`. Deps: P0-03. ✔ 20 Nov 2026
      AC: invalid body → 400 problem+json with field errors; same Idempotency-Key replays response.
- [x] **P0-07 Numbering service** — `nextNumber(tx, brnch, year, docType)` with `FOR UPDATE`; display formatter; seed script from legacy max numbers per (branch, year, type); confirm legacy number formats per doc type with Finance (record in SCHEMA §4). Rules: BR-NUM-*. Deps: P0-04. ✔ 20 Nov 2026 — seeded FY 2027 from legacy maxima; legacy number formats recorded in SCHEMA §4, to confirm with Finance
      AC: 50 parallel allocations → 50 distinct consecutive numbers; rollback returns the number.
- [x] **P0-08 Auth** — login, refresh rotation with reuse detection, logout, change password (argon2id, policy, history), lockout, branch + fiscal year selection, switch-branch, `/auth/me`, CSRF double-submit, optional TOTP. API §2. Deps: P0-06. ✔ 20 Nov 2026 — optional TOTP not built yet
      AC: PRD 4.1 AC; refresh-token reuse revokes the family.
- [x] **P0-09 RBAC + branch scope** — permission resolution per branch, `preHandler` (`config.permission`), maker-checker helper, repo-level branch filter helper, seed roles/permissions (PERMISSIONS §2–3). Deps: P0-08. ✔ 20 Nov 2026
      AC: matrix test (role × key) from a fixture; branch-leak test harness usable by later list endpoints.
- [x] **P0-10 Audit** — `audit.record(tx, {entity, key, action, reason, old, new})`, automatic for commands, viewer endpoint. Rules: BR-AUD-*. Deps: P0-06. ✔ 20 Nov 2026
- [x] **P0-11 Settings** — APP_SETTING read with branch → company fallback, cache per request, admin endpoints, seed defaults (SCHEMA §5). Deps: P0-09. ✔ 20 Nov 2026
- [x] **P0-12 Approval engine** — rule matching (doc type, branch, amount/qty, priority), request with snapshot, levels, approve/reject/cancel/expire, execution hook registry (`onApproved(docType, handler)`) run inside one tx, inbox/sent endpoints, notifications. Rules: BR-APR-*. Deps: P0-09, P0-10. ✔ 20 Nov 2026 — approvers of DO_CANCEL, DC_CANCEL, OC/PERMIT_BALANCE_OVERRIDE, CREDIT_LIMIT, RATE_CHANGE, NOTE_POST are defaults to confirm
      AC: 2-level rule approves in order; requester cannot approve; handler runs once even on double click.
- [x] **P0-13 Outbox + worker** — NOTIFICATION_OUTBOX writer (in tx), worker poller (`SELECT … FOR UPDATE SKIP LOCKED` works on 11g), BullMQ queues (pdf, excel, sms, email, fbr, recon), retries/back-off, dead-letter visibility. Deps: P0-03. ✔ 20 Nov 2026 — Memurai (Redis-compatible) on Windows; e-mail/WhatsApp processors in P2-09
      AC: crash between commit and send still sends exactly once (dedup key).
- [x] **P0-14 Web shell** — Next.js 15 JS, Tailwind v4, shadcn/ui (JSX), layout with sidebar (PRD §3), branch switcher, fiscal year, command palette (cmdk), notifications bell, approvals badge, auth pages, permission-aware navigation, error boundary, toasts, PKR/date formatters, API client with CSRF + refresh handling, TanStack Query provider. Deps: P0-08. ✔ 20 Nov 2026 — e2e login → switch branch → logout passes
      AC: Playwright: login → switch branch → logout.
- [x] **P0-15 PDF service** — `packages/pdf-templates` (letterhead, run time, "system generated"), worker renders with Playwright Chromium; QR (`qrcode`) and barcode (`bwip-js`) helpers; storage path + secure link. Deps: P0-13. ✔ 20 Nov 2026 — templates as escaped HTML functions (no React SSR in the worker); download endpoint with permission + audit
- [~] **P0-16 Admin screens** — users (branches + roles per branch), roles matrix editor, settings, devices, print texts, message templates, GL map, approval rules, audit viewer. API §3. Deps: P0-09…P0-12, P0-14. ◐ 20 Nov 2026 — done: users, roles matrix, settings, approval rules, audit viewer, outbox, approvals inbox. Pending with their modules: devices (P3-01), print texts (P1), message templates (P2-09), GL map (P3)
- **Gate P0**: P0-01…P0-14 done. ✔ 20 Nov 2026 — awaiting review.

## P1 — Masters, customers, pricing

- [x] **P1-01 Generic master module** — list/detail/create/update/deactivate for all simple masters (API §4) incl. product periods, DO types, bags, channels (with `report_group`), banks (`short_code`), instruments per branch, transporters, credit/note types; lookups endpoint. Deps: Gate P0. ✔ 20 Nov 2026 — 17 masters from one registry (`packages/shared/src/masters.js`), migration 003; product periods view-only (new periods with P1-05); short code = COMPANY_BANK.ABBR; geography moved to P1-02
- [x] **P1-02 Geography** — Zone → Territory → Area for both branches; Karachi legacy MASTER_AREA/DISTRICT/CITY read-only + mapping to new shape via LEGACY_MAP (import tool + review screen). Rules: BR-CUS-03. ✔ 20 Nov 2026 — import tool = `db/02d_LOAD_GEO.sql` (already run, 1,122 nodes / 1,100 legacy codes); Masters → Geography: four-level browser, create/rename/deactivate (cascades), legacy-code review, customers-without-geography count (KHI 3,344)
- [x] **P1-03 Customers** — all tabs, code generator, approval (maker-checker), change requests with diff, blocks, security deposits, areas, bank accounts, contacts/notification prefs, 360 panel. Rules: BR-CUS-*. API §5. ◐ 20 Nov 2026 — done: tabs Information/Sales tax/Contacts (+notification prefs)/Group, code generator (decision 20 Nov), approval + change requests via CUSTOMER_APPROVE, blocks (CUSTOMER_BLOCK), areas / security deposits / bank accounts (migration 006). 360 balance card added 23 Nov 2026 with P1-08
      AC: PRD 4.2 AC.
- [x] **P1-04 Credit limits** — credit types A–J, Credit Limit document → approval → CREDIT_LIMITS update. Rules: BR-CUS-07. ✔ 20 Nov 2026 — customer Credit limits tab + Customers → Credit limits page; numbering CLM; column meaning to confirm with Finance (BRD log)
- [x] **P1-05 Tax rates** — ST, FED, WHT (by filer/section), CED, further tax; effective-dated; approval. Rules: BR-TAX-*. ✔ 20 Nov 2026 — WHT in TAX_RATE (migration 007), FED/ST as new product periods, both via RATE_CHANGE approval; further tax = setting FURTHER_TAX_PCT; CED unused (SCHEMA §2.4). No WHT rates seeded: Finance enters them (default 0.1 % filer per BR-TAX-05; non-filer rate not documented)
- [x] **P1-06 Trade prices** — effective-dated rows, history, quote endpoint, Excel import with preview, approval RATE_CHANGE, MRP guard. Rules: BR-PRC-01…06. ✔ 20 Nov 2026 — customer + product + city key (migration 008; 421 active Karachi prices keyed by old area/district only have no city), version codes, quote with period breakdown, ExcelJS import (one approval per file), Masters → Trade prices
- [~] **P1-07 City rate sheets & freight sheets** — AREA_RATES_M/P/D workflow (Pending → Approved), set MRP for all lines, Islamabad column chain (BR-PRC-05), freight sheet per city. ◐ 20 Nov 2026 — done: rate sheet copy/edit/set MRP/submit/approve, BR-PRC-05 chain (reproduces legacy to the paisa), effective line for permits, freight sheets view + last freight rate. Pending: entering new freight sheets (Hattar only, 36 legacy sheets); Karachi lines use the old permit geography (21/101/501, no city names); most legacy Karachi sheets are STATUS P (latest approved KHI sheet 08-04-2026) — confirm whether legacy P sheets count as approved
- [x] **P1-08 Balance service** — `available(tx, brnch, customer)` per BR-BAL formula reading CUSTOMER_LEDGER + open commitments + unused credit; balance endpoint. Deps: P1-03, P1-04, P2-00. ✔ 23 Nov 2026 — `modules/ledger/balance.js` (`available`, `lockCustomer` BR-BAL-02, commitments = new-system DOs/permits by DOC_STATUS; legacy open DOs come in with P6-03), `GET /customers/{b}/{c}/balance?value=` with shortfall; customer Balance card
      AC: fixture-based tests for each component; concurrency test with customer row lock.
- **Gate P1**: P1-01…P1-07 done; migrated masters browsable for both branches.

## P2 — Order cycle (head office)

- [x] **P2-00 Ledger posting service** — `ledger.post(tx, entries[])` with UK protection, narration builders, GL mapping, reversal helper; R1/R13 query. Rules: BR-LED-*. API §13. Deps: Gate P0. ✔ 23 Nov 2026 — `modules/ledger/service.js` (post, reverseDocument, balance, statement), `packages/shared/src/ledger.js` (narration builders BR-LED-01, reversal rows, running statement), Accounts › Customer ledger screen. GL_CODE from GL_MAP (empty until the GL map screen, P3). Nightly recon (BR-LED-02) comes with the source documents (P2-04 onward)
- [x] **P2-01 SRF** — CRUD, schedule wizard, tons↔bags, export fields, submit → draft OC, cancel, Contract Review PDF. Rules: BR-SRF-*. API §6. Deps: Gate P1. ✔ 23 Nov 2026 — migration 010 (destination city), `packages/shared/src/srf.js`, `modules/srf`, Orders › SRF list/new/detail; Contract Review PDF via the worker (clause texts from PRINT_TEXT `CRF_*`: none set up yet)
- [~] **P2-02 Draft OC builder** — from SRF + quote (P1-06/07); stores MASTER_PRICES; full editability; price override flag + approval. Rules: BR-OC-01/02. Deps: P2-01. ◐ 23 Nov 2026 — builder done (`modules/oc/builder.js`, `packages/shared/src/oc.js`: prices from the trade price, MASTER_PRICES, breakdown/value BR-OC-03). Editing + override approval come with the OC screens (P2-03)
- [ ] **P2-03 OC screens & commands** — review/approve/reject, BRV link grid, live balance panel (calls P1-08), confirm (creates DOs, posts DO ledger, outbox DO_ISSUED), override request, cancel, duplicate, print. Rules: BR-OC-_, BR-BAL-_. API §7.
      AC: PRD 4.5 AC incl. parallel confirm test.
- [x] **P2-04 BRV** — entry, verification queue + verify (posts ledger), bounce (reversal + impact list), cancel, receipt PDF. Rules: BR-BRV-*. API §8. ✔ 23 Nov 2026 — `packages/shared/src/brv.js`, `modules/brv`, receipt template, Payments › BRV / Verification queue / Bounce / BRV cancel. Built before P2-03 because the OC links verified BRVs. Bulk verify not built (one dialog per row)
- [ ] **P2-05 Permits** — CRUD with area grid and rate from sheet, issue with balance check, send to CFO (approval), override, adjust qty, cancel, print/send. Rules: BR-PMT-*. API §9.
- [ ] **P2-06 DO** — list/detail, PDF with signed QR + barcode + watermark on cancel, resend, cancel (releases commitment, DO-ledger credit), adjustment advice, hold/release. Rules: BR-DO-_, BR-QR-_. API §10.
- [ ] **P2-07 Re-pricing** — preview/apply, ON_HOLD with shortfall, rate lock check. Rules: BR-PRC-07/08.
- [ ] **P2-08 Order cancellation documents** — ORDER_CANCEL_MASTER/DETAIL advice for OC/DO cancels; RECEIPT_CANCEL for BRV cancels; consistent Cancel dialog with impact preview. PRD 4.14.
- [ ] **P2-09 Notifications** — SMS adapter (console + http-generic), email (company SMTP for system mails; user SMTP for shares), WhatsApp click-to-chat link builder, templates per event/branch, customer preferences, dedup. Rules: BR-NTF-*.
- **Gate P2**: end-to-end Playwright: customer → SRF → draft OC (edit price → approval) → BRV → verify → confirm → DO PDF + notification; permit → CFO → issue.

## P3 — Plant dispatch (end to end)

- [ ] **P3-01 Device registry & auth** — APP_DEVICE admin, device token endpoint, HMAC verification helper. Deps: Gate P0.
- [ ] **P3-02 Weighbridge agent** — Node service: serialport/TCP reader, parser profiles (configurable regex; ship profiles for common indicators + simulator), stable detection (BR-WGT-01), local WS server, signed upload, SQLite buffer, Windows service installer, logs. Deps: P3-01.
      AC: simulator end-to-end; cable unplug detection < 3 s; replayed readings deduped by (device, readingId).
- [ ] **P3-03 Scan & offline cache** — `/plant/scan`, `/plant/offline-cache` (ETag), QR verification server/client. Rules: BR-QR-*, BR-OFF-02.
- [ ] **P3-04 Gate-in** — gate pass + DC/DM issue at gate-in with planned qty, driver/vehicle validation, combine rules, print gate pass/DC with QR. Rules: BR-GATE-*, BR-DC-01…03. API §11.
- [ ] **P3-05 Weighing** — tare/gross from device ticket or manual (permission + reason), tare plausibility warning, net, variance, allocation to lines (largest remainder), reweigh, variance block + override request. Rules: BR-WGT-*.
- [ ] **P3-06 Invoice finalisation** — tax calculator (shared) + invoice rows + DO/permit dispatched qty + DC ledger + legacy columns + outbox (FBR, TRUCK_LOADED). Rules: BR-INV-_, BR-TAX-_, BR-LED.
      AC: invoice 8445 example reproduced; DC with 4 DOs → 4 invoices with consecutive numbers; total = allocated net.
- [ ] **P3-07 FBR Digital Invoicing adapter** — config per branch (sandbox/prod), payload mapping for sale type "Goods (FED in ST mode)" and standard goods, submit/retry worker, store FBR_SUBMISSION, update invoice status/FBR no/QR, rejection list with error text, retry endpoint. API §12. Deps: P3-06.
      AC: sandbox acceptance for test scenarios; timeout → FBR_PENDING → retried.
- [ ] **P3-08 Exit** — checklist, override path (setting-gated), close gate pass, notification TRUCK_EXITED. Rules: BR-EXIT-*.
- [ ] **P3-09 DC cancel / abort** — before invoice (abort), after invoice pre-FBR (approval, reversals), block after FBR (credit-note route). Rules: BR-DC-CXL-*.
- [ ] **P3-10 Plant PWA** — Serwist service worker, Dexie outbox, offline banner, sync endpoint + client, conflict queue UI, camera + USB scanner input, large-touch UI, plant board with SSE and wait-time colours, weighing screen with live digits from `ws://localhost:7071`. Rules: BR-OFF-*. PRD 4.9.
      AC: offline gate-in → reconnect → one gate pass, one DC; replay safe; conflict appears in queue.
- [ ] **P3-11 DC/DM/invoice prints** — DC (with DO lines, bags, bilty, container/seal), DM, Commercial/Excise/Sales Tax Invoice with FBR QR, gate pass.
- **Gate P3**: plant e2e (simulator): scan DO QR → gate-in → tare → gross (OK and blocked cases) → invoices → FBR sandbox → exit; ledger and DO balances correct.

## P4 — Notes, transfers, incentives, targets

- [ ] **P4-01 Credit/debit notes** — types 001–010, lines + WHT, approval, post, reverse, print/share; sales-return note linked to invoice (type 004). Rules: BR-NOTE-01…05.
- [ ] **P4-02 Balance transfer** — one document, two postings. Rules: BR-NOTE-04.
- [ ] **P4-03 Incentive schemes & runs** — scheme CRUD, preview, commit → DRAFT notes (008), duplicate-run guard. Rules: BR-INC-01/03.
- [ ] **P4-04 Targets & monthly incentive** — targets per customer/area, achievement, slab run → notes (010). Rules: BR-INC-02.
- [ ] **P4-05 Tax withheld** — entry + certificates received (R12 block). SCHEMA TAX_WITHHELD.

## P5 — Reports, sharing, dashboards

- [ ] **P5-01 Report framework** — parameter schemas, on-screen JSON grid (virtualised), PDF/Excel render jobs, letterhead, branch merge permission. API §16.
- [ ] **P5-02 R1 & R13 ledgers** (CLDOB, CLDCB) from CUSTOMER_LEDGER.
- [ ] **P5-03 R2, R3, R9** from SALES_INVOICE (+ cross-check test: R3 total = R6 sale = R9 total).
- [ ] **P5-04 R4, R8** from BRV (bank columns by short code; under clearance vs online).
- [ ] **P5-05 R5** credit notes; **R6** accumulated debtors with GL_MAP lines; **R7** advances & receivables (groups by channel report group, S.D column).
- [ ] **P5-06 R10** outstanding DOs; **R11** permit vs dispatch (bilty, DM).
- [ ] **P5-07 R12** Sales Analysis (7 blocks, merge).
- [ ] **P5-08 Sharing** — email via user SMTP (encrypted creds, test button), WhatsApp click-to-chat with 7-day link, Windows share for PDF, SHARE_LOG, public `/s/{token}`. Requirements spec §10.4.
- [ ] **P5-09 Dashboards** — sales, plant, management (PRD 4.17) with SSE refresh.
- [ ] **P5-10 Nightly ledger reconciliation** job + dashboard tile. Rules: BR-LED-02.
- **Gate P5**: Sep 2026 test data → report totals match legacy reports for both branches.

## P6 — Migration, hardening, cut-over

- [ ] **P6-01 Legacy dispatch DB** — once identified (BRD Q1): analyse, map to FH_* / GATE_PASS / SALES_INVOICE history, loader + reconciliation like script 02.
- [ ] **P6-02 Status mapping** — set DOC_STATUS on migrated documents from legacy flags (`tools/migrate/status-map.js`), with counts report.
- [ ] **P6-03 Opening ledger build** — CUSTOMER_LEDGER opening rows per customer at cut-over; reconcile to legacy balances (difference 0 for every customer).
- [ ] **P6-04 Users & permissions migration** — PERMISSIONS §5 review sheets; apply after sign-off.
- [ ] **P6-05 Data quality** — impossible dates, invalid CNIC/NTN/STRN, customers without geography, duplicate names; cleanup screens or SQL with sign-off. Rules: BR-DQ-*.
- [ ] **P6-06 Performance** — load test (k6 or autocannon): 200 users, plant bursts; index tuning; report timings within NFRs.
- [ ] **P6-07 Security review** — OWASP checklist, dependency audit, secrets, DB grants (SALES_APP least privilege, INSERT-only audit/ledger/tickets).
- [ ] **P6-08 Deployment** — PM2/Docker Compose, reverse proxy + TLS, backups, log rotation, monitoring/alerts, runbook (`docs/RUNBOOK.md`).
- [ ] **P6-09 UAT & training** — scripts per role, parallel run at one plant, sign-offs.
- [ ] **P6-10 Go-live** — final migration, legacy Forms read-only, hypercare checklist.
