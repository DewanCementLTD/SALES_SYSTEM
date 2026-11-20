# PRD — Product Requirements Document

**Product:** DCL Sales & Dispatch · **Version:** 1.0 · 19 Nov 2026
Read with: `BRD.md` (why/scope), `BUSINESS_RULES.md` (rules by ID), `PERMISSIONS.md` (who), `API_SPEC.md` (how), `SCHEMA.md` (where data lives).
Field-level detail of every legacy screen and the 13 reports: `docs/reference/REQUIREMENTS_SPEC.md` (exported business spec, sections 1–15).

---

## 1. Product principles

1. **One screen per job, keyboard first.** Sales and Finance staff enter hundreds of documents a day: every form is fully usable by keyboard (Tab order, Enter to save, F-keys for common actions, `/` to search).
2. **The system checks, the user decides.** Balance, tolerance, MRP and duplicates are checked live and explained in plain words with the number ("Short by PKR 1,240,500"); overrides go through approval, never silently.
3. **Every number is traceable.** Clicking any balance, ledger line or report figure opens the document behind it.
4. **Never lose work.** Drafts autosave; plant screens work offline.
5. **Same rules everywhere.** Tax/balance/weight logic lives once in `packages/shared` and the API; the UI only previews.

## 2. Users and devices

| Persona                         | Device                              | Key screens                                              |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| Sales officer (Marketing/Sales) | Laptop, Chrome/Edge                 | Customers, SRF, OC, permits, re-pricing                  |
| Finance officer                 | Laptop                              | BRV, verification queue, OC confirmation, notes, ledgers |
| CFO / managers                  | Laptop + phone                      | Approvals inbox, dashboards, reports                     |
| Gate operator                   | Tablet/phone or PC + USB QR scanner | Gate-in, exit                                            |
| Weighbridge operator            | PC beside indicator                 | Weighing (tare/gross)                                    |
| Dispatch supervisor             | PC/tablet                           | Plant queue, DC, overrides, cancel                       |
| Admin                           | Laptop                              | Users, roles, settings, templates, masters               |

Responsive: all screens ≥ 1280 px laptop; plant and approval screens also ≥ 360 px phone.

## 3. Information architecture (navigation)

```
Home (role dashboard)
Orders        SRF · OC · Re-pricing · Order cancellation
Payments      BRV · Verification queue · Bounce · BRV cancel
Permits       Permits · Adjust qty · CFO queue
Delivery      DOs · Outstanding DOs · DO adjustment
Plant         Plant queue · Gate-in · Weighing · DC · Exit · Offline sync
Accounts      Customer ledger (DO / DC) · Credit/Debit notes · Transfers · Incentive runs · Targets
Customers     Customers · Approval requests · Credit limits · Security · Blocks
Masters       Geography · Products & periods · DO types · Bags · Channels · Banks · Instruments · Transporters
              Trade prices · City rate sheets · Freight sheets · Tax rates · Credit types · Note types
Reports       R1–R13 · Share log
Approvals     My inbox · Sent by me · Rules (admin)
Admin         Users · Roles · Branch access · Settings · Print texts · Message templates · GL map · Devices · Audit log
```

Top bar: branch switcher (only allowed branches), fiscal year, global search (customer / document number / vehicle no), notifications bell, approvals badge.

## 4. Functional requirements by module

Each requirement lists the rule IDs it implements. "AC" = acceptance criteria (must be covered by tests).

### 4.1 Authentication & session (P0)

- FR-AUTH-1 Login with user id + password; choose branch and fiscal year (only allowed ones). Lockout after `LOGIN_MAX_FAILS` [5] for `LOGIN_LOCK_MIN` [15] min. Password policy (min 10, expiry `PWD_LIFE_DAYS` [90], last 5 not reused). Allowed time window and allowed devices per user (legacy SEC_USERNAME rules) supported as optional settings.
- FR-AUTH-2 Migrated users must set a new password on first login (legacy hashes are not trusted).
- FR-AUTH-3 Optional TOTP 2FA for CFO/admin roles.
- AC: wrong password ×5 locks; switching branch changes all data shown; JWT expiry 15 min with silent refresh; logout revokes refresh token.

### 4.2 Customers (P1) — BR-CUS-*

- Tabs: Information · Sales tax · Credit limits · Group/link · Security · Areas · Contacts.
- Create → PENDING_APPROVAL → approver approves (maker ≠ checker). Edits to tax/credit/contacts on an approved customer create a change request (diff shown to approver).
- Customer code generator (BR-CUS-03) with preview.
- Customer 360 side panel: balance (BR-BAL breakdown), open OCs/DOs/permits, last 10 ledger lines, blocks.
- AC: cannot raise SRF for unapproved/blocked/closed customer; approval diff shows old vs new.

### 4.3 Masters & pricing (P1) — BR-PRC-*

- CRUD with deactivate (no delete) for all masters listed in IA.
- Products per branch and period (`PRODUCT_DESC_T`): MRP, retail, company price, FED, ST, HS code, pack type (bag/bulk), product group/type.
- Trade price (DO clients) and city rate sheets (permit clients) with effective date; rate sheet workflow Pending → Approved; "update MRP for all lines"; import from Excel with validation preview.
- Rate change = new row; history timeline per price code.
- AC: retail > MRP blocked; overlapping effective ranges blocked; history never edited.

