# API_SPEC.md

REST/JSON API served by `apps/api` (Fastify). Base path **`/api/v1`**. The live OpenAPI 3.1 document is generated from the Zod schemas at `/api/v1/docs` (Swagger UI) and `/api/v1/openapi.json`; this file is the design contract the code must match. When an endpoint changes, update this file in the same PR.

---

## 1. Conventions

| Topic       | Rule                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | httpOnly cookies `at` (access JWT, 15 min) and `rt` (refresh, 12 h sliding, rotated). Devices use `Authorization: Bearer <device token>`.                                                            |
| CSRF        | State-changing requests from the web send header `X-CSRF-Token` matching cookie `csrf` (double submit).                                                                                              |
| Branch      | The session has a current branch. Document URLs carry the branch: `/oc/{brnch}/{ocNo}`. Lists accept `brnch` (default: current; `all` only with permission for multi-branch and only where allowed). |
| Naming      | JSON camelCase. Legacy column → field mapping in each module's `mapper.js`.                                                                                                                          |
| Numbers     | Money and rates as **strings** (`"850500.00"`) to avoid float loss; quantities as strings with 3 decimals; weights as integers (kg).                                                                 |
| Dates       | `YYYY-MM-DD` for business dates; ISO 8601 with offset for timestamps.                                                                                                                                |
| Pagination  | `?page=1&pageSize=50` (max 200) → `{ items, page, pageSize, total }`. Sorting `?sort=-orderDate,customerCode`. Filtering by documented query params only.                                            |
| Concurrency | GET of an editable resource returns `ETag: "<rowVer>"`; PUT/PATCH/state commands require `If-Match`. Mismatch → `409 version_conflict`.                                                              |
| Idempotency | All POST commands accept `Idempotency-Key` (UUID). **Required** on plant and sync endpoints. Same key + same body → original response; same key + other body → 422.                                  |
| Errors      | `application/problem+json`: `{ type, title, status, code, detail, errors?: [{path, message}], ruleId?, data? }`. Codes below.                                                                        |
| Commands    | State changes are explicit sub-resources: `POST …/{id}/confirm`, `/cancel`, `/verify`… never a PATCH of `status`.                                                                                    |
| Reasons     | Cancel/override/manual commands require `{ "reason": "≥10 chars" }`.                                                                                                                                 |
| Audit       | Every command writes AUDIT_LOG; response header `X-Request-Id`.                                                                                                                                      |
| Rate limits | 429 with `Retry-After`.                                                                                                                                                                              |

### 1.1 Error codes

| HTTP    | code                                               | When                                                                                              |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 400     | `validation_failed`                                | Zod errors (fields in `errors`)                                                                   |
| 401     | `unauthenticated`                                  | No/expired session                                                                                |
| 403     | `forbidden` / `branch_forbidden` / `maker_checker` | Missing permission / branch / same user approving                                                 |
| 404     | `not_found`                                        | Not in allowed branches either                                                                    |
| 409     | `version_conflict` / `invalid_state` / `duplicate` | ROW_VER mismatch / wrong state for the command / unique key                                       |
| 422     | `rule_violation`                                   | Business rule failed; `ruleId` (e.g. `BR-BAL-01`) and `data` (e.g. `{ shortfall: "1240500.00" }`) |
| 422     | `approval_required`                                | Action needs approval; `data.requestId` returned after creating the request                       |
| 423     | `locked`                                           | User locked out                                                                                   |
| 502/503 | `upstream_unavailable`                             | FBR/SMS down (only on direct calls)                                                               |

## 2. Auth & session

