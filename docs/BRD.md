# BRD — Business Requirements Document

**System:** DCL Sales & Dispatch (Dewan Cement Limited)
**Version:** 1.0 · 19 Nov 2026
**Owner:** IT Software Section, Head Office (Yousuf Dewan Companies)
**Status:** Approved baseline for build. Changes go through `docs/BRD.md` + a line in the Decision Log (section 9).

---

## 1. Purpose

Replace the legacy Oracle Forms sales screens and manual steps of Dewan Cement Limited (DCL) with **one web system** that runs the whole cycle for both units:

> Dealer order → payment → head-office authorisation (DO or Permit) → plant gate → weighbridge → Delivery Challan → invoice + FBR → exit → ledger → reports.

Today:
- Karachi and Islamabad/Hattar run **separate databases** (Karachi `SALES@LOCALSDB`, 245 tables; Islamabad `SCLSALES@ISB.WORLD`, 123 tables).
- Bank verification is done **by phone**, DO cancellation is written **by hand** on paper.
- Plant dispatch (gate, weighbridge, challan) runs in a **separate application** whose database is not in the sales DBs (challan tables in the sales DBs stop in 2024 / 2015).
- There is no posted customer ledger; balances are computed by reports.

## 2. Business objectives

| # | Objective | Measure of success |
|---|---|---|
| O1 | One system, one database for Karachi (BRNCH 1) and Islamabad/Hattar (BRNCH 2) | Both units live; legacy Forms switched off |
| O2 | No order is released without verified money or approved credit | 0 OCs/permits confirmed with insufficient available balance (except approved overrides) |
| O3 | No truck leaves the plant without a complete record | 100% of exits have DC + weights + invoice + FBR invoice number (or logged override) |
| O4 | Invoice on actual dispatched weight; weight differences visible | Every DC shows planned vs actual weight and variance (kg) |
| O5 | Paperless DO/Permit | DO/Permit delivered as PDF with QR; gate works by QR scan |
| O6 | Every change provable | Every create/update/cancel/approve/override in the audit log with old and new values |
| O7 | Faster, correct reporting | 13 reports (R1–R13) generated from posted data; customer statement shared by email/WhatsApp in < 1 minute |
| O8 | Plant keeps working when the network drops | Gate and weighbridge record offline and sync without duplicates |

## 3. Scope

### 3.1 In scope (all go-live)

1. **Masters**: company/branch, fiscal years, geography (Zone → Territory → Area/City), products (per branch and period), DO types, bag types/colours, channels, customer master (4 tabs + security + credit limits), banks, instruments, transporters, mode of transport, price codes / trade prices (DO clients), daily city rate sheets (permit clients), freight sheets, tax rates (sales tax, FED, WHT, CED), credit types, credit-note types, targets, incentive slabs, print texts, message templates, GL map, settings.
2. **Order cycle**: SRF → draft OC (auto, editable) → OC review/approval → BRV + bank verification → available-balance check → OC confirmation → DOs (one per schedule line). Permit route: permit → balance check → (CFO approval when sent) → issue.
3. **Digital DO and Permit**: PDF with signed QR code, sent to the dealer by WhatsApp/SMS link and email. **No expiry.**
4. **Plant dispatch end to end** (replaces the separate dispatch application): gate-in by QR scan with driver/vehicle capture → DC issued at gate-in → tare weight → loading → gross weight → net weight updates the DC → variance check → invoice (one per DO / permit line) → FBR Digital Invoicing → exit gate scan.
5. **Weighbridge integration** (serial/TCP indicator) with manual entry only by permission and reason.
6. **Offline-capable gate and weighbridge screens** with safe sync.
7. **Posted customer ledgers** (DO-based and DC-based) written in the same transaction as the business document.
8. **Notes and incentives**: credit notes (types 001–010), debit notes, balance transfers between customers, incentive schemes, monthly target incentives → credit notes.
9. **Cancellations**: SRF, OC, DO, Permit, BRV (cancel / bounce), DC, credit/debit note — always by status + reason, never delete.
10. **Re-pricing**: effective-dated rates, 14-day DO rate lock, OC/DO re-pricing screen with shortfall and ON_HOLD.
11. **Configurable approvals** (maker-checker) for OC, permit, customer, credit limit, rate change, price override, weight override, cancellations, notes; approve from mobile; notifications.
12. **Dealer notifications**: payment verified, DO/permit issued, truck loaded (weight + invoice no), truck exited.
13. **Dashboards**: pending orders, trucks inside plant with waiting time, today's dispatch vs target, outstanding, BRVs awaiting verification, FBR failures.
14. **Reports R1–R13** with PDF/Excel export and Email/WhatsApp sharing.
15. **Role-based access control** with branch scope (Karachi users see Karachi, Hattar users see Hattar, head office sees both).
16. **Data migration** from both legacy DBs (already loaded and reconciled with scripts 01–04) plus the legacy dispatch DB once identified.