### 4.4 SRF (P2) — BR-SRF-*

- Form per spec 5 with schedule wizard (split qty over dates). Tons ↔ bags auto-convert.
- Submit → draft OC created and opened (toast with link).
- Print Contract Review Form (PDF), share.
- AC: schedule total = qty; export fields required only for Export; submit creates exactly one OC.

### 4.5 OC (P2) — BR-OC-_, BR-BAL-_

- Opens prefilled from SRF; every field editable while DRAFT/REVIEWED; price fields show master value as hint and a yellow "override" badge when changed.
- Price breakdown panel computed live via shared calculator.
- BRV link grid (search verified BRVs of the customer with unapplied amount).
- **Balance panel**: available balance with breakdown, OC value, shortfall in red; "Request override" button when short.
- Actions: Review, Approve, Reject (reason), Confirm (creates DOs), Cancel (reason), Duplicate, Print.
- AC: confirm impossible when short without approved override; concurrent confirmations on the same customer cannot overspend (test with two parallel requests).

### 4.6 BRV & verification (P2) — BR-BRV-*

- BRV entry per spec 6.3 with instrument/category per branch.
- **Verification queue** (Finance): filter by bank/date/amount; verify dialog (method, bank ref, remarks); bulk verify with per-row confirmation.
- Bounce flow with reason → ledger reversal + impact list (OCs/DOs affected).
- AC: unverified BRV invisible to balance; maker cannot verify own BRV; bounce posts debit in both ledgers.

### 4.7 Permit (P2) — BR-PMT-*

- Header + area grid (zone/territory/area pickers, qty, city rate auto from sheet, amount, dispatched, balance).
- Balance panel as OC. Actions: Save draft, Issue, Send to CFO, Adjust qty (reason), Cancel, Print, Share.
- AC: no expiry fields required; adjust qty audited; dispatch > area qty blocked beyond tolerance.

### 4.8 DO (P2) — BR-DO-_, BR-QR-_

- List with status chips; detail with dispatch history; PDF with QR + barcode; resend to dealer; cancel; adjustment advice.
- Outstanding DO view (R10 live).
- **Re-pricing screen**: select price code/product/region + new effective rate → list open DOs past rate lock with old rate, new rate, shortfall; actions: hold, collect (link BRV), cancel.
- AC: cancelled DO PDF shows watermark; QR of a cancelled/held DO is rejected at gate.

### 4.9 Plant (P3) — BR-GATE-_, BR-WGT-_, BR-DC-_, BR-INV-_, BR-EXIT-_, BR-OFF-_

- **Plant queue board** (supervisor): columns IN · TARE · LOADING · GROSS · BLOCKED · READY TO EXIT · EXITED today; card shows vehicle, customer, DOs, waiting minutes (amber > 60, red > 120).
- **Gate-in**: camera/USB scan → document card (customer, product, remaining qty, holds) → add more DOs (same customer/type/destination) → driver/vehicle form → Issue DC → print gate pass/DC with QR.
- **Weighing**: select vehicle (scan gate pass QR) → live weight from agent (big digits, STABLE indicator) → Capture tare / Capture gross → net, planned, variance (OVER/UNDER kg and %) colour-coded; manual entry dialog only with permission + reason.
- **Variance blocked**: options Re-weigh / Request override.
- **Invoice finalisation**: automatic after gross OK; shows invoices per line with tax, FBR status chip (Pending/Accepted/Rejected + retry).
- **Exit**: scan gate-pass QR → checklist (DC ✓ weights ✓ invoices ✓ FBR ✓) → Allow exit.
- **Offline**: banner "Offline — N events queued"; sync screen with conflicts list.
- AC: full happy path in < 90 s of operator time; offline gate-in with valid QR works and syncs once; replaying the same event does not duplicate; exit blocked when FBR missing.

### 4.10 Weighbridge agent (P3)

- Windows service on the weighbridge PC; config: port (COM/TCP), baud, frame parser profile (regex), stable rule; exposes local WebSocket for the weighing screen; signs and forwards readings to the API; buffers when offline.
- AC: simulator mode for dev/test; unplugging the cable shows "Device offline" within 3 s.

### 4.11 FBR Digital Invoicing (P3) — BR-INV-02

- Adapter with sandbox/production config per branch (POS/registration, token).
- Submit on invoice finalisation; store request, response, FBR invoice number, QR data; retry queue; rejected invoices listed with FBR error text for correction.
- AC: sandbox scenario "Goods (FED in ST mode)" passes; a timeout puts invoice in FBR_PENDING and retries.

### 4.12 Ledgers (P3) — BR-LED-*

- Customer ledger screen (DO / DC tabs): opening, lines, running balance, closing; drill-down; print/share (R1/R13).
- Nightly reconciliation result tile.
- AC: ledger equals recomputation from documents for the migrated test data.

### 4.13 Notes, transfers, incentives, targets (P4) — BR-NOTE-_, BR-INC-_