| Method | Path                                     | Permission            | Body / notes                                                                                                           |
| ------ | ---------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`                            | public (rate-limited) | `{ usrid, password, brnch, fiscalYear }` → sets cookies, returns `{ user, branch, permissions[], mustChangePassword }` |
| POST   | `/auth/refresh`                          | cookie                | Rotates refresh token                                                                                                  |
| POST   | `/auth/logout`                           | auth                  | Revokes refresh family                                                                                                 |
| POST   | `/auth/change-password`                  | auth                  | `{ currentPassword, newPassword }`                                                                                     |
| POST   | `/auth/switch-branch`                    | auth                  | `{ brnch, fiscalYear }` → new tokens                                                                                   |
| GET    | `/auth/me`                               | auth                  | User, branches, roles per branch, permissions for current branch, settings needed by UI                                |
| GET    | `/auth/login-options`                    | public                | Branches and their fiscal years for the login form; default fiscal year (added P0-08)                                  |
| POST   | `/auth/totp/setup` · `/auth/totp/verify` | auth                  | Optional 2FA                                                                                                           |
| POST   | `/devices/token`                         | device id + HMAC      | Device token (12 h)                                                                                                    |

## 3. Admin

| Method       | Path                                                                              | Permission                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST     | `/admin/users`                                                                    | `admin.users`                                                                                                                                  |
| GET/PUT      | `/admin/users/{userId}`                                                           | `admin.users` (If-Match)                                                                                                                       |
| POST         | `/admin/users/{userId}/lock` · `/unlock` · `/reset-password`                      | `admin.users`                                                                                                                                  |
| PUT          | `/admin/users/{userId}/branches`                                                  | `admin.users` — `[{ brnch, isDefault, roles: [] }]`                                                                                            |
| GET/POST/PUT | `/admin/roles`, `/admin/roles/{code}` (permissions list)                          | `admin.roles`                                                                                                                                  |
| GET          | `/admin/permissions`                                                              | `admin.roles`                                                                                                                                  |
| GET/PUT      | `/admin/settings?level=` , `/admin/settings/{level}/{key}`                        | `admin.settings` — `level` 0 = company (SYS_ADMIN only), 1/2 = branch. Named `level` (not `brnch`) because 0 is not a branch. Body `{ value }` |
| GET/POST/PUT | `/admin/devices`, `/admin/devices/{id}`, `POST /admin/devices/{id}/rotate-secret` | `admin.devices`                                                                                                                                |
| GET/POST/PUT | `/admin/print-texts`, `/admin/message-templates`, `/admin/gl-map`                 | `admin.print_texts` / `admin.templates` / `admin.gl_map`                                                                                       |
| GET/POST/PUT | `/admin/approval-rules`                                                           | `admin.approval_rules`                                                                                                                         |
| GET          | `/audit?entity=&key=&user=&from=&to=&action=`                                     | `audit.view`                                                                                                                                   |
| GET          | `/admin/outbox?status=`                                                           | `admin.settings` — notifications/jobs incl. FAILED and DEAD (P0-13)                                                                            |
| POST         | `/admin/pdf-test`                                                                 | `admin.settings` — queues a sample PDF through outbox → worker → Chromium → storage (P0-15 self-test)                                          |
| GET          | `/files/{attId}`                                                                  | print permission of the owning entity (e.g. `do.print`), branch-scoped; streams the stored PDF; audited as PRINT (P0-15)                       |

Devices (built 23 Nov 2026, P3-01): `POST /admin/devices` body `{ deviceId (KHI-WB-01 style), brnch, deviceType: WEIGHBRIDGE|GATE, deviceName, config? }` → 201 `{ device, secret, note }` (secret shown once, stored AES-256-GCM with `APP_ENC_KEY`); `PUT /admin/devices/{id}` `{ deviceName, active, config? }`; `POST …/rotate-secret` → `{ device, secret, note }`. `admin.devices` is checked in the device's branch. Device sign-in: `POST /devices/token` (public, 30/min) body `{ deviceId, ts (ISO, ±5 min), nonce, signature }`, signature = HMAC-SHA256(secret, `DCL-DEV|{deviceId}|{ts}|{nonce}`) base64url (`signTokenRequest` in `@dcl/shared`) → `{ token, expiresIn: 43200, brnch, deviceType }`; any failure = 401 (reason in the audit log, `TOKEN_REFUSED`). Devices send `Authorization: Bearer <token>` and reach only routes marked for devices, in their own branch, while active (P-6; other routes 403). `GET /devices/me` → the device with its `config`. Weighbridge readings are signed over `DCL-WGT|{deviceId}|{readingId}|{weightKg}|{stable 1/0}|{readOn}` (P3-05).

## 4. Masters & pricing

Generic pattern for simple masters (P1-01): `product-groups`, `product-types`, `product-periods` (read-only), `brands`, `do-types`, `bags`, `bag-colours`, `channels`, `categories`, `regions`, `credit-types`, `banks`, `company-banks`, `instruments`, `transporters`, `transport-modes`, `note-types`. Fields per type (names, kinds, required, max length) are defined once in `packages/shared/src/masters.js`; the create/update body is validated with the same Zod schema the web form uses. Geography (zones, territories, areas, cities) has its own endpoints (P1-02, `GEO_HIERARCHY`).

| Method | Path                                                                                                                            | Permission                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| GET    | `/masters/{type}?brnch=&q=&active=&productCode=&page=&pageSize=&sort=`                                                          | `masters.view`                                 |
| GET    | `/masters/{type}/{brnch}/{key}`                                                                                                 | `masters.view`                                 |
| POST   | `/masters/{type}` body `{ brnch?, …key, …fields }` (auto-numbered keys may be empty)                                            | `masters.create`                               |
| PUT    | `/masters/{type}/{brnch}/{key}`                                                                                                 | `masters.update` (If-Match)                    |
| POST   | `/masters/{type}/{brnch}/{key}/deactivate` · `/activate` body `{ reason? }`                                                     | `masters.update` (If-Match)                    |
| GET    | `/lookups?types=channels,banks,…&brnch=` → `{ type: [{ value, label, active }] }`; types = single-key masters + `product-codes` | auth (cached 5 min per process, branch-scoped) |

Composite keys are joined with `~` in URLs (`/masters/product-periods/1/OPC~57`). `product-periods` (PRODUCT_DESC_T) is read-only here: new periods carry tax rates and are entered with P1-05 (approval `RATE_CHANGE`); a write returns `409 invalid_state`.

Geography (P1-02, `GEO_HIERARCHY`, SCHEMA §2.3). `geoCode` = `Z<zone>-T<territory>-A<area>-C<city>`, unique per branch:

| Method | Path                                                                  | Permission                  | Notes                                                                                                    |
| ------ | --------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/geo/nodes?brnch=&parentCode=&level=&q=&active=&page=&pageSize=`     | `masters.view`              | Children of `parentCode`, or one level, or a search; each node has `path`, `childCount`, `customerCount` |
| GET    | `/geo/nodes/{brnch}/{geoCode}`                                        | `masters.view`              | ETag                                                                                                     |
| POST   | `/geo/nodes` `{ brnch?, parentCode?, code, name }`                    | `masters.create`            | No parent = zone; parent must be active; code fixed afterwards (BR-CUS-03)                               |
| PUT    | `/geo/nodes/{brnch}/{geoCode}` `{ name }`                             | `masters.update` (If-Match) | Name copied to every node below                                                                          |
| POST   | `/geo/nodes/{brnch}/{geoCode}/deactivate` · `/activate` `{ reason? }` | `masters.update` (If-Match) | Deactivate cascades down; activate needs an active parent                                                |
| GET    | `/geo/legacy-map?brnch=&entity=&q=`                                   | `masters.view`              | LEGACY_MAP review: legacy code → node                                                                    |
| GET    | `/geo/summary?brnch=`                                                 | `masters.view`              | Nodes per level, customers without geography, legacy entities                                            |

Pricing:

| Method   | Path                                                                   | Permission                 | Notes                                                                 |
| -------- | ---------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| GET      | `/pricing/trade-prices?customer=&product=&city=&asOf=`                 | `pricing.view`             | Effective row per key at `asOf`                                       |
| GET      | `/pricing/trade-prices/history?customer=&product=&city=`               | `pricing.view`             |                                                                       |
| POST     | `/pricing/trade-prices`                                                | `pricing.create`           | New effective-dated row(s); creates approval request `RATE_CHANGE`    |
| POST     | `/pricing/trade-prices/import` (multipart xlsx)                        | `pricing.import`           | Returns preview `{ rows, errors }`; `POST …/import/{importId}/commit` |
| GET/POST | `/pricing/rate-sheets`                                                 | view / create              | City rate sheet (AREA_RATES_M/P/D) DRAFT                              |
| PUT      | `/pricing/rate-sheets/{brnch}/{serno}`                                 | `pricing.create`           | Edit while PENDING                                                    |
| POST     | `/pricing/rate-sheets/{brnch}/{serno}/set-mrp`                         | `pricing.create`           | `{ product, mrp }` all lines                                          |
| POST     | `/pricing/rate-sheets/{brnch}/{serno}/submit` · `/approve` · `/reject` | create / `pricing.approve` |                                                                       |
| GET      | `/pricing/quote?customer=&product=&city=&qtyType=&date=`               | `pricing.view`             | Returns master price breakdown (used by draft OC/permit)              |
| GET/POST | `/tax/rates?kind=ST                                                    | FED                        | WHT                                                                   | CED` | `tax.view` / `tax.update` | Effective-dated |

Trade prices (P1-06): `GET /pricing/trade-prices?customer=&product=&geoCode=&status=&q=` (all versions), `GET /pricing/trade-prices/history?customer=&product=&geoCode=`, `GET /pricing/quote?customer=&product=&geoCode=&date=` → `{ tradePrice, period }` (latest APPROVED version with EF_DATE ≤ date + BR-TAX-10 period breakdown: MRP, retail, ST, FED, company price = MRP − ST − FED; MRP = retail + ST when the period has none), `POST /pricing/trade-prices` `{ customerCode, productCode, geoCode (city), invoicePrice, efDate, target?, priceCodeBase? }` → next price-code version (ABABDOPS18 → 19; new key = base + 01), PENDING_APPROVAL, approval RATE_CHANGE / TRADE_PRICE_SET; refused when EF_DATE is not after the current version (BR-PRC-01) or the price is above MRP (BR-PRC-03, `data.excess`). Excel import: `POST /pricing/trade-prices/import` (multipart `.xlsx`, `pricing.import`; first sheet, header `customer_code, product_code, geo_code, price, effective_from[, target]`, max 2,000 rows) → `{ importId, total, valid, rows: [{ row, …, ok, priceCode | error, ruleId }] }` — every row checked like a single new price in a rolled-back transaction; `importId` only when all rows are valid (kept 30 min in the API process). `POST /pricing/trade-prices/import/{importId}/commit` → all prices in one transaction + one approval request (RATE_CHANGE / TRADE_PRICE_IMPORT) → `{ created, priceCodes, requestId }`.