### 3.2 Out of scope (later)

| Item | Note |
|---|---|
| Dealer self-service portal | Not selected for this release |
| Bank statement import / auto-match | Verification stays manual but recorded (who/when/how) |
| Truck/driver pre-registration by dealer | Not selected; gate captures driver details |
| WhatsApp Business (Cloud API) auto-sending of PDFs | Phase 1 uses click-to-chat + 7-day link (requirements spec 10.4) |
| Bulk month-end statements to many customers | Later |
| Sales return with stock re-entry | Credit note handles the money side; stock return later |

## 4. Stakeholders and users

| Role | Unit | Main needs |
|---|---|---|
| Marketing / Sales | HO, Karachi, Hattar | SRF, draft OC, customer onboarding |
| Sales / Finance | HO | Review/approve OC, create BRV, issue DO, raise permits |
| Finance | HO | Verify BRV with bank, confirm OC, notes, ledgers |
| CFO | HO | Approve higher permits, overrides above limits |
| Authorised customer approver | HO | Approve new customers and changes |
| Gate operator | Plant | Gate-in/exit by QR scan, driver capture |
| Weighbridge operator | Plant | Tare and gross weighing |
| Dispatch supervisor | Plant | DC, loading, variance overrides, DC cancel before exit |
| Plant manager | Plant | Plant dashboard, approvals for plant overrides |
| Management | HO | Dashboards, reports R6/R7/R12 |
| Auditor | HO | Read-only everything + audit log |
| System / branch admin | IT | Users, roles, settings, templates |
| Dealer / customer | External | Receives DO/permit PDF, notifications, statements |

## 5. Business process (target state)

Reference picture: `docs/reference/workflow-v2.png` (business Workflow V2). The target process below **supersedes** it where they differ (marked ★).

### 5.1 Dealer and payment
1. Dealer places order by phone / email / fax / WhatsApp; Sales records it as an **SRF**.
2. Dealer deposits payment; Sales/Finance records a **BRV**.
3. Finance **verifies** the BRV with the bank and records who, when and how. Only verified BRVs count toward balance.

### 5.2 Head office authorisation
- **DO route**: SRF → ★ system creates a **draft OC** automatically (price from trade price / price code; every field editable) → Sales/Finance review → link BRVs → ★ **live available-balance check** → OC confirmed → **one DO per schedule line**.
- **Permit route**: permit raised directly → ★ live balance check → user may send to CFO → permit issued.
- Insufficient balance → order stays **pending / ON_HOLD** with the shortfall shown.
- ★ DO and permit are issued as **PDF with a signed QR code**, sent to the dealer (WhatsApp link / SMS / email). **No expiry.**

### 5.3 Plant (Karachi or Hattar) ★ revised order
1. Truck arrives; **gate-in**: scan DO/permit QR (or search by number), capture driver CNIC, name, mobile, vehicle number, transporter, bilty number.
2. ★ **DC issued at gate-in** with planned quantity (bags × 50 kg, or bulker tons).
3. **Tare** weight (empty truck) from the weighbridge.
4. Loading.
5. **Gross** weight from the weighbridge → **net = gross − tare**.
6. ★ DC weight **updated with actual net weight**; system shows **over/under weight** against planned (kg and %).
7. ★ Variance within tolerance (**default ±100 kg**, configurable) → continue. Outside tolerance → **exit blocked** until a dispatch supervisor overrides with reason (or the truck is re-loaded and re-weighed).
8. **Invoice** finalised on actual net weight (one invoice per DO / permit line) and posted to the DC ledger.
9. ★ **FBR Digital Invoicing**: invoice submitted, FBR invoice number + QR stored and printed.
10. ★ **Exit gate**: scan DC/gate-pass QR; exit allowed only when DC final + invoice + FBR number exist (or logged override).
11. Dealer notified: truck loaded (weight, invoice no) and truck exited.

