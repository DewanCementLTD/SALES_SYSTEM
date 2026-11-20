# BUSINESS_RULES.md

Every rule has an ID. Code that enforces a rule cites the ID in a comment (`// BR-OC-03`) and has a test named after it. When a rule changes, change it here first.

Settings referenced as `SETTING_NAME` live in `APP_SETTING` (per branch, with company default). Defaults are given in brackets.

---

## 0. Conventions

| Item           | Rule                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch         | `BRNCH` 1 = Karachi (suffix `.1`), 2 = Islamabad/Hattar (suffix `.2`). Every query is filtered by the user's allowed branches.                                       |
| Company        | `COMPC` = 1 (DCL).                                                                                                                                                   |
| Money          | PKR, stored `NUMBER(14,2)`; computed with a decimal library (no JS floating point); rounding **half-up to 2 decimals** at line level, totals = sum of rounded lines. |
| Quantity       | Tons `NUMBER(10,3)` in new columns (legacy `NUMBER(8,2)` kept); 1 bag = 50 kg; 20 bags = 1 ton.                                                                      |
| Weight         | Kilograms, integers, from the weighbridge.                                                                                                                           |
| Dates          | Stored as Oracle `DATE` (date + time, server time zone Asia/Karachi). Business date = date part.                                                                     |
| Sign of ledger | Running balance = previous + debit − credit. **Positive = receivable (customer owes). Negative = advance**, shown in brackets.                                       |
| Status changes | Only through service methods that check the state machine (section 12).                                                                                              |
| Delete         | **Never** physically delete business data. Cancel with reason. Masters are deactivated (`ACTIVE = 'N'`).                                                             |

---

## 1. Customers (BR-CUS)

| ID        | Rule                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-CUS-01 | A customer must be **APPROVED and ACTIVE** before any SRF, OC, permit or DO is raised. Closed customers (`CLOSED = 'Y'`) cannot trade.                                                                   |
| BR-CUS-02 | Only users with `customer.approve` can approve a new customer or approve changes to tax profile, credit limit or contact numbers (maker-checker: approver ≠ maker).                                      |
| BR-CUS-03 | New customer code = Zone code + Territory code + City/Area code + Channel code + sequence (both branches). Legacy codes stay unchanged; `LEGACY_MAP` records old → new where re-coded.                   |
| BR-CUS-04 | Customer carries: sales tax type (Registered / Un-registered / Exempt / Consumer) + status, STRN, income tax type, filer status, NTN, CNIC, jurisdiction. These drive invoice tax (section 7).           |
| BR-CUS-05 | Contacts: email 1, email 2, WhatsApp number (stored as `92XXXXXXXXXX`), mobile. Validated on save.                                                                                                       |
| BR-CUS-06 | Security deposits: lines (description, amount); total shown in R7 as S.D.                                                                                                                                |
| BR-CUS-07 | Credit limits per credit type A–J: initial limit, current limit, availed. Changes only through an approved Credit Limit document.                                                                        |
| BR-CUS-08 | Block/unblock is history (`BLOCK_CUSTOMER`); current status = latest row. Blocked customers cannot get new OC/permit/DO; dispatch against existing DOs is allowed unless the block says "stop dispatch". |

## 2. Pricing (BR-PRC)

| ID        | Rule                                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-PRC-01 | Every rate is **effective-dated**. A change is a **new row** with `EF_DATE`; old rows are never updated.                                                                                                                                                        |
| BR-PRC-02 | DO clients: price from `TRADE_PRICE` (customer + area/city + product, effective date). Permit clients: price from the approved daily city rate sheet (`AREA_RATES_M/P/D`) for the permit date.                                                                  |
| BR-PRC-03 | Retail price may be **below** the government MRP, **never above** (hard block).                                                                                                                                                                                 |
| BR-PRC-04 | Rates vary by branch, region/city, product, quantity type (bags/bulker) and customer.                                                                                                                                                                           |
| BR-PRC-05 | Islamabad rate sheet columns: booking price → − freight = net booking → − rebate = ex-factory → − tax 236 − FED − sales tax = net retention. Karachi prices are ex-factory, tax-inclusive; freight optional.                                                    |
| BR-PRC-06 | Rate changes (trade price, rate sheet, tax rates) need approval per approval rules (`RATE_CHANGE`).                                                                                                                                                             |
| BR-PRC-07 | **DO rate lock**: a DO keeps its OC rate for `DO_RATE_LOCK_DAYS` [14] days from DO issue. Dispatch after that uses the rate effective on the dispatch date.                                                                                                     |
| BR-PRC-08 | If a later rate makes an open DO's undispatched value exceed the customer's available balance, the DO goes **ON_HOLD** with the shortfall; Sales collects the difference (BRV) or cancels the DO. Re-pricing screen shows old rate, new rate, shortfall per DO. |
| BR-PRC-09 | Permits are **not** re-priced automatically; the user re-prices manually (logged).                                                                                                                                                                              |