City rate sheets (P1-07, AREA_RATES_M/P/D; legacy STATUS P = OPEN, A = APPROVED): `GET /pricing/rate-sheets?brnch=&status=`; `POST /pricing/rate-sheets` `{ date }` (`pricing.create`) = copy of the latest earlier sheet, number from DOC_SEQUENCE `RSH`, one sheet per branch and date; `GET /pricing/rate-sheets/{brnch}/{serno}` (lines with BR-PRC-05 columns); `PUT …/lines/{lnkno}` `{ booking?, freight?, rebate?, tax236?, mrp? }` (sheet OPEN; chain recalculated, FED / ST% from the product period on the sheet date, ST = tax inside the MRP); `POST …/set-mrp` `{ productCode, mrp }`; `POST …/submit` → PENDING_APPROVAL + approval RATE_CHANGE / RATE_SHEET_APPROVE (rejected → OPEN again); `GET /pricing/rate-sheets/effective?product=&areaDoc=&date=` = line of the latest APPROVED sheet dated ≤ date (BR-PRC-02). Freight: `GET /pricing/freight-sheets`, `GET /pricing/freight-sheets/{brnch}/{serno}`, `GET /pricing/freight/last?areaDoc=&date=` (LFR).

Tax rates (P1-05; decisions in Approvals, rule RATE_CHANGE; when no rule applies the change takes effect at once):

| Method | Path                                                                                                          | Permission   | Notes                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/tax/rates`                                                                                                  | `tax.view`   | WHT rows (TAX_RATE) of my branches + both-branches rows (brnch 0), all statuses                                                                           |
| GET    | `/tax/rates/effective?filerStatus=&section=&date=`                                                            | `tax.view`   | BR-TAX-05: latest APPROVED row with EFFECTIVE_FROM ≤ date; section row beats general ('-'), branch row beats 0                                            |
| POST   | `/tax/rates` `{ scope 0/1/2, filerStatus F/N/E, section?, ratePct, effectiveFrom, remarks? }`                 | `tax.update` | New row PENDING_APPROVAL → approval action TAX_RATE_SET; duplicates (same key + date) refused                                                             |
| POST   | `/tax/product-periods` `{ productCode, dateFrom, fedPerTon, salesTaxPer, mrp?, retailPrice?, companyPrice? }` | `tax.update` | FED / ST change = new PRODUCT_DESC_T period (BR-TAX-10), inserted on approval (action PRODUCT_PERIOD_ADD); must start after the latest period (BR-PRC-01) |
| GET    | `/tax/product-periods/pending`                                                                                | `tax.view`   | Period changes waiting for approval (current branch)                                                                                                      |

Further tax stays the setting FURTHER_TAX_PCT (BR-TAX-06). The earlier `GET/POST /tax/rates?kind=ST|FED|WHT|CED` design is replaced by the above (ST/FED live on product periods, CED is unused — SCHEMA §2.4).

## 5. Customers

| Method  | Path                                                                          | Permission              | Notes                                                                                                                                                                                                                                                                                                                                     |
| ------- | ----------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/customers?brnch=&q=&zone=&channel=&status=`                                 | `customer.view`         |                                                                                                                                                                                                                                                                                                                                           |
| GET     | `/customers/{brnch}/{code}`                                                   | `customer.view`         | All tabs; balance omitted without `customer.view_balance`                                                                                                                                                                                                                                                                                 |
| POST    | `/customers`                                                                  | `customer.create`       | Status PENDING_APPROVAL; code generated (BR-CUS-03) or preview via `GET /customers/code-preview?zone=&territory=&area=&channel=`                                                                                                                                                                                                          |
| PUT     | `/customers/{brnch}/{code}`                                                   | `customer.update`       | Approved customer: creates change request (diff)                                                                                                                                                                                                                                                                                          |
| POST    | `/customers/{brnch}/{code}/approve` · `/reject`                               | `customer.approve`      | Maker-checker                                                                                                                                                                                                                                                                                                                             |
| POST    | `/customers/{brnch}/{code}/block` · `/unblock`                                | `customer.block`        | `{ reason, stopDispatch }`                                                                                                                                                                                                                                                                                                                |
| GET/PUT | `/customers/{brnch}/{code}/areas`, `/security`, `/bank-accounts`, `/contacts` | view / update           |                                                                                                                                                                                                                                                                                                                                           |
| GET     | `/customers/{brnch}/{code}/balance?value=`                                    | `customer.view_balance` | `{ asOf, dcLedgerBalance, doLedgerBalance, openCommitments, unusedCredit, available, commitments: [{ kind, docNo, ocNo, productCode, status, qtyTon, dispatchedTon, rate, value }], credit: { hasCreditLimitsRow, legacyCreditLimit, types }, todayCollection: { total, receipts } }`; with `value` also `shortfall` (BR-BAL-01/03/05/06) |
| GET     | `/customers/{brnch}/{code}/360`                                               | `customer.view`         | Summary for side panel                                                                                                                                                                                                                                                                                                                    |
| POST    | `/customers/{brnch}/{code}/credit-limits`                                     | `customer.credit_limit` | Credit Limit document → approval                                                                                                                                                                                                                                                                                                          |

P1-03 implementation notes:

- `GET /customers?brnch=&q=&channel=&status=&geoCode=` — `q` matches name, code, mobile, NTN; `geoCode` includes everything below the node.
- `POST /customers` body: tab fields (`packages/shared/src/customers.js` CUSTOMER_FIELDS) + `geoCode` (area or city, BR-CUS-03) + `zoneCode` (customer zone from ZONE_DESC; default = geography zone when ZONE_DESC has it). Code `Z-TT-AA-NNN` / `ZZTT-AA-NNN` (decision 20 Nov 2026). Response `{ customer, requestId }` (approval request CUSTOMER_APPROVE / action CUSTOMER_CREATE).
- `PUT /customers/{brnch}/{code}` (If-Match) body = only the changed fields. On an APPROVED/BLOCKED customer, tax-profile and contact-number fields (`approval: true` in the registry) go to a change request (action CUSTOMER_CHANGE, snapshot with from/to per field) → **202** `{ customer, requestId, pendingFields }`; other fields apply at once.
- `POST …/approve` · `/reject` `{ comment? }` decide the pending CUSTOMER_APPROVE request through the approval engine (maker ≠ checker); a rejected new customer returns to DRAFT. `POST …/submit` (If-Match) sends a DRAFT again.
- `POST …/block` `{ reason, stopDispatch }` · `/unblock` `{ reason }` (If-Match) → status BLOCKED/APPROVED + CUSTOMER_BLOCK history row.
- `GET /customers/{brnch}/{code}` also returns `pendingApproval` and `blocks: { history, legacyGroups }`.
- Legacy customers have no DOC_STATUS: shown as APPROVED (CLOSED when CLOSED = 'Y').
- Credit limits (P1-04, BR-CUS-07): `GET /customers/{brnch}/{code}/credit-limits` → `{ hasCreditLimitsRow, legacyCreditLimit, totalCurrent, types: [{ creditType, description, initial, current, availed, unused }], documents }`; `POST …/credit-limits` `{ creditType A–J, amount, remark }` (`customer.credit_limit`) creates a Credit Limit document (CREDIT_LIMITS_F, number from DOC_SEQUENCE `CLM`, PENDING_APPROVAL) + approval request CREDIT_LIMIT / CREDIT_LIMIT_SET; one pending document per customer and type. `GET /credit-limits?brnch=&status=`; `POST /credit-limits/{brnch}/{serno}/approve` · `/reject` `{ comment? }` (`customer.credit_limit_approve`, maker ≠ checker) — approval writes the new limit to CREDIT_LIMITS (row created when missing).
- Lines (implemented instead of GET/PUT `/areas`, `/security`, `/bank-accounts`; lines are never deleted): `GET /customers/{brnch}/{code}/lines/{areas|security|bank-accounts}` (`customer.view`; security adds `securityTotal` of active lines, BR-CUS-06), `POST …/lines/{kind}` (`customer.update`; body `{ geoCode }` area or city · `{ description, amount }` · `{ bankCode, accountNo, branchName }`), `POST …/lines/{kind}/{key}/deactivate` · `/activate`. Contacts and notification preferences are fields of the customer (Contacts tab).