### 5.4 After dispatch
- Credit/debit notes, incentives, balance transfers post to the ledger.
- Reports and statements shared from screen.

## 6. Business requirements (summary; detail in PRD and BUSINESS_RULES)

| ID | Requirement | Priority |
|---|---|---|
| BR-01 | One database, both branches; every record carries BRNCH | Must |
| BR-02 | Customer must be approved and active before any SRF/permit | Must |
| BR-03 | SRF auto-creates a draft OC; all OC fields editable before confirmation; price deviations flagged and approvable | Must |
| BR-04 | OC confirmation and permit issue require available balance ≥ value (or approved override) | Must |
| BR-05 | Only verified BRVs count toward balance; verification records who/when/how | Must |
| BR-06 | DO/permit PDF with signed QR; no expiry; resend any time | Must |
| BR-07 | DC issued at gate-in; weights from weighbridge; net updates DC; variance shown; ±100 kg tolerance configurable | Must |
| BR-08 | Exit only with complete record (DC, invoice, FBR number) or logged override | Must |
| BR-09 | Invoice per DO / permit line on actual net weight; tax as per section 9.3 of requirements spec | Must |
| BR-10 | Gap-free numbering per branch, year, document type with .1/.2 suffix | Must |
| BR-11 | Posted DO-based and DC-based ledgers, written atomically with the document | Must |
| BR-12 | Never delete business data; cancel with reason; audit old/new values | Must |
| BR-13 | Configurable approval rules (maker-checker), mobile approval, notifications | Must |
| BR-14 | Offline gate/weighbridge with idempotent sync | Must |
| BR-15 | Credit/debit notes, transfers, incentives, targets | Must |
| BR-16 | Effective-dated rates, 14-day DO rate lock, re-pricing with shortfall | Must |
| BR-17 | RBAC with branch scope; action-level permissions incl. share/print/override | Must |
| BR-18 | Reports R1–R13, PDF/Excel, email/WhatsApp sharing with 7-day links | Must |
| BR-19 | Dashboards (orders, plant queue, dispatch vs target, outstanding, BRV queue, FBR failures) | Should |
| BR-20 | Dealer notifications at 4 milestones | Should |

## 7. Constraints and assumptions

- **Database**: Oracle. Target **19c** (current infrastructure); all SQL must stay **11g-compatible** (no identity columns, no `FETCH FIRST`, names ≤ 30 chars, no JSON SQL functions) because the unified schema was designed for 11g and some environments still run 11g.
- **Schema**: the unified schema in `db/01_DCL_SALES_TABLES.sql` (174 tables, Karachi names) is kept. New capabilities are **new tables / added columns** (`db/05_NEW_SYSTEM_TABLES.sql`), never renames.
- **Stack**: Node.js + Next.js, **JavaScript only (no TypeScript)**.
- **FBR**: Digital Invoicing (PRAL) API; sandbox first; sale type "Goods (FED in ST mode)" scenarios already explored.
- Legacy data loaded for test (masters full, transactions Sep 2026) with all reconciliations DIFF = 0.
- The legacy **dispatch/weighbridge database** is still to be identified; its migration is a dependency for go-live of history (not for building).
- Users work on Windows laptops (Chrome/Edge); plant gate may use tablets/phones; WhatsApp Desktop on laptops.

## 8. Open questions (must be closed before the related task ships)

