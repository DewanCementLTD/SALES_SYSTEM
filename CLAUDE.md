# CLAUDE.md — DCL Sales & Dispatch

You are building the **Sales & Dispatch system for Dewan Cement Limited** (Karachi = BRNCH 1, Islamabad/Hattar = BRNCH 2). Read this file fully at the start of every session.

## Read before coding

| Need | File |
|---|---|
| Why / scope / open questions / decision log | `docs/BRD.md` |
| Screens and acceptance criteria | `docs/PRD.md` |
| **Every business rule (by ID)** | `docs/BUSINESS_RULES.md` |
| Stack, layering, flows | `docs/ARCHITECTURE.md` |
| Tables, new columns, settings | `docs/SCHEMA.md`, `db/05_NEW_SYSTEM_TABLES.sql`, `docs/reference/LEGACY_TABLES.md` |
| Endpoints | `docs/API_SPEC.md` |
| Roles and permissions | `docs/PERMISSIONS.md` |
| What to do next | `docs/TASKS.md` |
| Original business spec (fields, prints, reports R1–R13) | `docs/reference/REQUIREMENTS_SPEC.md`, `docs/reference/workflow-v2.png` |

Priority when documents disagree: `BUSINESS_RULES.md` > `BRD.md` decision log > `PRD.md` > `API_SPEC.md` > `docs/reference/*`. If still unclear, **stop and ask**; do not invent business rules.

## Hard rules

1. **JavaScript only.** No `.ts`/`.tsx` files, no TypeScript dependencies in app code. ESM (`"type": "module"`). Document types with JSDoc; validate inputs with Zod.
2. **Oracle SQL must run on 11g and 19c**: no identity columns, no `FETCH FIRST/OFFSET` (use `ROWNUM` wrappers in `lib/oracle/paginate.js`), no JSON SQL functions, names ≤ 30 chars, no `LISTAGG … ON OVERFLOW`, no lateral joins.
3. **Never rename or drop legacy tables/columns.** Schema changes = new numbered file in `db/migrations/` (reviewable SQL) + update `docs/SCHEMA.md`.
4. **Always bind variables.** No string-built SQL with user input. Column/table names from allow-lists only.
5. **Every business table access is branch-scoped** (`BRNCH IN (:allowed)`). Every key includes BRNCH.
6. **One transaction per command**: number allocation (`DOC_SEQUENCE … FOR UPDATE`), document rows, `CUSTOMER_LEDGER`, `AUDIT_LOG`, `NOTIFICATION_OUTBOX` — all or nothing. Use `withTx()`.
7. **Never delete business rows.** Cancel = status + reason + audit. The app DB user has no DELETE grant.
8. **Document numbers never come from Oracle sequences** (gap-free rule BR-NUM). Sequences only for technical ids of new tables.
9. **Money/quantity math only with `decimal.js`** via `packages/shared/src/money.js`. Money travels as strings in JSON.
10. **Business rules live in `packages/shared` (pure functions) and API services.** Routes do HTTP only; repos do SQL only. Cite rule IDs in comments (`// BR-BAL-01`) and in test names.
11. **Every endpoint**: Zod schema (body, params, query, response), `config.permission`, audit, OpenAPI. Update `docs/API_SPEC.md` in the same change.
12. **State changes only through command endpoints** that check the state machine (BUSINESS_RULES §12).
13. **No secrets in code or logs.** `.env.example` documents every variable. Redact `password`, `token`, `secret`, `cnic` (mask middle digits) in logs.
14. Do not add a dependency without a one-line reason in the PR/commit body; prefer the libraries listed in ARCHITECTURE §2.

## Commands

```bash
pnpm i                      # install
pnpm dev                    # api + worker + web + fake weighbridge (turbo)
pnpm lint && pnpm format:check
pnpm test                   # vitest (unit + integration against TEST_DB_*)
pnpm test:e2e               # playwright
pnpm db:migrate             # apply db/migrations/*.sql in order, record SCHEMA_VERSION
pnpm db:seed                # roles, permissions, settings, approval rules, templates, print texts
pnpm gen:legacy-docs        # regenerate docs/reference/LEGACY_TABLES.md from db/01 + db/03
pnpm --filter api openapi   # write openapi.json
```

## Code style

- Prettier defaults (2 spaces, single quotes, semicolons, width 100). ESLint must pass with zero warnings.
- Files: `kebab-case.js`; React components `PascalCase.jsx`; one module folder per domain (`apps/api/src/modules/<module>/{routes,service,repo,mapper,schemas}.js` + tests next to them).
- Errors: throw `AppError(code, httpStatus, detail, { ruleId, data })` from `lib/errors.js`; never `throw new Error('…')` for business failures.
- Dates: `date-fns` with `Asia/Karachi`; never `new Date()` in business logic — inject `clock` (testable).
- React: server components for read pages, client components for forms; TanStack Query keys in `src/lib/query-keys.js`; forms with React Hook Form + shared Zod schema; shadcn/ui components only (no other UI kit).
- Accessibility: labels for every input, keyboard paths for every action, focus visible.

## Testing rules

- Each BR-* rule touched → unit test named `BR-XXX-NN: <behaviour>`.
- Tax calculator must reproduce the invoice 8445 example to the paisa (BUSINESS_RULES §7).
- Concurrency tests for: OC confirm on same customer, DOC_SEQUENCE allocation, plant sync replay.
- Branch-leak test for every list endpoint.
- Do not mark a task done in `docs/TASKS.md` until its acceptance criteria tests pass.

## Workflow for each task

1. Pick the next unchecked task in `docs/TASKS.md` (respect phase order and dependencies).
2. Re-read the rules/endpoints it references.
3. Write/adjust migration (if any) → shared rules + tests → repo → service + tests → routes + schemas → UI → e2e.
4. Run lint + tests. Update docs touched (API_SPEC, SCHEMA, PERMISSIONS, TASKS checkbox + date).
5. Commit with Conventional Commits (`feat(oc): confirm with balance check (BR-OC-06)`).

## Domain glossary

SRF = Sales Request Form · OC = Order Confirmation · BRV = Bank Receipt Voucher · DO = Delivery Order · Permit = City-wise permit (direct, no SRF/OC) · DC = Delivery Challan (DO route) · DM = Delivery Memo (permit route) · GP = gate pass (truck visit) · FED = Federal Excise Duty · ST = sales tax · WHT = withholding tax · MRP = maximum retail price · Bilty = transporter consignment note · BRNCH 1/2 = Karachi/Hattar · `.1`/`.2` = document number suffix.

## Open questions (do not decide silently)

See `docs/BRD.md` §8 (Q1–Q8). Implement the default stated there behind the named setting, and leave a `// OPEN-Qn` comment.