## 6. SRF

| Method | Path                                      | Permission   | Notes                                                                                                                                                      |
| ------ | ----------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/srf?brnch=&status=&customer=&from=&to=` | `srf.view`   |                                                                                                                                                            |
| GET    | `/srf/{brnch}/{srfNo}`                    | `srf.view`   |                                                                                                                                                            |
| POST   | `/srf`                                    | `srf.create` | DRAFT                                                                                                                                                      |
| PUT    | `/srf/{brnch}/{srfNo}`                    | `srf.update` | DRAFT only                                                                                                                                                 |
| POST   | `/srf/{brnch}/{srfNo}/submit`             | `srf.create` | Creates draft OC → `{ srf, ocNo }` (BR-SRF-05)                                                                                                             |
| POST   | `/srf/{brnch}/{srfNo}/cancel`             | `srf.cancel` | Reason; cancels draft OC                                                                                                                                   |
| POST   | `/srf/{brnch}/{srfNo}/contract-review`    | `srf.print`  | Queues the Contract Review Form PDF (worker) → 202 `{ outboxId, entityKey }`; the file then appears in `GET /files?entity=SALES_REQUEST_MASTER&key={brnch} | {srfNo}` |

Built 23 Nov 2026. `PUT`, `submit` and `cancel` need `If-Match` (ETag from GET). Create body = the body below + `destGeoCode` (destination city, required: the draft OC takes the trade price of customer + product + this city on the submit date; no trade price → OC built with zero prices, BR-OC-02 override). `qtyTon` and schedule quantities have up to 2 decimals (legacy NUMBER(8,2)). `taxProfile` fields and `doHandoverTo` default from the customer when left empty (BR-SRF-04). Response = SRF with `srfNo` (string), `status`, `rowVer`, `contractValidTo` (BR-SRF-07), `ocNo`, `schedule`. Submit → `{ srf, oc: { ocNo, priced, priceCode, value } }`. Legacy SRFs without DOC_STATUS read as CONVERTED (an OC exists) or SUBMITTED.

`GET /files?entity=&key={brnch}|{no}` (print permission of the entity) lists a document's stored files `{ items: [{ attId, fileName, sizeBytes, uploadedOn }] }`; download with `GET /files/{attId}`.

SRF body (create):

```json
{
  "brnch": 1,
  "srfDate": "2026-11-19",
  "customerCode": "499-343",
  "productCode": "OPC",
  "bagCode": 3,
  "bagColour": 1,
  "qtyTon": "35.000",
  "bags": 700,
  "modeOfDelivery": "BAGS",
  "modeOfTransport": "003",
  "localExport": "L",
  "termOfSale": "A",
  "specialInstructions": "P.P. bag",
  "taxProfile": { "stType": "R", "strn": "...", "ntn": "...", "cnic": null },
  "doHandoverTo": "Mr. Aslam",
  "schedule": [
    { "srNo": 1, "date": "2026-11-20", "qtyTon": "17.500" },
    { "srNo": 2, "date": "2026-11-22", "qtyTon": "17.500" }
  ],
  "export": null
}
```

## 7. OC

| Method | Path                                                | Permission                                  | Notes                                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/oc?brnch=&status=&customer=&from=&to=&short=true` | `oc.view`                                   | `short=true` = approved but balance short                                                          |
| GET    | `/oc/{brnch}/{ocNo}`                                | `oc.view`                                   | Includes `masterPrices`, `priceOverride`, `balance` (if permitted), linked BRVs, DOs               |
| PUT    | `/oc/{brnch}/{ocNo}`                                | `oc.update`                                 | DRAFT/REVIEWED; any field (BR-OC-02); server recomputes breakdown                                  |
| POST   | `/oc/{brnch}/{ocNo}/price-preview`                  | `oc.view`                                   | Body = proposed prices → breakdown (no save)                                                       |
| POST   | `/oc/{brnch}/{ocNo}/review`                         | `oc.review`                                 |                                                                                                    |
| POST   | `/oc/{brnch}/{ocNo}/approve` · `/reject`            | `oc.approve`                                | If `priceOverride`, returns 422 `approval_required` unless the rule is satisfied                   |
| PUT    | `/oc/{brnch}/{ocNo}/brvs`                           | `oc.update`                                 | `[{ receiptNo, cashCheqCd, amount }]` verified BRVs only                                           |
| POST   | `/oc/{brnch}/{ocNo}/confirm`                        | `oc.confirm`                                | BR-BAL check (locks customer) → creates DOs; 422 `rule_violation` `BR-OC-06` with `data.shortfall` |
| POST   | `/oc/{brnch}/{ocNo}/request-override`               | `oc.balance_override` / `oc.price_override` | `{ kind: "BALANCE"                                                                                 | "PRICE", reason }` → approval request |
| POST   | `/oc/{brnch}/{ocNo}/cancel`                         | `oc.cancel`                                 | Reason; cancels undispatched DOs                                                                   |
| POST   | `/oc/{brnch}/{ocNo}/duplicate`                      | `oc.create`                                 | New DRAFT                                                                                          |
| POST   | `/oc/{brnch}/{ocNo}/print`                          | `oc.print`                                  | 202 queued PDF; file under entity ORDER_CONFIRM, key brnch + ocNo (see below)                      |