- Credit/debit note form (type, lines, WHT), approval, post, reverse.
- Balance transfer form (from customer, to customer, amount, particular).
- Incentive run wizard: scheme → period → preview per customer (qty, rate, amount) → commit creates DRAFT notes → approvals.
- Targets: monthly target entry per customer/area; achievement view; slab run.
- AC: double commit of a period blocked; transfer posts both sides atomically.

### 4.14 Cancellations (P2–P3)

- One consistent "Cancel" dialog everywhere: reason (required, min 10 chars), impact preview (what returns to balance, what gets reversed), approval notice if a rule applies.

### 4.15 Approvals (P0 engine, used from P1)

- Inbox (mobile friendly): card with document summary, diff/snapshot, amount, requester, age; Approve / Reject with comment; bulk approve for same type.
- Rules admin: per doc type, branch, conditions, levels, roles.
- AC: approver cannot approve own request; multi-level approves in order.

### 4.16 Notifications (P2)

- Dealer: SMS / WhatsApp link / email by customer preference; templates per event and branch (English).
- In-app bell for staff; email for approvals.
- AC: outbox retries; failures visible; no duplicate SMS for one event.

### 4.17 Dashboards (P5)

- Sales: pending SRF/OC (by age), OCs short of balance (total shortfall), BRVs awaiting verification (count/amount), permits pending CFO.
- Plant: trucks inside by stage with wait time, today's dispatch tons vs target, variance overrides today, FBR pending/rejected.
- Management: dispatch MTD vs target by product/zone, collection MTD, outstanding receivables/advances, top customers.
- Auto-refresh 30 s (SSE).

### 4.18 Reports (P5) — R1–R13

- As requirements spec 10.2 (columns, filters, groupings, totals). Each: run on screen (virtualised table), PDF (letterhead, run time, "system generated"), Excel, Email, WhatsApp (link), Share log.
- Cross-checks as tests: R3 grand total = R6 "Sale during the period" = R9 total for the same period/branch.

### 4.19 Admin (P0–P1)

- Users (create, lock/unlock, reset password, branches, roles), roles & permissions matrix editor, settings per branch, print texts, message templates, GL map, devices (weighbridge agents, gate tablets with device keys), audit log viewer (filters, diff view).

## 5. Non-functional requirements

| Area          | Requirement                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance   | p95 API < 300 ms for document reads/writes; list pages < 1 s for 50 rows; reports < 10 s on screen for one month/branch, PDF via background job                                                                                                                      |
| Capacity      | 5 GB legacy + ~1,000 documents/day/branch; 200 concurrent users                                                                                                                                                                                                      |
| Availability  | 99.5% business hours; plant offline mode covers outages                                                                                                                                                                                                              |
| Security      | OWASP ASVS L2 basics: hashed passwords (argon2id), httpOnly secure cookies, CSRF protection, rate limiting, input validation (Zod) on every endpoint, parameterised SQL only, secrets in env/vault, AES-256-GCM for stored SMTP/FBR secrets, least-privilege DB user |
| Audit         | 100% of state changes audited (BR-AUD)                                                                                                                                                                                                                               |
| Accessibility | WCAG 2.1 AA for forms (labels, focus, contrast)                                                                                                                                                                                                                      |
| Browser       | Latest Chrome/Edge; plant PWA on Android Chrome                                                                                                                                                                                                                      |
| Localisation  | English UI; PKR formatting `1,234,567.00`; dates `DD-MM-YYYY`; time zone Asia/Karachi                                                                                                                                                                                |
| Observability | Structured logs (pino) with request id; metrics (Prometheus); health/readiness endpoints; error tracking                                                                                                                                                             |
| Backups       | DB backup per DBA policy; app is stateless except Redis (queues, rebuildable)                                                                                                                                                                                        |
| Testing       | Unit (rules), integration (API + Oracle in Docker), e2e (Playwright) for happy paths and the AC above; coverage ≥ 80% on `packages/shared` and services                                                                                                              |

## 6. Release plan

| Release                 | Contents                                                                                       | Exit criteria                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R0 Foundation           | Repo, CI, auth, RBAC, branch scope, audit, numbering, settings, approvals engine, 05 migration | Login/branch switch works; audit + numbering tests green |
| R1 Masters              | Customers + all masters + pricing                                                              | Masters migrated data browsable; customer approval works |
| R2 Order cycle          | SRF, OC, BRV/verification, balance, permits, DOs, QR/PDF, cancellations, notifications         | End-to-end HO flow on test data                          |
| R3 Plant                | Gate, weighbridge agent, DC, variance, invoice, ledger, FBR sandbox, exit, offline             | Pilot at one plant (parallel run)                        |
| R4 Accounts             | Notes, transfers, incentives, targets                                                          | Finance sign-off                                         |
| R5 Reports & dashboards | R1–R13, sharing, dashboards                                                                    | Report totals match legacy for Sep 2026                  |
| R6 Cut-over             | Final migration (incl. dispatch DB), training, go-live both plants                             | Reconciliation DIFF = 0; legacy Forms read-only          |