## 3. SRF (BR-SRF)

| ID        | Rule                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| BR-SRF-01 | SRF fields as requirements spec section 5; quantity in tons and bags (20 bags = 1 ton), converted both ways.                |
| BR-SRF-02 | Schedule grid total must equal SRF quantity.                                                                                |
| BR-SRF-03 | Export references (P.I. no, Form-E, L.C. no) required only when Local/Export = Export.                                      |
| BR-SRF-04 | Tax fields default from customer master, editable on the SRF.                                                               |
| BR-SRF-05 | **On SRF submit the system creates a draft OC automatically** (BR-OC-01). One SRF → one OC.                                 |
| BR-SRF-06 | SRF can be cancelled while its OC is not confirmed; cancelling the SRF cancels the draft OC.                                |
| BR-SRF-07 | Contract Review Form = print of the SRF; validity = SRF date + `CONTRACT_VALID_MONTHS` [3]; clause texts from `PRINT_TEXT`. |

## 4. Order Confirmation (BR-OC)

| ID       | Rule                                                                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-OC-01 | Draft OC is built from the SRF: customer, product, quantity, schedule, tax profile, price code, and **prices pulled from the effective trade price / rate**.                                                                                                                  |
| BR-OC-02 | **Every OC field is editable while DRAFT or REVIEWED** (quantity, schedule, prices, discounts, expenses, remarks). Each edited price field stores the master value beside it; any deviation is flagged `PRICE_OVERRIDE = 'Y'` and triggers approval rule `OC_PRICE_OVERRIDE`. |
| BR-OC-03 | OC value = net price per ton × quantity (tons). Price breakdown: retail price, trade discount, trade-discount price, sales tax, CED/FED, consumer price, expenses, discount, net price, total net value.                                                                      |
| BR-OC-04 | Sales/Finance review: approve, reject (back to DRAFT with reason) or edit.                                                                                                                                                                                                    |
| BR-OC-05 | BRVs are linked to the OC with an applied amount (`ORDER_CONFIRM_BRV`). Only **verified** BRVs can be linked for confirmation. One BRV can fund several OCs; one OC can be funded by several BRVs; applied total of a BRV ≤ its amount.                                       |
| BR-OC-06 | **Confirmation check**: `available balance ≥ OC value` (section 6). If not, show shortfall; OC stays APPROVED (pending money) or goes to approval rule `OC_BALANCE_OVERRIDE` if the user requests an override.                                                                |
| BR-OC-07 | On confirmation the system creates **one DO per schedule line** in the same transaction and records the commitment.                                                                                                                                                           |
| BR-OC-08 | OC cancel: allowed while no DO of it has dispatch; confirmed OC cancel cancels its undispatched DOs (each releases its commitment). Reason required.                                                                                                                          |
| BR-OC-09 | Duplicate OC creates a new DRAFT from an existing OC (new number).                                                                                                                                                                                                            |

## 5. BRV — Bank Receipt Voucher (BR-BRV)