Built 23 Nov 2026. Commands need `If-Match`. Additional endpoints: `GET /oc/{brnch}/{ocNo}/balance` (`customer.view_balance`): BalanceService result with `value` and `shortfall`. `GET /oc/{brnch}/{ocNo}` also returns `doTypes` (DELIVERY_ORDER_TYPE rows of the OC product, the customer's last used first) and `linkableBrvs` (verified/cleared BRVs of the customer with money not yet applied). `PUT /oc/{brnch}/{ocNo}` body = `{ qtyTon, prices: { retailPrice, tradeDisc, salesTax, fed, consPrice, expense, discount }, remarks, schedule }`; a price that differs from `masterPrices` sets `priceOverride` = `Y` (pending; `A` once the OC_PRICE_OVERRIDE request is approved; `N` none). `PUT …/brvs` body = `{ links: [{ receiptNo, amount }] }` (CASH_CHEQ_CD is always Q); the BRV's `APPLIED_AMT` is kept. Confirm body = `{ doType }` (required: DO type of the OC product). The DO number continues the single DOC_SEQUENCE `DO` counter until Finance confirms the per-type sub-series (SCHEMA §4). Print: `POST …/print` queues the PDF (file in `GET /files?entity=ORDER_CONFIRM&key={brnch}|{ocNo}`) (price breakdown with overridden prices marked, schedule, BRVs, DOs; terms from PRINT_TEXT `OC_TERMS`; DRAFT watermark before approval, CANCELLED after cancel).

Confirm response:

```json
{
  "oc": { "brnch": 1, "ocNo": 10234, "status": "CONFIRMED" },
  "dos": [
    {
      "doType": "OS",
      "doNo": 22702000101,
      "qtyTon": "17.500",
      "rate": "24300.0000",
      "value": "425250.00",
      "pdfUrl": "/api/v1/do/1/OS/22702000101/print.pdf"
    }
  ],
  "balanceAfter": "-1240500.00"
}
```

## 8. BRV

| Method | Path                                             | Permission   | Notes                                                                                                         |
| ------ | ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/brv?brnch=&status=&customer=&bank=&from=&to=`  | `brv.view`   |                                                                                                               |
| GET    | `/brv/verification-queue?brnch=&bank=&from=&to=` | `brv.verify` | ENTERED, oldest first                                                                                         |
| GET    | `/brv/{brnch}/{receiptNo}`                       | `brv.view`   | + `linkedOcs` (ORDER_CONFIRM_BRV)                                                                             |
| POST   | `/brv`                                           | `brv.create` | ENTERED                                                                                                       |
| PUT    | `/brv/{brnch}/{receiptNo}`                       | `brv.update` | ENTERED only                                                                                                  |
| POST   | `…/verify`                                       | `brv.verify` | `{ method, bankRef, remarks }`; maker-checker; posts ledger                                                   |
| POST   | `…/bounce`                                       | `brv.bounce` | `{ reason, returnDate }`; returns impacted OCs/DOs                                                            |
| POST   | `…/clear`                                        | `brv.verify` | `{ clearDate }`; VERIFIED → CLEARED (no ledger effect)                                                        |
| POST   | `…/cancel`                                       | `brv.cancel` | `{ reason }`; ENTERED only (BR-BRV-06)                                                                        |
| POST   | `…/receipt`                                      | `brv.print`  | Queues the receipt PDF → 202 `{ outboxId, entityKey }`; file in `GET /files?entity=CASH_CHEQUE_RECEIPTS&key=` |

Built 23 Nov 2026. Every BRV has `CASH_CHEQ_CD = 'Q'` (all legacy rows), so paths use `{brnch}/{receiptNo}`. Commands need `If-Match`. Body: `{ brnch (create only), brvDate, customerCode, instCode, category (CATEGORY_TYPE A–D), bankCode (customer's bank), chequeNo, chequeDate, depositAccount (COMPANY_BANK code, required), amount, salesTax, tax, freight, fundFrom, transporter, depositor, city, remarks }`. Verify credits the DO and DC ledgers (entry date = BRV date); bounce returns `{ brv, impact: { releasedOcs, confirmedOcs } }`: links of OCs not yet confirmed are set to 0 (`ORDER_CONFIRM_BRV.AMOUNT`, never deleted), confirmed OCs are listed for the BR-PRC-08 follow-up (P2-07). Legacy BRVs read as VERIFIED (RETURN_CD P), CLEARED (C) or BOUNCED (R); `RETURN_CD` is kept in sync.

## 9. Permits

| Method | Path                                          | Permission                      | Notes                                                                 |
| ------ | --------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| GET    | `/permits?brnch=&status=&customer=&from=&to=` | `permit.view`                   |                                                                       |
| GET    | `/permits/{brnch}/{permitNo}`                 | `permit.view`                   | With areas, dispatch per area, adjustments                            |
| POST   | `/permits`                                    | `permit.create`                 | DRAFT with `areas[]` (rate auto from sheet, editable → override flag) |
| PUT    | `/permits/{brnch}/{permitNo}`                 | `permit.update`                 | DRAFT                                                                 |
| POST   | `…/issue`                                     | `permit.issue`                  | BR-BAL; 422 with shortfall                                            |
| POST   | `…/send-cfo`                                  | `permit.send_cfo`               | → PENDING_CFO (approval request PERMIT_CFO)                           |
| POST   | `…/request-override`                          | `permit.balance_override`       |                                                                       |
| POST   | `…/adjust`                                    | `permit.adjust`                 | `{ lines: [{ lnkno, qtyTon }], reason }`                              |
| POST   | `…/cancel`                                    | `permit.cancel`                 | Reason                                                                |
| POST   | `…/print` · `…/send`                          | `permit.print` / `permit.share` | Print (queued PDF) · send to dealer (BR-NTF)                          |

Built 23 Nov 2026. Permit numbers carry the branch suffix (`20272301.2`, BR-PMT-08; legacy Hattar permits end in `.1`: to confirm). `GET /permits/city-rates?product=&date=` → `{ sheet: { serno, date }, lines: [{ areaDoc, areaName, booking, freight, rate }] }` with rate = sheet booking − last freight rate (legacy CRATE). Body: `{ brnch (create), permitDate, customerCode, productCode, validTo?, areas: [{ areaDoc, qtyTon, rate? }] }`; a rate different from the sheet is stored with `RATE_OVERRIDE = 'Y'` and `SHEET_RATE`. `issue` → `{ permit, balanceAfter }` or 422 BR-PMT-02 with `data.shortfall`; `PERMIT_CFO_QTY` (setting) forces an approved CFO request first. `send-cfo` → PENDING_CFO; the CFO's approval returns the permit to DRAFT with `cfoReqId`. `request-override` = PERMIT_BALANCE_OVERRIDE. `adjust` writes PERMIT_ADJ_CITY rows (delta qty/amount) and a DO-ledger `DOA` row. `POST …/print` queues the PDF (file in `GET /files?entity=PERMIT_MST_CITY&key=`). Legacy permits read as ISSUED. `POST …/send` body `{ channels: [SMS|WHATSAPP|EMAIL] }` → `{ outboxIds }` (ISSUED / PARTLY_DISPATCHED only; PERMIT_ISSUED template; channels without a number/e-mail are skipped; sets `sentToDealerOn`).

## 10. DOs and re-pricing

| Method | Path                                                          | Permission        | Notes                                                  |
| ------ | ------------------------------------------------------------- | ----------------- | ------------------------------------------------------ |
| GET    | `/do?brnch=&status=&customer=&oc=&from=&to=&outstanding=true` | `do.view`         |                                                        |
| GET    | `/do/{brnch}/{doType}/{doNo}`                                 | `do.view`         | With dispatch history, QR version                      |
| POST   | `…/print`                                                     | `do.print`        | Queued PDF; watermark when cancelled / on hold         |
| POST   | `…/send`                                                      | `do.resend`       | `{ channels: ["SMS","WHATSAPP","EMAIL"] }`             |
| POST   | `…/cancel`                                                    | `do.cancel`       | Reason                                                 |
| POST   | `…/adjust`                                                    | `do.adjust`       | DO adjustment advice → approval                        |
| GET    | `/do-adjustments?brnch=&status=&doNo=&customer=`              | `do.view`         | Advices (legacy rows read as APPROVED)                 |
| POST   | `…/hold` · `…/release`                                        | `do.hold_release` |                                                        |
| POST   | `/reprice/preview`                                            | `do.reprice`      | `{ brnch, priceCode?                                   | customer?, product, region?, newRate, effectiveFrom }` → open DOs past lock with shortfall |
| POST   | `/reprice/apply`                                              | `do.reprice`      | Puts listed DOs ON_HOLD with shortfall; notifies sales |

Built 23 Nov 2026 (DO part): list (`outstanding=true` = ISSUED/PARTLY_DISPATCHED/ON_HOLD), get, `POST …/print` (queues the PDF → 202 `{ outboxId, entityKey }`, file in `GET /files?entity=DELIVERY_ORDER&key={brnch}|{doType}|{doNo}`; QR payload docNo = `{doType}-{doNo}`), `…/send` (queues `DO_SEND` per channel; delivered with P2-09), `…/cancel` → `{ do, requestId, released }` (approval rule DO_CANCEL when active; on approval the undispatched value is credited to the DO ledger), `…/hold` `{ reason, shortfall? }`, `…/release` (back to ISSUED or PARTLY_DISPATCHED). Commands need `If-Match`. Legacy DOs: CANCEL_CODE 'Y' = cancelled, otherwise status from DISPATCHED vs DO_QUANTITY. `…/adjust` (BR-DO-06) body `{ qtyTon, reason }` (new quantity, ≥ dispatched, > 0) → `{ advice, requestId, do }`: writes a DO_ADJUSTMENT advice (number from DOC_SEQUENCE DOA, `ADVICE_YR` = calendar year as the legacy rows, QUANTITY/AMOUNT = signed difference, `ADJUST_REASON`) and asks the DO_ADJUST approval (default approver Finance Manager, to confirm); applied at once when no rule is active. On approval: DO_QUANTITY, DO_VALUE, NO_OF_BAGS change, QR_VER + 1 (reprint, BR-QR-03), DO ledger `DOA` Dr increase / Cr reduction; an increase needs the available balance (422 `BR-BAL-03` with `data.shortfall`). One pending advice per DO (409). A DO without a rate (legacy) cannot be adjusted.

## 11. Plant

All plant POSTs require `Idempotency-Key`. Plant users and devices only see their branch.

| Method   | Path                                                | Permission           | Notes                                                                                  |
| -------- | --------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| GET      | `/plant/board?brnch=`                               | `gate.view`          | Gate passes by status + wait minutes (also via SSE)                                    |
| GET      | `/plant/offline-cache?brnch=`                       | `gate.view`          | Open DOs/permits with remaining qty, holds, QR versions; ETag-based                    |
| POST     | `/plant/scan`                                       | `gate.view`          | `{ qr }` → document card or 422 (`BR-QR-02`)                                           |
| POST     | `/plant/gate-passes`                                | `gate.in`            | Gate-in: `{ route, docs: [{ doType, doNo, plannedBags                                  | plannedTon }] or [{ permitNo, lnkno, plannedBags }], vehicleNo, driver: { cnic, name, mobile }, transpCode, biltyNo, packingType, clientId? }`→`{ gpId, dcNo | dmNos, plannedKg, printUrl }` |
| GET      | `/plant/gate-passes/{gpId}`                         | `gate.view`          | Full state incl. weights, variance, invoices, FBR                                      |
| PUT      | `/plant/gate-passes/{gpId}/dc`                      | `dc.update`          | Bag supplier, bag brand, container/seal before invoice                                 |
| POST     | `/plant/gate-passes/{gpId}/tare`                    | `weigh.capture`      | `{ readingId }` (from agent) or manual `{ weightKg, reason }` with `weigh.manual`      |
| POST     | `/plant/gate-passes/{gpId}/gross`                   | `weigh.capture`      | Same; response includes `net`, `variance`, `varianceStatus`, and invoices if finalised |
| POST     | `/plant/gate-passes/{gpId}/request-weight-override` | `weigh.override`     | Reason → approval WEIGHT_OVERRIDE                                                      |
| POST     | `/plant/gate-passes/{gpId}/reweigh`                 | `weigh.capture`      | Opens a new gross weighing (history kept)                                              |
| POST     | `/plant/gate-passes/{gpId}/exit`                    | `gate.exit`          | Checklist BR-EXIT-02; 422 lists missing items                                          |
| POST     | `/plant/gate-passes/{gpId}/request-exit-override`   | `gate.exit_override` | Only when `ALLOW_EXIT_WITHOUT_FBR` = Y                                                 |
| POST     | `/plant/gate-passes/{gpId}/abort`                   | `gate.abort`         | Before invoice; cancels DC/DMs (BR-DC-CXL-01)                                          |
| POST     | `/plant/dc/{brnch}/{dcType}/{dcNo}/cancel`          | `dc.cancel`          | After invoice, before FBR → approval DC_CANCEL                                         |
| GET      | `/plant/dc/{brnch}/{dcType}/{dcNo}/print.pdf`       | `dc.print`           | DC + gate pass QR                                                                      |
| POST     | `/plant/weigh-readings`                             | device (weighbridge) | Agent: `{ deviceId, readingId, weightKg, stable, readOn, signature }` (built P3-02)    |
| POST     | `/plant/sync`                                       | `sync.push`          | Batch `{ events: [{ clientId, type: GATE_IN                                            | TARE                                                                                                                                                         | GROSS                         | EXIT, payload, deviceTime }] }`→`[{ clientId, status: APPLIED | DUPLICATE | CONFLICT, result }]` |
| GET/POST | `/plant/sync-conflicts`, `…/{id}/resolve`           | `sync.resolve`       |                                                                                        |

Scan, lookup, offline cache (built 23 Nov 2026, P3-03). `POST /plant/scan` `{ qr }` (`gate.view`, also gate tablets) → document card `{ docType: DO|PMT, docNo (QR form: DO `{doType}-{doNo}`, permit `{no}.{b}`), brnch, ver, status, customer…, productCode, destName, qtyTon, remainingTon, holdReason, areas[] }`, or 422 with `data.reason`: MALFORMED, BAD_SIGNATURE, UNKNOWN, WRONG_BRANCH (`BR-QR-02`), OLD_VERSION (`BR-QR-03`, a newer print exists), ON_HOLD (with `data.card`), NOT_OPEN. `POST /plant/lookup` `{ docType, docNo, reason }` (`gate.manual_lookup`, BR-GATE-01, audited MANUAL_LOOKUP) → `{ items: [card] }` (all DO types with that number). `GET /plant/offline-cache` (`gate.view`, gate tablets) → `{ brnch, generatedAt, refreshMin (OFFLINE_CACHE_MIN), etag, entries: [{ docType, docNo, ver, sig, status, …, remainingTon, areas }] }`: new-system open DOs (incl. ON_HOLD) and permits; `sig` = the QR signature of the current print, so the tablet checks a scanned QR with `offlineQrCheck` (`@dcl/shared`) without the QR secret (BR-OFF-02). `If-None-Match` → 304. Legacy prints have no signed QR: manual lookup.

Gate-in (built 23 Nov 2026, P3-04, **DO route**): `POST /plant/gate-passes` (`gate.in`, `Idempotency-Key` required) body `{ route: "DO", packingType: BAG|BULK, vehicleNo, driver: { cnic, name, mobile }, transpCode, biltyNo?, docs: [{ doType, doNo, plannedBags (BAG) | plannedTon (BULK) }], clientId? }` → 201 gate pass with `dcNo` and `lines` (DC issued: FH_DELIVERY_CHALLAN header DOC_STATUS ISSUED + FH_DEL_CHALLAN_DETAIL per DO with PLANNED_BAGS/PLANNED_TON, LINE_STATUS ISSUED); same `clientId` again → 200 `replay: true`. 422: `BR-GATE-02` bilty (BILTY_REQUIRED), `BR-GATE-04` vehicle has an open gate pass (`data.gpId`), `BR-GATE-03` customer/DO type/destination differ, `BR-DC-02` planned > undispatched − already planned on open gate passes (+ WEIGHT_TOLERANCE_KG), `BR-DO-07` held DO. DEST_AREA/CITY_CD = the destination city's legacy code; FH_DELIVERY_CHALLAN.VEHICLE_NO is cut to its 10 characters (GATE_PASS keeps the full number). Driver CNIC is returned masked. `route: "PMT"` → 501 until the delivery-memo mapping is confirmed. `GET /plant/gate-passes/{gpId}` (`gate.view`, other branch → 404), `GET /plant/board` → `{ items: [gate pass + waitMin] }` (open gate passes of the session branch, oldest first).

Weighing (built 23 Nov 2026, P3-05): `POST /plant/gate-passes/{gpId}/tare` · `/gross` · `/reweigh` (`Idempotency-Key` required) body `{ deviceId, readingId }` (agent reading, needs `weigh.capture`; a reading is used once → 409) or `{ weightKg, reason }` (needs `weigh.manual`, SOURCE MANUAL, BR-WGT-02). Tare: IN → TARE_DONE, response `{ gatePass, warnings }` (BR-WGT-03 warning when > TARE_WARN_KG from the vehicle's last tare). Gross: TARE_DONE → GROSS_DONE, or VARIANCE_BLOCKED when |net − planned| > WEIGHT_TOLERANCE_KG; response `{ gatePass, net, variance, variancePct, direction: OVER|UNDER|EXACT, varianceStatus: OK|BLOCKED, toleranceKg }`; gross ≤ tare → 422 `BR-WGT-03`; the net is split over the DC lines (ALLOC_NET_KG, largest remainder, BR-WGT-06), DC header W_TARE/WT_GROSS/NET_KG/VARIANCE_KG/QTY_VERIFIED (t) and DOC_STATUS WEIGHED. `/reweigh`: new gross only while VARIANCE_BLOCKED (earlier tickets stay). `POST …/request-weight-override` `{ reason }` (`weigh.override`) → `{ gatePass, requestId }`; approval WEIGHT_OVERRIDE (another plant manager) → OVERRIDDEN. Every reading is a WEIGH_TICKET row.

Invoices (built 23 Nov 2026, P3-06, DO route): a gross within tolerance (or an approved override) finalises at once one SALES_INVOICE per DC line (BR-INV-01): number from DOC_SEQUENCE INV (consecutive), quantity per INVOICE_QTY_BASIS (allocated net weight / planned bags), tax by `invoiceTax` (`@dcl/shared`, reproduces invoice 8445) from the effective product period (MRP, ST%, FED/ton) and the customer's WHT rate (TAX_RATE, section "-", filer status); DO DISPATCHED_TON and status; DC ledger Dr SALE + Dr WHT, DO ledger MEMO; DC header INVOICE_NO/INVOICE_DATE/DOC_STATUS INVOICED; outbox `FBR_SUBMIT` per invoice; gate pass INVOICED. The gross / override responses carry `invoices` and `invoiceProblem` (`{ code, detail, ruleId }` when a master is missing, e.g. `BR-TAX-05` no WHT rate or `BR-TAX-10` no product period: the weighing is kept, the gate pass stays GROSS_DONE/OVERRIDDEN). `POST /plant/gate-passes/{gpId}/finalise` (`weigh.capture` or `dc.update`) retries. `GET /plant/gate-passes/{gpId}` lists `invoices`. Invoice rate per ton = DO_RATE (default to confirm).

Exit (built 23 Nov 2026, P3-08): `POST /plant/exit-scan` `{ qr }` (`gate.exit`; gate-pass QR `DCL|GP|{brnch}|{gpId}|1|sig`, printed with P3-11) and `GET /plant/gate-passes/{gpId}/exit-check` → `{ gatePass, checklist: { ok, missing[], fbrPendingOnly }, invoices }`. `POST …/exit` (`gate.exit`) → EXITED (DC DOC_STATUS CLOSED, dealer message TRUCK_EXITED, migration 017 templates) or 422 `BR-EXIT-02` with `data.missing`, `fbrPendingOnly`, `overrideAllowed`. `POST …/request-exit-override` `{ reason }` (`gate.exit_override`): only when just FBR numbers are missing and ALLOW_EXIT_WITHOUT_FBR = Y (OPEN-Q3, default N) → approval EXIT_WITHOUT_FBR; once approved the exit goes through (audit EXIT_OVERRIDE).

Weigh readings (built 23 Nov 2026, P3-02): device token of a WEIGHBRIDGE device of the branch; `signature` = HMAC-SHA256(secret, `DCL-WGT|{deviceId}|{readingId}|{weightKg}|{1|0}|{readOn}`) base64url; `weightKg` integer; only stable readings (422 `BR-WGT-01`), `readOn` not more than 5 min ahead of server time. 201 `{ readingId, receivedOn, duplicate: false }`; the same reading again → 200 `duplicate: true`; same id with another weight → 409. Stored in DEVICE_READING; the tare/gross commands take the reading id (P3-05).

Gross response example (variance blocked):

```json
{
  "gpId": 88123,
  "status": "VARIANCE_BLOCKED",
  "weights": {
    "tareKg": 14820,
    "grossKg": 50110,
    "netKg": 35290,
    "plannedKg": 35000,
    "varianceKg": 290,
    "variancePct": "0.829",
    "varianceStatus": "OVER"
  },
  "toleranceKg": 100,
  "actions": ["REWEIGH", "REQUEST_WEIGHT_OVERRIDE"]
}
```

## 12. Invoices & FBR

| Method | Path                                                      | Permission          | Notes                                                   |
| ------ | --------------------------------------------------------- | ------------------- | ------------------------------------------------------- |
| GET    | `/invoices?brnch=&customer=&from=&to=&status=&fbrStatus=` | `invoice.view`      |                                                         |
| GET    | `/invoices/{brnch}/{year}/{invoiceNo}`                    | `invoice.view`      | Full tax breakdown + FBR info                           |
| GET    | `…/print.pdf`                                             | `invoice.print`     | Commercial/Excise/Sales Tax Invoice with FBR QR         |
| GET    | `…/fbr-submissions`                                       | `invoice.fbr_view`  | Attempts with request/response                          |
| POST   | `…/fbr-retry`                                             | `invoice.fbr_retry` | Re-queue (FBR_REJECTED after correction or FBR_PENDING) |

Built 23 Nov 2026 (P3-07): `GET /invoices?brnch=&status=&customer=&from=&to=` (status = FINAL / FBR_PENDING / FBR_ACCEPTED / FBR_REJECTED / CANCELLED; rows carry `fbrInvoiceNo` and, when rejected, `fbrError` = FBR's text), `GET /invoices/{brnch}/{year}/{invoiceNo}`, `GET …/fbr-submissions` → `{ items: [{ attemptNo, env, request, response, httpStatus, result: SENT|ACCEPTED|REJECTED|ERROR|TIMEOUT|UNKNOWN, fbrInvoiceNo, errorCode, errorMsg, durationMs }] }`, `POST …/fbr-retry` `{ confirmNotAccepted? }` → `{ outboxId }`. Submission runs in the worker (queue `fbr`): payload from the stored invoice (`buildFbrPayload`, `@dcl/shared`), POST {FBR_BASE_URL}/di_data/v1/di/postinvoicedata(_sb) with the branch token; no base URL outside PRODUCTION = mock driver (number `MOCK…`). The attempt is stored as SENT before the call; a SENT attempt (worker stopped mid-call) blocks automatic resend and `fbr-retry` answers 422 `BR-FBR-05` until `confirmNotAccepted: true` (Finance checked the FBR portal). Missing seller settings / buyer NTN → FBR_REJECTED "Not sent: missing …" without calling FBR. Print with FBR QR: P3-11. The field mapping and sale type must be verified in the FBR sandbox with DCL's token.

## 13. Ledger

| Method | Path                                    | Permission     | Notes                                                 |
| ------ | --------------------------------------- | -------------- | ----------------------------------------------------- |
| GET    | `/ledger/{brnch}/{customerCode}?type=DO | DC&from=&to=`  | `ledger.view`                                         | `{ opening, lines: [{ entryDate, docType, docNo, narration, debit, credit, running, link }], closing, totals }` |
| GET    | `/ledger/recon?brnch=&date=`            | `ledger.recon` | Last nightly reconciliation result (P5-10, BR-LED-02) |

Statement (built 23 Nov 2026): `GET /ledger/{brnch}/{customerCode}?type=DC|DO&from=YYYY-MM-DD&to=YYYY-MM-DD` (type defaults to DC) → `{ brnch, customerCode, customerName, ledgerType, from, to, opening, lines: [{ ledgerId, entryDate, docType, docYear, docNo, docLine, entryKind, narration, debit, credit, running, qtyTon, glCode, reversalOf }], totals: { debit, credit }, closing }`. Running = previous + debit − credit (positive = receivable, negative = advance). More than 5,000 lines in the range → 422 (choose a shorter range). Ledger rows are written only by the document services, inside their own transaction (`ledger.post`); there is no POST endpoint.

## 14. Notes, transfers, incentives, targets

| Method       | Path                                                                                        | Permission                           | Notes                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| GET          | `/notes?brnch=&kind=C                                                                       | D&type=&customer=&from=&to=&status=` | `note.view`                                                                                   |                                               |
| POST         | `/notes`                                                                                    | `note.create`                        | `{ kind, noteType, customerCode, date, lines: [{ particular, amount, whtPct }], invoiceId? }` |
| POST         | `/notes/transfer`                                                                           | `note.transfer`                      | `{ fromCustomer, toCustomer, amount, date, particular }`                                      |
| POST         | `/notes/{brnch}/{srlNo}/submit` · `/approve` · `/reject` · `/post` · `/reverse` · `/cancel` | create / approve / post / reverse    |                                                                                               |
| GET/POST     | `/incentives/schemes`, `/incentives/schemes/{brnch}/{srlNo}`                                | `incentive.view` / `incentive.run`   |                                                                                               |
| POST         | `/incentives/runs/preview`                                                                  | `incentive.run`                      | `{ schemeId                                                                                   | targetMonth, period }` → per customer amounts |
| POST         | `/incentives/runs/commit`                                                                   | `incentive.commit`                   | Creates DRAFT credit notes (BR-INC-03)                                                        |
| GET/POST/PUT | `/targets`, `/targets/{brnch}/{serno}`                                                      | `target.view` / `target.update`      |                                                                                               |
| GET          | `/targets/{brnch}/{serno}/achievement`                                                      | `target.view`                        |                                                                                               |

Cancellation advices (P2-08, built 23 Nov 2026): `GET /cancellations?kind=order|receipt&brnch=` (`do.view` / `brv.view`) → paged `{ kind, adviceNo, date, customerCode, customerName, amount, … }`. Advices are written by the cancel / bounce commands; BRV bounce responses include `impact.adviceNo`.

## 15. Approvals & notifications

Admin texts (built 23 Nov 2026): `GET|PUT /admin/templates` (`admin.templates`; body `{ templateCode, channel: SMS|WA|EMAIL, scope: 0|1|2, subject?, body, active }`) and `GET|PUT /admin/print-texts` (`admin.print_texts`; body `{ textCode, srNo, scope: 0|1|2, body, active }`); upsert only, never deleted. Dealer messages are queued by the document commands (BRV verify, OC confirm per DO, DO send, permit issue) per customer preference.

| Method | Path                                                                                | Permission            | Notes                                                                                             |
| ------ | ----------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/approvals/inbox?status=PENDING`                                                   | `approval.inbox`      | Requests whose current level role ∈ user's roles in that branch                                   |
| GET    | `/approvals/sent`                                                                   | auth                  | Own requests                                                                                      |
| GET    | `/approvals/{reqId}`                                                                | inbox/requester       | Snapshot + history                                                                                |
| POST   | `/approvals/{reqId}/approve` · `/reject`                                            | role at current level | `{ comment }`; maker-checker; on final approval the service executes the pending action in one tx |
| POST   | `/approvals/{reqId}/cancel`                                                         | requester             |                                                                                                   |
| GET    | `/notifications` · POST `/notifications/{id}/read` · POST `/notifications/read-all` | auth                  | In-app bell                                                                                       |
| GET    | `/events` (SSE)                                                                     | auth                  | Channels: `plant.board`, `approvals`, `notifications`, `dashboard.*` (branch-scoped)              |

## 16. Reports, sharing, dashboards

| Method  | Path                                              | Permission                        | Notes                                                                                 |
| ------- | ------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| GET     | `/reports/{code}?brnch=&from=&to=&customer=&…`    | `report.<code>`                   | JSON for on-screen grid (code r1…r13)                                                 |
| POST    | `/reports/{code}/render`                          | `report.<code>` + `report.export` | `{ format: "pdf"                                                                      | "xlsx", params }` → job id                                                         |
| GET     | `/jobs/{jobId}`                                   | owner                             | `{ status, progress, fileUrl }`                                                       |
| POST    | `/share/email`                                    | `report.share` or `<doc>.share`   | `{ source: { kind: "report"                                                           | "doc", code, params }, to[], cc[], bcc[], subject, body }` (sent from user's SMTP) |
| POST    | `/share/whatsapp-link`                            | same                              | → `{ link, message, waUrl: "https://wa.me/92XXXXXXXXXX?text=…" }` (user presses Send) |
| GET     | `/share/log?…`                                    | `report.share`                    | SHARE_LOG                                                                             |
| GET     | `/s/{token}`                                      | public                            | PDF download (7-day token, rate-limited) — served by API under a short public path    |
| GET     | `/dashboards/{sales                               | plant                             | management}?brnch=`                                                                   | `dashboard.*`                                                                      | KPIs + series |
| GET/PUT | `/me/mail-account` · POST `/me/mail-account/test` | auth                              | User SMTP (spec 10.4)                                                                 |

## 17. Health & ops

| Method | Path            | Notes                              |
| ------ | --------------- | ---------------------------------- |
| GET    | `/health/live`  | Process up                         |
| GET    | `/health/ready` | DB + Redis ping                    |
| GET    | `/metrics`      | Prometheus (internal network only) |
