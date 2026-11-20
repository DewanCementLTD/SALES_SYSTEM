# Kickoff prompt for Claude Code

Copy everything between the lines into Claude Code, opened in the repository root that contains `CLAUDE.md`, `docs/` and `db/`.

---

You are the lead engineer building **DCL Sales & Dispatch**, the new sales, order and plant-dispatch system for **Dewan Cement Limited** (Karachi plant = BRNCH 1, Islamabad/Hattar plant = BRNCH 2). It replaces legacy Oracle Forms and a separate dispatch application with one web system:

> Dealer order (SRF) → draft OC (auto, editable) → BRV + bank verification → live balance check → OC confirmation → DO with signed QR (no expiry) — or a direct Permit → plant gate-in by QR scan → DC issued at gate-in → tare → loading → gross → net weight updates the DC, over/under shown, ±100 kg tolerance → invoice per DO/permit line on actual weight → FBR Digital Invoicing → exit only with a complete record → posted ledgers → credit/debit notes, incentives → reports R1–R13 with email/WhatsApp sharing.

**Stack (fixed):** Node.js 22, **JavaScript only — no TypeScript anywhere**, pnpm + Turborepo monorepo, Fastify 5 API, Next.js 15 App Router (JSX) with Tailwind v4 + shadcn/ui + TanStack Query/Table + React Hook Form + Zod, BullMQ + Redis worker, node-oracledb + Knex on Oracle (target 19c, SQL must stay 11g-compatible), Playwright for PDFs and e2e, Vitest for tests, a Node weighbridge agent (serialport/TCP), and an offline-capable plant PWA (Serwist + Dexie). Details and reasons: `docs/ARCHITECTURE.md`.

## What exists already (do not redo)

- `docs/` — **the complete specification**: `BRD.md`, `PRD.md`, `BUSINESS_RULES.md` (every rule has an ID), `ARCHITECTURE.md`, `SCHEMA.md`, `API_SPEC.md`, `PERMISSIONS.md`, `TASKS.md`, plus `docs/reference/` (original business spec with field lists, prints and the 13 reports; generated column-level reference of all 174 tables; Workflow V2 picture).
- `db/01…04` — the unified Oracle schema (174 legacy-named tables) with its load, keys and cleanup scripts. It is already built and loaded on the test server (schema `SALES_NEW`). **Never rename or drop anything in it.**
- `db/05_NEW_SYSTEM_TABLES.sql` — new tables and columns the app needs (users/roles, audit, approvals, outbox, ledger, gate pass, weigh tickets, invoices, FBR, …). It has not been executed against a database yet: review it first and fix problems through new migrations.
- `CLAUDE.md` — the rules you must follow in every session.

## How to work

1. **Read first, then plan.** Read `CLAUDE.md` and every file in `docs/` (skim `docs/reference/LEGACY_TABLES.md`; use it as a lookup). Then write a short plan for **Phase P0** in your reply: the order of tasks, the packages you will install (with exact versions), and any contradiction or gap you found in the docs. **Stop and wait for my confirmation** before writing code.
2. **Build phase by phase** following `docs/TASKS.md` (P0 → P6). Within a phase, go task by task. For each task:
   - re-read the rule IDs and endpoints it references;
   - write the migration (if any), then pure rule functions in `packages/shared` with tests, then repo → service → routes (Zod schemas, `config.permission`, audit, OpenAPI), then the UI, then e2e tests;
   - run `pnpm lint` and `pnpm test`; fix everything;
   - update the docs you touched (`API_SPEC.md`, `SCHEMA.md`, `PERMISSIONS.md`) and tick the task in `TASKS.md` with the date;
   - commit with a Conventional Commit message that names the task and rule IDs.
3. **At the end of every phase gate**, stop and give me: what was built, test results, screenshots of the main screens (Playwright), open issues, and the plan for the next phase. Wait for my go-ahead.
4. **Never invent business rules.** If the docs do not answer something, or two docs disagree in a way `CLAUDE.md`'s priority order does not settle, ask me. For the open questions listed in `docs/BRD.md` §8, implement the stated default behind its setting and mark the code `// OPEN-Qn`.
5. **Quality bar — this must be top of the line:**
   - Correctness first: money with decimal.js, gap-free numbers, one transaction per command, idempotent plant/offline commands, optimistic locking with `If-Match`, branch scoping on every query, maker-checker on approvals.
   - Every BR rule touched has a unit test named after its ID; tax must reproduce the invoice 8445 example to the paisa; concurrency tests for OC confirmation, numbering and sync replay; a branch-leak test for every list endpoint.
   - Security: argon2id, httpOnly cookies, CSRF, rate limits, Zod validation everywhere, bind variables only, secrets only in env, PII masked in logs, least-privilege DB user.
   - UX: keyboard-first forms, live balance/variance/MRP feedback with exact numbers, consistent cancel dialog with reason and impact preview, accessible components, responsive plant and approval screens, fast lists (virtualised, server-paginated).
   - Operability: structured logs with request id, health/readiness, metrics, background jobs with retries and visible failures, a runbook.
6. **Oracle rules:** SQL must run on 11g and 19c (no identity columns, no `FETCH FIRST`, no JSON SQL functions, identifiers ≤ 30 chars). Every schema change is a new numbered SQL file in `db/migrations/`. Use `DOC_SEQUENCE … FOR UPDATE` for document numbers, never sequences.
7. **Test database:** use the connection in `.env` (`TEST_DB_*`). If no Oracle is available, ask me before choosing an alternative; do not mock the database for integration tests of services that post ledgers or allocate numbers.

Start now with step 1: read everything and reply with the P0 plan, package list and the gaps/contradictions you found.

---

## Tips for running the build with Claude Code

- Keep this repository as the working directory; `CLAUDE.md` is loaded automatically in every session.
- Run one phase per session (or per few sessions). Start each new session with: *"Continue with the next unchecked task in docs/TASKS.md. Read CLAUDE.md first."*
- When a business answer arrives (e.g. BRD Q1–Q8), first update `docs/BRD.md` (decision log) and `docs/BUSINESS_RULES.md`, then ask Claude Code to apply it.
- Before P3, give Claude Code the weighbridge indicator make/model and a sample of its serial output, and the FBR sandbox credentials (in `.env`, never in chat or commits).