| ID        | Rule                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-BRV-01 | Fields as requirements spec 6.3; instrument codes are per branch (Karachi N/E/O…, Islamabad A–J); category: Clean, Transitory, Cash deposit, Cheque.                                                                |
| BR-BRV-02 | Status: ENTERED → VERIFIED → (CLEARED) ; ENTERED → CANCELLED ; VERIFIED → BOUNCED.                                                                                                                                  |
| BR-BRV-03 | **Verification** by `brv.verify` only, records verified_by, verified_at, method (PHONE / BANK_PORTAL / STATEMENT / OTHER), bank reference, remarks. Maker ≠ verifier.                                               |
| BR-BRV-04 | Ledger: posting happens **at verification** (credit in both DO and DC ledgers). Unverified BRVs never affect balance.                                                                                               |
| BR-BRV-05 | Bounce: reverses the credit (debit "Cheque return" in both ledgers); linked OCs that are not yet confirmed lose the link; already-confirmed OCs/DOs are flagged and go through BR-PRC-08 style shortfall → ON_HOLD. |
| BR-BRV-06 | Cancel allowed only while ENTERED (before verification), with reason. After verification use bounce or a debit note.                                                                                                |
| BR-BRV-07 | Invoice knock-off grid (invoice #, DC #, qty, amount) is informational for reports; balance is ledger-based.                                                                                                        |

## 6. Available balance (BR-BAL)

```
Available balance (customer, branch) =
      − DC_LEDGER_BALANCE                       (advance is negative balance → becomes positive here)
      − OPEN_COMMITMENTS
      + UNUSED_APPROVED_CREDIT

OPEN_COMMITMENTS = Σ undispatched value of CONFIRMED OCs' open DOs (qty_ton − dispatched_ton) × DO rate
                 + Σ undispatched value of ISSUED permits' areas (qty − dispatched) × city rate
UNUSED_APPROVED_CREDIT = Σ over credit types (current limit − availed), only approved, effective limits
```

| ID        | Rule                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-BAL-01 | The formula above is the **only** balance used for OC confirmation, permit issue and DO re-pricing checks. Implemented once (`BalanceService`), unit-tested with fixtures.                                                                                         |
| BR-BAL-02 | Balance check and the document save happen in **one DB transaction** with the customer row locked (`SELECT … FOR UPDATE` on `CUSTOMER_INFO`) so two users cannot spend the same money.                                                                             |
| BR-BAL-03 | Shortfall = value − available balance (shown when > 0).                                                                                                                                                                                                            |
| BR-BAL-06 | A customer with **no `CREDIT_LIMITS` row** uses `CUSTOMER_INFO.CREDIT_LIMITE` as its total approved credit (one bucket, availed = open commitments on credit). Needed because Karachi has CREDIT_LIMITS rows for only 32 of 4,746 customers. Decision 19 Nov 2026. |
| BR-BAL-04 | Override (`OC_BALANCE_OVERRIDE`, `PERMIT_BALANCE_OVERRIDE`) needs approval per approval rules; the approved override is stored with amount and approver.                                                                                                           |
| BR-BAL-05 | Balance screen shows: DC ledger balance, open commitments (by document), unused credit by type, today's verified collection (cash/cheque/online).                                                                                                                  |

## 7. Tax and invoice computation (BR-TAX)

Worked example (requirements spec 9.3, invoice 8445, 35 t OPC, price code SKYOP2) must pass as a unit test to the paisa.

| ID        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-TAX-01 | Prices are **tax-inclusive**; the invoice works backwards.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| BR-TAX-02 | **Sales tax = ST% × retail price value** (not × customer value). Retail value = tax-exclusive retail value + FED. ST% = `PRODUCT_DESC_T.P_SALES_TAX_PER` of the product's effective period (BR-TAX-10) [18%]. (`SALES_TAX` holds 17 % since 2000 and is not used for invoices; decision 19 Nov 2026.)                                                                                                                                                                                      |
| BR-TAX-03 | **FED = FED per ton × qty**; FED per ton = `PRODUCT_DESC_T.CED` of the product's effective period (BR-TAX-10) [4,000/ton]. This is where the legacy system keeps FED and it matches legacy invoice history; `SALES_TAX_FED` and `CED_SETUP` are empty in both legacy DBs and are not used (decision 19 Nov 2026).                                                                                                                                                                          |
| BR-TAX-10 | **Effective product period** for (branch, product, date): among `PRODUCT_DESC_T` rows with `DATE_FROM <= date`, the one with the **highest `PERIOD#`** applies, open-ended until a higher period starts. `DATE_TO` is not used to end a period, because legacy has periods with DATE_TO before DATE_FROM (23) and overlapping periods (99) — see `db/reports/FED_RATE_REVIEW.csv`. New periods entered in the new system must have DATE_TO ≥ DATE_FROM (validation). Decision 19 Nov 2026. |
| BR-TAX-04 | Sale proceeds = customer inclusive rate × qty. **Value exclusive = sale proceeds − FED − sales tax.** Rate per ton excl. = value exclusive ÷ qty.                                                                                                                                                                                                                                                                                                                                          |
| BR-TAX-05 | **WHT = WHT% × sale proceeds**; WHT% by filer status / section from tax settings [0.1% filer]. Total collectable = sale proceeds + WHT.                                                                                                                                                                                                                                                                                                                                                    |
| BR-TAX-06 | Further tax for unregistered buyers when configured (`FURTHER_TAX_PCT`, applied per FBR rules for the sale type).                                                                                                                                                                                                                                                                                                                                                                          |
| BR-TAX-07 | Retention per ton = net value ÷ qty (reporting only). Net value = value − sales tax − FED − subsidy − commission − incentive − export expense.                                                                                                                                                                                                                                                                                                                                             |
| BR-TAX-08 | Invoice figures are **stored**, never recalculated after finalisation.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| BR-TAX-09 | Tax calculator is a **pure function** in `packages/shared` used by API (authoritative) and UI (preview).                                                                                                                                                                                                                                                                                                                                                                                   |

Example (test fixture): qty 35.000 t; retail value excl. 757,898.31; FED 140,000.00; retail 897,898.31; ST 18% = 161,621.60; sale proceeds 850,500.00; value excl. 548,878.40; rate/ton excl. 15,682.24; WHT 0.1% = 850.50; total collectable 851,350.50.

## 8. Permit (BR-PMT)

| ID        | Rule                                                                                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-PMT-01 | Permit raised directly (no SRF/OC): customer, product, quantity split by area/city (`PERMIT_DTL_CITY`) with city rate from the effective rate sheet.                                                                              |
| BR-PMT-02 | Issue requires available balance ≥ permit value (BR-BAL) or approved override.                                                                                                                                                    |
| BR-PMT-03 | The user may **send a permit to the CFO** (no system threshold). While PENDING_CFO it cannot be dispatched. Approval rules may additionally force CFO approval above a configured quantity/value (`PERMIT_CFO_QTY`, empty = off). |
| BR-PMT-04 | **No expiry** (decision 19 Nov). `VALID_FROM` = issue date; `VALID_TO` kept null unless a user sets one manually. Print keeps the 48-hour wording from `PRINT_TEXT` (policy).                                                     |
| BR-PMT-05 | Dispatch per area ≤ area quantity (+ weight tolerance, BR-WGT-05). Balance qty = qty − dispatched.                                                                                                                                |
| BR-PMT-06 | Adjust Qty / Booking Adjustment: manual edits by permission `permit.adjust`, reason required, audited, re-runs balance check if quantity increases.                                                                               |
| BR-PMT-07 | Cancel any time; undispatched value returns to balance (commitment released).                                                                                                                                                     |
| BR-PMT-08 | Permit number = sequence + `.1`/`.2` (e.g. 2027746.1).                                                                                                                                                                            |

## 9. Delivery Order (BR-DO)

| ID       | Rule                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-DO-01 | Created only by OC confirmation, one per OC schedule line. Fields per requirements spec section 8.                                                             |
| BR-DO-02 | **No expiry** (decision 19 Nov). Rate lock BR-PRC-07 still applies.                                                                                            |
| BR-DO-03 | DO PDF carries a **signed QR** (section 10) and the DO-number barcode; sent to the dealer (BR-NTF). Reprint of a cancelled DO shows a **CANCELLED** watermark. |
| BR-DO-04 | Partial dispatch allowed; over-dispatch blocked except within weight tolerance (BR-WGT-05). DO becomes DISPATCHED when remaining ≤ 0.                          |
| BR-DO-05 | Cancel any time before fully dispatched; undispatched value returns to balance; reason + permission `do.cancel` (+ approval rule `DO_CANCEL` if configured).   |
| BR-DO-06 | DO quantity adjustment uses `DO_ADJUSTMENT` (advice) with approval; never edits the DO row in place without audit.                                             |
| BR-DO-07 | ON_HOLD DOs (BR-PRC-08) cannot be dispatched until released.                                                                                                   |

## 10. QR codes (BR-QR)

| ID       | Rule                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| BR-QR-01 | QR payload = compact string `DCL                                                                          | <doctype> | <brnch> | <docno> | <ver> | <sig>`; `sig`= first 16 bytes of HMAC-SHA256 over the rest with the server secret (base64url). Doc types:`DO`, `PMT`, `GP`(gate pass / DC),`INV`. |
| BR-QR-02 | Gate rejects a QR whose signature fails, whose doc is cancelled/held, or whose branch ≠ plant branch.     |
| BR-QR-03 | Reissue (e.g. after reprice) increments `ver`; old QRs of the same doc are rejected with a clear message. |
| BR-QR-04 | Invoice QR printed per FBR specification (FBR invoice number) in addition to our own.                     |

## 11. Plant dispatch, weighing and exit (BR-GATE, BR-WGT, BR-DC, BR-INV, BR-EXIT)

### 11.1 Gate-in

| ID         | Rule                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-GATE-01 | Gate-in by scanning DO/permit QR (camera or USB scanner) or by searching DO/permit number with permission `gate.manual_lookup`.                                                                                                    |
| BR-GATE-02 | Capture: vehicle no (normalised upper-case, no spaces), driver CNIC (13 digits, validated), driver name, mobile (`03XXXXXXXXX`), transporter, bilty no, reporting time. All required except bilty when `BILTY_REQUIRED` [Y] is N.  |
| BR-GATE-03 | One vehicle may carry several DOs of the **same customer, same DC type (DO type) and same destination**; permit lines of the same customer/product may be combined per area. Mixing DO and permit on one gate pass is not allowed. |
| BR-GATE-04 | A vehicle cannot have two open gate passes in the same branch.                                                                                                                                                                     |
| BR-GATE-05 | Temporary token (no DO/permit): only when `TEMP_TOKEN_ENABLED` [N] = Y; then a token records dealer bilty and the gate pass waits in status TOKEN until a DO/permit is attached.                                                   |
| BR-GATE-06 | **DC is issued at gate-in** (number allocated, status ISSUED) with lines per DO/permit area and planned qty (bags or tons). Planned weight = bags × 50 kg (bags) or planned tons × 1000 (bulker).                                  |

### 11.2 Weighing

| ID        | Rule                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-WGT-01 | Weights come from the weighbridge agent (`WEIGH_TICKET`, source DEVICE) with a **stable reading**: `WEIGH_STABLE_COUNT` [5] consecutive readings within `WEIGH_STABLE_KG` [10] kg. |
| BR-WGT-02 | Manual weight entry only with `weigh.manual`, reason required, flagged `SOURCE = MANUAL`, shown on reports and dashboard.                                                          |
| BR-WGT-03 | Tare first, gross second. Gross must be > tare. Tare is compared with the vehicle's last tare; difference > `TARE_WARN_KG` [300] shows a warning (not a block).                    |
| BR-WGT-04 | Net = gross − tare. **DC weight is updated with net**; variance = net − planned (kg and %), shown as OVER or UNDER to every user who opens the DC/gate pass.                       |
| BR-WGT-05 | **Tolerance**:                                                                                                                                                                     | variance | ≤ `WEIGHT_TOLERANCE_KG` [100] → OK. Otherwise **exit blocked**; options: re-load and re-weigh (new gross reading, history kept) or supervisor override `weigh.override` with reason (approval rule `WEIGHT_OVERRIDE`). Over-dispatch of a DO/permit area is allowed only within the tolerance or with this override. |
| BR-WGT-06 | Net weight is allocated to DC lines **pro-rata by planned qty** (largest-remainder to keep the exact total in kg).                                                                 |
| BR-WGT-07 | Every reading is kept (`WEIGH_TICKET`), never overwritten.                                                                                                                         |

### 11.3 DC and invoice

| ID        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-DC-01  | DC header and lines in `FH_DELIVERY_CHALLAN` / `FH_DEL_CHALLAN_DETAIL` (DO route) and `FH_DELIVERY_MEMO` (permit route, one row per area line) plus new columns (SCHEMA). Gate/weighing data in `GATE_PASS` / `WEIGH_TICKET`.                                                                                                                                                                                                                       |
| BR-DC-02  | All DOs on one DC: same customer, DC type, destination (BR-GATE-03). Line qty ≤ DO undispatched balance (+ tolerance).                                                                                                                                                                                                                                                                                                                              |
| BR-DC-03  | Bag details: bag type, supplier/brand, colour; export: container no, seal no.                                                                                                                                                                                                                                                                                                                                                                       |
| BR-INV-01 | After gross weight and variance OK (or override), the system **finalises one invoice per DC line** (one per DO / permit area) in one transaction: allocates invoice number, computes tax (BR-TAX) on **invoice quantity** = per `INVOICE_QTY_BASIS` [NET_WEIGHT] (allocated net tons) or BAGS (planned), updates DO/permit dispatched qty, posts DC ledger (Dr sale proceeds, Dr WHT) and DO-ledger dispatch memo, writes notification outbox rows. |
| BR-INV-02 | Then FBR submission (BR-FBR).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| BR-INV-03 | Invoice number gap-free (BR-NUM); invoice is never deleted; cancelled only by credit note after FBR.                                                                                                                                                                                                                                                                                                                                                |

### 11.3a FBR Digital Invoicing

| ID        | Rule                                                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-FBR-01 | Every finalised invoice is submitted to FBR Digital Invoicing (PRAL) through the outbox right after finalisation; environment and credentials per branch (`FBR_ENV`, `FBR_*` settings).                                                              |
| BR-FBR-02 | Payload maps seller (branch NTN/STRN), buyer (customer tax profile on the invoice), HS code, quantity/unit, value excl., FED, sales tax, further tax, WHT and the sale type (e.g. "Goods (FED in ST mode)") from the invoice row — never recomputed. |
| BR-FBR-03 | Each attempt is stored in `FBR_SUBMISSION` (request, response, result). Accepted → `FBR_INVOICE_NO` + QR data on the invoice, status FBR_ACCEPTED.                                                                                                   |
| BR-FBR-04 | Timeout/5xx → FBR_PENDING and automatic retry with back-off; validation rejection → FBR_REJECTED shown on the plant board and Finance dashboard with FBR's error text; fix (e.g. buyer NTN) then `fbr-retry`.                                        |
| BR-FBR-05 | Submission is idempotent per invoice (our invoice number as the reference); an invoice never gets two FBR numbers.                                                                                                                                   |

### 11.4 Exit

| ID         | Rule                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-EXIT-01 | Exit by scanning the gate-pass QR printed on the DC.                                                                                                                                                                                        |
| BR-EXIT-02 | Allowed only when: all DC lines invoiced; weight variance OK or overridden; FBR invoice number present on every invoice. If FBR is pending: exit blocked unless `ALLOW_EXIT_WITHOUT_FBR` [N] = Y **and** a supervisor override with reason. |
| BR-EXIT-03 | Exit records time and user; gate pass CLOSED; dealer notified.                                                                                                                                                                              |

### 11.5 DC cancel

| ID           | Rule                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-DC-CXL-01 | Before invoice finalisation (truck not loaded / aborted): cancel with reason by `dc.cancel`; DC number stays used (status CANCELLED); gate pass closed as ABORTED; nothing posted.                                            |
| BR-DC-CXL-02 | After invoice finalisation but before FBR submission succeeds: cancel requires `dc.cancel` + approval `DC_CANCEL`; ledger postings reversed; DO/permit dispatched qty restored; invoice status CANCELLED (number not reused). |
| BR-DC-CXL-03 | After FBR invoice number exists: **no cancel**. Use a credit note (type 004 Sales return) with FBR credit/debit note submission as FBR allows (open question Q5).                                                             |

## 12. State machines

```
Customer:    DRAFT → PENDING_APPROVAL → APPROVED ⇄ BLOCKED ; APPROVED → CLOSED
SRF:         DRAFT → SUBMITTED (creates draft OC) → CONVERTED (OC confirmed) ; DRAFT/SUBMITTED → CANCELLED
OC:          DRAFT → REVIEWED → APPROVED → CONFIRMED → CLOSED (all DOs done/cancelled)
             DRAFT/REVIEWED/APPROVED → CANCELLED ; CONFIRMED → CANCELLED (only undispatched part)
             APPROVED --balance short--> stays APPROVED (shortfall shown) ; CONFIRMED DO --reprice short--> ON_HOLD (DO level)
BRV:         ENTERED → VERIFIED → CLEARED ; ENTERED → CANCELLED ; VERIFIED/CLEARED → BOUNCED
Permit:      DRAFT → PENDING_CFO → ISSUED ; DRAFT → ISSUED ; ISSUED → PARTLY_DISPATCHED → DISPATCHED ; any open → CANCELLED
DO:          ISSUED → PARTLY_DISPATCHED → DISPATCHED ; ISSUED/PARTLY → ON_HOLD → back ; ISSUED/PARTLY/ON_HOLD → CANCELLED
GatePass:    TOKEN (optional) → IN → TARE_DONE → GROSS_DONE → (VARIANCE_BLOCKED → OVERRIDDEN) → INVOICED → EXITED ; IN/TARE_DONE → ABORTED
DC:          ISSUED → WEIGHED → INVOICED → (FBR_PENDING → FBR_DONE) → CLOSED ; ISSUED/WEIGHED → CANCELLED
Invoice:     FINAL → FBR_PENDING → FBR_ACCEPTED | FBR_REJECTED (retry/fix) ; FINAL (pre-FBR) → CANCELLED
Note:        DRAFT → PENDING_APPROVAL → POSTED ; DRAFT/PENDING → CANCELLED ; POSTED → REVERSED (by counter-note)
Approval:    PENDING → APPROVED | REJECTED | CANCELLED (by maker) | EXPIRED (setting)
```

Legacy status columns (`CANCEL_CODE`, `CANCEL_FLAG`, `POST`, `APPROVED`) are kept in sync for old reports; the new `DOC_STATUS` column is the source of truth.

## 13. Ledgers (BR-LED)

Table `CUSTOMER_LEDGER`, `LEDGER_TYPE` = `DO` or `DC`. Posting happens **in the same transaction** as the source document. Never updated; reversals are new rows with `REVERSAL_OF`.

| Event                                   | DO ledger                     | DC ledger                                |
| --------------------------------------- | ----------------------------- | ---------------------------------------- |
| BRV verified                            | Cr amount                     | Cr amount                                |
| BRV bounced                             | Dr amount ("Cheque return")   | Dr amount                                |
| DO issued                               | Dr DO value                   | —                                        |
| Permit issued                           | Dr permit value               | —                                        |
| DO/permit cancelled (undispatched part) | Cr returned value             | —                                        |
| DO/permit quantity adjusted             | Dr/Cr difference              | —                                        |
| Invoice finalised                       | — (memo only: dispatched qty) | Dr sale proceeds; Dr WHT (separate line) |
| Invoice cancelled (pre-FBR)             | —                             | Cr reversal of both lines                |
| Credit note posted                      | Cr amount                     | Cr amount                                |
| Debit note posted                       | Dr amount                     | Dr amount                                |
| Balance transfer A → B                  | Dr A, Cr B                    | Dr A, Cr B                               |
| Opening balance (migration)             | one row per customer          | one row per customer                     |

| ID        | Rule                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| BR-LED-01 | Narration built from source (e.g. `BRV # 2026100764 · IBFT · MBL`, `DC # 175002 · INV # 8445 · 35.00 t @ 24,300`).  |
| BR-LED-02 | A nightly job recomputes balances from source documents and reports any difference (`LEDGER_RECON` dashboard tile). |
| BR-LED-03 | Each row stores `GL_CODE` from `GL_MAP` for R6.                                                                     |

## 14. Credit notes, debit notes, transfers, incentives (BR-NOTE, BR-INC)

| ID         | Rule                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-NOTE-01 | Credit note types: 001 Adjustments, 002 Subsidies, 003 Purchases, 004 Sales return, 005 Revision of rate, 006 Freight, 007 Commission, 008 Incentive, 009 Withholding 236H, 010 Target incentive. Debit notes use the same table with `DB_CR_CD = 'D'`. |
| BR-NOTE-02 | Header + lines (particular, amount, WHT % where applicable). Net amount = Σ lines − WHT.                                                                                                                                                                |
| BR-NOTE-03 | DRAFT → approval rule `NOTE_POST` (by type/amount) → POSTED (ledger). Maker ≠ approver.                                                                                                                                                                 |
| BR-NOTE-04 | **Balance transfer**: one document debits customer A and credits customer B with the same amount; both posted atomically; R5 shows "Bal trf A to B".                                                                                                    |
| BR-NOTE-05 | Posted notes are never edited; correction = reversing note (`REVERSAL_OF`).                                                                                                                                                                             |
| BR-INC-01  | Incentive schemes (`INCENTIVE`, `INCENTIVE_PRODUCT`, `INCENTIVE_DETAIL`): period, customer range, products, rate per ton; calculation run produces DRAFT credit notes type 008 per customer from dispatched (invoiced) qty in the period.               |
| BR-INC-02  | Monthly target incentive (`TARGET_MST/CUST/CUST_AREA`, slabs `TARGET_PERC_MST/DTL`): achievement % = invoiced qty ÷ target qty; slab amount for normal / addition / special targets → DRAFT credit notes type 010.                                      |
| BR-INC-03  | A run can be previewed, then committed; committing twice for the same period/customer is blocked.                                                                                                                                                       |

## 15. Numbering (BR-NUM)

| ID        | Rule                                                                                                                                                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-NUM-01 | `DOC_SEQUENCE (BRNCH, YEAR, DOC_TYPE)` holds `LAST_NO`. Next number = `LAST_NO + 1` read with `SELECT … FOR UPDATE` **inside the business transaction**; commit makes it permanent, rollback returns it. Never use Oracle sequences for document numbers. |
| BR-NUM-02 | Doc types: SRF, OC, BRV, DO, PMT, GP, DC, DM, INV, CN, DN, CXL (cancel advice), INC. Fiscal year from `SALES_YEAR`.                                                                                                                                       |
| BR-NUM-03 | Display = number + `.` + branch suffix (`.1`/`.2`) where the business prints it (permit, DO, DC, invoice).                                                                                                                                                |
| BR-NUM-04 | Seed `LAST_NO` from max legacy number per branch/type at migration so numbering continues.                                                                                                                                                                |
| BR-NUM-05 | Cancelled numbers are never reused. Invoice numbers have **no gaps**: invoice number is allocated only at finalisation (BR-INV-01).                                                                                                                       |

## 16. Approvals (BR-APR)

| ID        | Rule                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-APR-01 | Rules in `APPROVAL_RULE`: doc type, branch (or all), condition (min amount, min qty, override flag), levels (1–3), role per level, `SAME_USER_ALLOWED` = N.                                                                                                                                |
| BR-APR-02 | When an action needs approval, the service creates `APPROVAL_REQUEST` (snapshot of the data + reason) and the document waits in a PENDING state; nothing is posted until approved.                                                                                                         |
| BR-APR-03 | Approvers are notified (in-app + email/push); approve/reject from mobile with comment.                                                                                                                                                                                                     |
| BR-APR-04 | Default rules (seeded): CUSTOMER_APPROVE, CREDIT_LIMIT, RATE_CHANGE, OC_PRICE_OVERRIDE, OC_BALANCE_OVERRIDE, PERMIT_CFO (when sent), PERMIT_BALANCE_OVERRIDE, DO_CANCEL (after partial dispatch), WEIGHT_OVERRIDE (plant manager), DC_CANCEL (after invoice), NOTE_POST, EXIT_WITHOUT_FBR. |
| BR-APR-05 | Approval decisions are audited and immutable.                                                                                                                                                                                                                                              |

## 17. Notifications (BR-NTF)

| ID        | Rule                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-NTF-01 | Events → dealer: BRV verified; DO issued (PDF link); permit issued (PDF link); truck loaded (vehicle, net weight, invoice nos); truck exited. Channels per customer preference: SMS, WhatsApp (link), email. |
| BR-NTF-02 | Written to `NOTIFICATION_OUTBOX` in the same transaction as the event; a worker sends with retries (exponential back-off, max `NTF_MAX_TRIES` [5]); failures visible on dashboard.                           |
| BR-NTF-03 | Internal notifications: approval requests, variance blocks, FBR failures, trucks waiting > `PLANT_WAIT_ALERT_MIN` [120] minutes.                                                                             |
| BR-NTF-04 | Document links: random token, expire after `LINK_EXPIRY_DAYS` [7], PDF only.                                                                                                                                 |

## 18. Audit (BR-AUD)

| ID        | Rule                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-AUD-01 | Every insert/update/status change/cancel/approve/override/print/share/login writes `AUDIT_LOG` with user, branch, time, IP, entity, key, action, reason, old values, new values (JSON text). |
| BR-AUD-02 | Reason is mandatory for cancel, override, manual weight, manual lookup, price override, permit adjust.                                                                                       |
| BR-AUD-03 | Audit rows are insert-only (DB grants: no UPDATE/DELETE for the app user on `AUDIT_LOG`).                                                                                                    |

## 19. Branch scope (BR-BR)

| ID       | Rule                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| BR-BR-01 | Each user has allowed branches (`APP_USER_BRANCH`) and a current branch chosen at login (with fiscal year).      |
| BR-BR-02 | Plant users are restricted to their plant's branch. Head-office users may have both.                             |
| BR-BR-03 | Reports can be merged across branches only by users allowed on both (R12 "Merge").                               |
| BR-BR-04 | Every repository query includes `BRNCH IN (:allowed)`; a test suite asserts no endpoint leaks other-branch data. |

## 20. Offline plant operation (BR-OFF)

| ID        | Rule                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-OFF-01 | Gate and weighbridge screens work offline: events (gate-in, tare, gross, exit) are stored locally with a client UUID and device time.                                                                                                                                                        |
| BR-OFF-02 | Offline gate-in uses the **signed QR** to validate the document locally (signature + cached document snapshot downloaded every `OFFLINE_CACHE_MIN` [5] minutes: open DOs/permits of the branch with remaining qty).                                                                          |
| BR-OFF-03 | DC numbers are **not** allocated offline; the gate pass gets a provisional local id; the DC number is allocated on sync. Invoice and FBR happen only online; therefore exit while offline is blocked unless the plant manager uses the emergency exit override (logged, reconciled on sync). |
| BR-OFF-04 | Sync is idempotent: the server stores `IDEMPOTENCY_KEY` per event; replays return the original result. Conflicts (e.g. DO cancelled meanwhile) go to a review queue for the dispatch supervisor.                                                                                             |

## 21. Data quality (BR-DQ)

| ID       | Rule                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-DQ-01 | Dates more than `MAX_FUTURE_DAYS` [366] ahead are rejected on every date field (legacy rows with impossible dates are listed in a cleanup report). |
| BR-DQ-02 | CNIC 13 digits; NTN 7–8 digits (+ check digit format as FBR); STRN 13 digits; mobile `03XXXXXXXXX`; vehicle no normalised.                         |
| BR-DQ-03 | Unique keys from script 03 are enforced for all new rows (ENABLE NOVALIDATE).                                                                      |