| # | Question | Default used until answered |
|---|---|---|
| Q1 | Which application/DB holds current DCs, weights and gate data? | Build new; migrate later |
| Q2 | Invoice quantity basis: actual net weight or bags? | **Net weight** (setting `INVOICE_QTY_BASIS`) |
| Q3 | If FBR is down, may a truck exit with supervisor override? | **No** (`ALLOW_EXIT_WITHOUT_FBR = N`) |
| Q4 | Temporary token (truck arrives without DO/permit): allowed? | **Disabled** (`TEMP_TOKEN_ENABLED = N`) |
| Q5 | DC cancellation after FBR submission: credit note route confirmed? | Block cancel; require credit note (type 004) |
| Q6 | Tolerance per packing type (bags vs bulker) different? | Same ±100 kg both |
| Q7 | SMS gateway provider for dealer notifications | Provider adapter; console driver in dev |
| Q8 | Who approves price overrides below master price, and limit? | Sales manager role, any deviation |
| Q9 | ~~Karachi geography mapping~~ | **Closed 19 Nov 2026** — see decision log |
| Q10 | ~~FED and CED rates~~ | **Closed 19 Nov 2026**: rates come from PRODUCT_DESC_T (BR-TAX-02/03/10); `db/reports/FED_RATE_REVIEW.csv` lists 11 periods that differ from invoice history for Finance to look at |

## 9. Decision log

| Date | Decision |
|---|---|
| 15–22 Oct 2026 | Requirements spec decisions (one invoice per DO, CFO permit approval manual, incentives as credit notes, ledger sign: debit positive, Contract Review = SRF print, customer code from zone/territory/area/channel, .1/.2 suffix) |
| 18 Nov 2026 | Unified DB = 01 (Karachi names, BRNCH 1/2), keys after load (03), cleanup (04); test migration passed |
| 19 Nov 2026 | Adopted: draft OC from SRF (editable), live balance check, digital DO/permit with QR (**no expiry**, replaces 14-day validity), DC at gate-in with weight update and ±100 kg variance display, weighbridge integration, tolerance block + supervisor override, exit only with complete record, offline gate, end-to-end dispatch in new system, posted ledger, gap-free numbering, no-delete + audit, configurable approvals, dealer notifications, dashboards, effective-dated rates with 14-day rate lock, branch scope, notes/incentives/all cancellations, RBAC |
| 19 Nov 2026 | Not adopted now: dealer portal, bank statement auto-match, truck pre-registration |
| 19 Nov 2026 | Stack: Node.js (Fastify) + Next.js, JavaScript only; Oracle 19c target, 11g-compatible SQL |
| 19 Nov 2026 | Geography (Q9): **4 levels for both branches, named Zone → Territory → Area → City**, stored in one new table `GEO_HIERARCHY` (+ `LEGACY_MAP` old code → new code); legacy geography tables untouched. Karachi: MASTER_AREA → AREA (SD-1, KHI-1 …) → DISTRICT → CITY. Islamabad: Zone = copy of ISB zone, Territory = ISB zone, Area = ISB territory, City = ISB area. Karachi `ZONE_DESC` stays the customer's separate zone classification. |
| 19 Nov 2026 | Karachi customers are placed in the geography by the city they were invoiced to most often in legacy invoice history; customers without history are listed for Sales. |
| 19 Nov 2026 | FED/CED rates (Q10): derived per product and period from legacy invoice history (FED ÷ qty) and shown to Finance for approval before loading into SALES_TAX_FED / CED_SETUP. |
| 19 Nov 2026 | Credit: customers without a CREDIT_LIMITS row use CUSTOMER_INFO.CREDIT_LIMITE (BR-BAL-06). |
| 19 Nov 2026 | Legacy columns never filled in any legacy row are kept; where they have a meaning (e.g. PERMIT_MST_CITY.APPROVED, CASH_CHEQUE_RECEIPTS.CANCEL_STATS) the new app fills them going forward (list: docs/reference/COLUMN_USAGE.md). |
| 19 Nov 2026 | Build and test stay on the XE test server (host in `.env`) for now; history loads use the Sep-2026 window. |
| 19 Nov 2026 | Tax rates: FED per ton and sales tax % come from PRODUCT_DESC_T (CED, P_SALES_TAX_PER) of the effective product period; latest PERIOD# with DATE_FROM ≤ date wins (BR-TAX-02/03/10). SALES_TAX_FED, CED_SETUP and SALES_TAX are not used for invoices. |
| 19 Nov 2026 | Karachi customers without geography: Sales fills the 84 active since 2024 (`db/reports/KHI_ACTIVE_CUSTOMERS_WITHOUT_GEO.csv`), loaded as GEO_SOURCE = MANUAL; inactive ones are placed when they order again. |
