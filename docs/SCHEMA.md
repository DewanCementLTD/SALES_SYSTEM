# SCHEMA.md

Database: Oracle (target 19c; SQL must stay 11g-compatible). Schema owner on the test server: `SALES_NEW`. App connects as a separate least-privilege user (`SALES_APP`, ARCHITECTURE §7).

| Layer                       | File                                                                | What                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified legacy-named schema | `db/01_DCL_SALES_TABLES.sql`                                        | 174 tables, Karachi names, BRNCH/COMPC on every table                                                                                         |
| Legacy data load            | `db/02_DCL_SALES_LOAD_DATA.sql`, `db/02_LOAD_TRANSACTIONS_ONLY.sql` | From SCLKHI (BRNCH 1) and SCLISB (BRNCH 2), with reconciliation                                                                               |
| Keys after load             | `db/03_DCL_SALES_KEYS_AFTER_LOAD.sql`                               | 85 FKs + 63 UKs, `ENABLE NOVALIDATE`                                                                                                          |
| Cleanup                     | `db/04_CLEANUP_DUPLICATES.sql`                                      | Duplicates found by 03 (already run on test)                                                                                                  |
| **New system**              | `db/05_NEW_SYSTEM_TABLES.sql`                                       | New tables + columns described below                                                                                                          |
| Legacy tables not in 01     | `db/migrations/001_LEGACY_TABLES_NOT_HOSTED.sql`                    | 9 tables for legacy business data that 01 had no home for (§2.2)                                                                              |
| Extra legacy load           | `db/02c_LOAD_LEGACY_EXTRA.sql`                                      | Loads the 001 tables, rescues rows found only in legacy backup copies, fills derivable columns; own reconciliation                            |
| Geography                   | `db/migrations/002_GEO_HIERARCHY.sql` + `db/02d_LOAD_GEO.sql`       | One 4-level geography Zone → Territory → Area → City for both branches, LEGACY_MAP, customer placement (§2.3)                                 |
| Master flags                | `db/migrations/003_MASTER_FLAGS.sql`                                | `ACTIVE`, `ROW_VER`, `UPDATED_BY/ON` on 16 simple masters; `CHANNEL_DESC.REPORT_GROUP` (§2.6)                                                 |
| Geography editing           | `db/migrations/004_GEO_EDIT.sql`                                    | `ROW_VER`, `UPDATED_BY/ON` on GEO_HIERARCHY; app-created nodes: `SOURCE_TABLE = 'APP'`, `LEGACY_CODE = '-'`                                   |
| Customer blocks             | `db/migrations/005_CUSTOMER_BLOCK.sql`                              | CUSTOMER_BLOCK history (BLOCK/UNBLOCK, stop dispatch, reason, who/when); legacy BLOCK_CUSTOMER read-only                                      |
| Customer lines              | `db/migrations/006_CUSTOMER_LINES.sql`                              | LINE_ID + ACTIVE on CUSTOMER_AREA / SECURITY_DEPOSIT, CUSTOMER_AREA.GEO_CODE (Hattar rows mapped via LEGACY_MAP), ACTIVE on CUSTOMER_BANK_ACC |
| Tax rates                   | `db/migrations/007_TAX_RATE.sql`                                    | TAX_RATE: effective-dated WHT % by filer status / section, BRNCH 0 = both, PENDING_APPROVAL → APPROVED/REJECTED                               |
| Reports for the business    | `db/reports/*.csv`                                                  | `FED_RATE_REVIEW.csv` (Finance), `KHI_CUSTOMERS_WITHOUT_GEO.csv` + `GEO_CODES_KARACHI.csv` (Sales)                                            |
| Later changes               | `db/migrations/NNN_*.sql`                                           | Every change after 05, recorded in `SCHEMA_VERSION`                                                                                           |
| Column-level reference      | `docs/reference/LEGACY_TABLES.md`                                   | All 174 tables with columns, PK/UK/FK (generated)                                                                                             |
| Column usage                | `docs/reference/COLUMN_USAGE.md`                                    | Which columns are never used in legacy data, which only in history (census 19 Nov 2026)                                                       |
| Data check                  | `db/CHECK_TABLE_DATA.sql`                                           | Read-only: rows per table and branch, ERR$ rows, empty-table source check, orphans                                                            |

---

## 1. Conventions

| Topic            | Rule                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Names            | UPPER_SNAKE, ≤ 30 characters. Legacy names are never changed. New tables use clear English names.                                                                                                        |
| Branch           | Every business table has `BRNCH` (1 Karachi, 2 Islamabad/Hattar) and `COMPC` (1). Every key starts with `BRNCH` (legacy) — new tables use a technical id plus `BRNCH` column and branch-leading indexes. |
| Technical ids    | New tables: `NUMBER` id from `SEQ_<TABLE>.NEXTVAL` in the INSERT. No triggers.                                                                                                                           |
| Document numbers | From `DOC_SEQUENCE (BRNCH, YEAR, DOC_TYPE)` with `SELECT … FOR UPDATE` inside the business transaction (BR-NUM). Never from sequences.                                                                   |
| Status           | New `DOC_STATUS VARCHAR2(20)` on documents = source of truth (values in BUSINESS_RULES §12). Legacy flags (`CANCEL_CODE`, `CANCEL_FLAG`, `POST`, `APPROVED`) kept in sync by the repo layer.             |
| Optimistic lock  | `ROW_VER NUMBER DEFAULT 1 NOT NULL` on every row the app edits; `UPDATE … SET ROW_VER = ROW_VER + 1 WHERE … AND ROW_VER = :ver`.                                                                         |
| Who/when         | `CREATED_BY/ON`, `UPDATED_BY/ON` (user id string), `CANCEL_REASON/CANCELLED_BY/CANCELLED_ON`.                                                                                                            |
| Money            | `NUMBER(16,2)` in new columns (legacy `NUMBER(14,2)` kept). Rates `NUMBER(16,4)`.                                                                                                                        |
| Quantity         | Tons `NUMBER(12,3)` in new columns; weights `NUMBER(10)` kg. Legacy `DISPATCHED NUMBER(8,2)` is kept in sync (rounded) with the new `DISPATCHED_TON`.                                                    |
| JSON             | Stored as text (`CLOB` or `VARCHAR2(4000)`); parsed in Node (no Oracle JSON functions — 11g).                                                                                                            |
| Dates            | `DATE` (seconds); `TIMESTAMP` only in `AUDIT_LOG`. Server/session time zone Asia/Karachi.                                                                                                                |
| Booleans         | `CHAR(1)` `'Y'/'N'`.                                                                                                                                                                                     |
| Deletes          | None on business tables (app user has no DELETE grant).                                                                                                                                                  |

## 2. Existing tables the app uses (legacy names)

Core per module (full list and columns: `docs/reference/LEGACY_TABLES.md`, model diagram in requirements spec §13).

| Module             | Tables (read/write)                                                                                                                                                                | Notes                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Setup              | COMPANY, UNIT_MST, SALES_YEAR, DAYS_LOCK, BLOCK_DO_DATE, DOC_SEQUENCE, PRINT_TEXT, MSG_TEMPLATE, USER_MAIL_ACCOUNT, SHARE_LOG, GL_MAP, LEGACY_MAP                                  | DOC_SEQUENCE: `(BRNCH, YEAR, DOC_TYPE) → LAST_NO, PREFIX`                                                                          |
| Geography          | ZONE_DESC → TERRITORY → AREA (`AREA_DOC`); Karachi legacy MASTER_AREA → DISTRICT → CITY; REGION, REGION_DETAIL                                                                     | New code uses Zone → Territory → Area for both branches; Karachi legacy shape kept read-only for history and mapped via LEGACY_MAP |
| Products           | GROUP_MST → PRODUCT_TYPE, PRODUCT_DESC_T (per branch + `PERIOD#`), DELIVERY_ORDER_TYPE, BAG, BAGS_COLOR, PROD_BRAND                                                                |                                                                                                                                    |
| Tax                | SALES_TAX, SALES_TAX_FED, CED_SETUP                                                                                                                                                | Effective-dated                                                                                                                    |
| Pricing            | TRADE_PRICE (DO clients), AREA_RATES_M/P/D (permit city rate sheets), ZONE_CITY_FRIEGHT_M/D, PRICE_OPENING, PRICE_SLAB*, DISCOUNT*                                                 | New rows only for changes                                                                                                          |
| Customers          | CUSTOMER_INFO (57 + new cols), CUSTOMER_AREA, CUSTOMER_BANK_ACC, CHANNEL_DESC, CATEGORY_TYPE, CUSTOMER_MASTER, BLOCK_CUSTOMER(_GROUP)                                              |                                                                                                                                    |
| Credit             | CREDIT_TYPE, CREDIT_LIMITS, CREDIT_LIMITS_F (approval doc), CUSTOMER_CREDIT_APP, SECURITY_DEPOSIT, CSECURITY_DEPOSIT, TSECURITY_DEPOSIT                                            |                                                                                                                                    |
| Banks/BRV          | BANK_DESC, COMPANY_BANK, INSTRUMENT_TYPE, CASH_CHEQUE_RECEIPTS (BRV), ORDER_CONFIRM_BRV (BRV ↔ OC), RECEIPT_CANCEL_MASTER/DETAIL                                                   | BRV key `(BRNCH, RECEIPT_NO, CASH_CHEQ_CD)`                                                                                        |
| Orders             | SALES_REQUEST_MASTER/DETAIL (SRF), ORDER_CONFIRM/DETAIL (OC), ORDER_CANCEL_MASTER/DETAIL, OC_PRICE_DTL                                                                             |                                                                                                                                    |
| DO/Permit          | DELIVERY_ORDER (key `BRNCH, DO_TYPE, DEL_ORDER_NO`), DO_ADJUSTMENT, PERMIT_MST_CITY → PERMIT_DTL_CITY (`LNKNO`) → PERMIT_ADJ_CITY                                                  |                                                                                                                                    |
| Dispatch           | FH_DELIVERY_CHALLAN (DC header, key `BRNCH, DC_TYPE, DC_NO`), FH_DEL_CHALLAN_DETAIL (line per DO), FH_DELIVERY_MEMO (DM per permit area line), TRANSPORTER_DESC, MODE_OF_TRANSPORT | New DCs/DMs are written here (+ new columns). FH_DC_DOCUMENT and *_OLD tables = history only                                       |
| Notes              | CREDIT_NOTE_TYPE, CREDIT_NOTE (+DETAIL, `DB_CR_CD` C/D), DEBIT_CREDIT_NOTE (legacy single form, read-only)                                                                         |                                                                                                                                    |
| Incentives/targets | INCENTIVE (+PRODUCT, +DETAIL), TARGET_MST, TARGET_CUST, TARGET_CUST_AREA, TARGET_PERC_MST/DTL                                                                                      |                                                                                                                                    |
| Ledger history     | OPENING_BALANCES, CUSTOMER_OPEN_BALANCE, DC_ADJ_*, TAX/TAX_DETAIL, VOCH_POST/DTL                                                                                                   | Used to build opening ledger rows at migration                                                                                     |
| Legacy security    | SEC_USERNAME, SEC_MODULE_S, SEC_USERPERM, …                                                                                                                                        | Read only; migrated into APP_* (PERMISSIONS §5)                                                                                    |

### 2.1 Columns added to legacy tables (by 05)

| Table                                                                                                                                                                                                                                                                                     | Added columns                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SALES_REQUEST_MASTER, ORDER_CONFIRM, CASH_CHEQUE_RECEIPTS, DELIVERY_ORDER, PERMIT_MST_CITY, FH_DELIVERY_CHALLAN, FH_DELIVERY_MEMO, CREDIT_NOTE, DO_ADJUSTMENT, ORDER_CANCEL_MASTER, INCENTIVE, TARGET_MST, CUSTOMER_INFO, TRADE_PRICE, AREA_RATES_M, CREDIT_LIMITS_F, CUSTOMER_CREDIT_APP | `DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON, UPDATED_BY, UPDATED_ON, CANCEL_REASON, CANCELLED_BY, CANCELLED_ON`                                  |
| CUSTOMER_INFO                                                                                                                                                                                                                                                                             | `EMAIL2, WHATSAPP_NO, NOTIFY_SMS, NOTIFY_WA, NOTIFY_EMAIL, APPROVED_BY, APPROVED_ON`; `EMAIL` widened to 100                                      |
| SALES_REQUEST_MASTER                                                                                                                                                                                                                                                                      | `CONTRACT_VALID_TO, LEGAL_REQUIREMENTS, CR_REMARKS, DRAFT_OC_NO, APPROVED_BY`                                                                     |
| ORDER_CONFIRM                                                                                                                                                                                                                                                                             | `PRICE_OVERRIDE, MASTER_PRICES (JSON), OC_VALUE, REVIEWED_BY, APPROVED_BY, APPROVED_ON, CONFIRMED_BY, CONFIRMED_ON, OVERRIDE_REQ_ID`              |
| CASH_CHEQUE_RECEIPTS                                                                                                                                                                                                                                                                      | `VERIFIED_BY, VERIFIED_ON, VERIFY_METHOD, VERIFY_REF, VERIFY_REMARKS, BOUNCED_BY, BOUNCED_ON, BOUNCE_REASON, APPLIED_AMT`                         |
| DELIVERY_ORDER                                                                                                                                                                                                                                                                            | `QR_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DEST_AREA, RATE_LOCK_UNTIL, DISPATCHED_TON, HOLD_REASON, HOLD_SHORTFALL, SENT_TO_DEALER_ON` |
| PERMIT_MST_CITY                                                                                                                                                                                                                                                                           | `PERMIT_VALUE, QR_VER, CFO_REQ_ID, OVERRIDE_REQ_ID, ISSUED_BY, ISSUED_ON, SENT_TO_DEALER_ON`                                                      |
| PERMIT_DTL_CITY                                                                                                                                                                                                                                                                           | `DISPATCHED_TON, AREA_STATUS, ROW_VER`                                                                                                            |
| FH_DELIVERY_CHALLAN                                                                                                                                                                                                                                                                       | `GP_ID, BILTY_NO, DEST_AREA, BAG_SUPPLIER, PLANNED_KG, NET_KG, VARIANCE_KG`                                                                       |
| FH_DEL_CHALLAN_DETAIL                                                                                                                                                                                                                                                                     | `PLANNED_BAGS, PLANNED_TON, ALLOC_NET_KG, INVOICE_ID, LINE_STATUS`                                                                                |
| FH_DELIVERY_MEMO                                                                                                                                                                                                                                                                          | `GP_ID, PLANNED_BAGS, PLANNED_TON, ALLOC_NET_KG, INVOICE_ID`                                                                                      |
| CREDIT_NOTE                                                                                                                                                                                                                                                                               | `TRANSFER_CUSTOMER, REVERSAL_OF_SRL, APPROVAL_REQ_ID, SOURCE_RUN, INVOICE_ID`                                                                     |
| TRADE_PRICE, AREA_RATES_M                                                                                                                                                                                                                                                                 | `APPROVED_BY, APPROVED_ON`                                                                                                                        |
| SHARE_LOG                                                                                                                                                                                                                                                                                 | `FILE_PATH, FILTERS`                                                                                                                              |

### 2.2 Legacy data that 01 did not hold (audit 19 Nov 2026)

A table-by-table and column-by-column comparison of SCLKHI (256 tables) and SCLISB (129 tables) with SALES_NEW found:

- **Columns:** every column of the 251 mapped legacy tables has a target column and is copied (0 dropped, 0 wrongly empty). Details: `docs/reference/COLUMN_USAGE.md`.
- **Tables:** 97 legacy tables with data had no target. 9 hold business data and get a table in `migrations/001` (loaded by `02c`); the rest are backups, test copies, Oracle demo tables (EMP, DEPT, ORD, ITEM, CUSTOMER(S), PRICE …), tool tables (MLOG$_*, PLAN_TABLE) or report staging. They stay in the archive schemas.

| New table (001)                                         | Legacy source                                       | Content                                                                       |
| ------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| INV_FH                                                  | ISB INV_FH, KHI SD_IMRANSB1 (+2 rows of SD_IMRANSB) | Dispatch/invoice summary per DC line, both branches (same structure)          |
| SD_SALES_VS_MRP                                         | KHI                                                 | Invoice history 1999–2024 with FED, sales tax, WHT and cost columns           |
| SD_SALE                                                 | KHI                                                 | Finance voucher lines sent to accounts                                        |
| ALT_OPEN_BALANCE                                        | KHI                                                 | Alternate customer opening balances 1998–2011                                 |
| COST_OF_GOODS_SOLD (+ _DTL, _ACCUMULATED, _ACUMLTD_DTL) | KHI                                                 | COGS periods and per DC type                                                  |
| CITY_V_TAB                                              | KHI                                                 | Karachi zone group → area → district → city in one row (input for Q9 mapping) |

- **Rows found only in backup copies**, rescued by `02c` into their real table: 314 DCs and 289 DC lines of 2013–2020 (`DELIVERY_CHALLAN_BK`, `DEL_CHALLAN_DETAIL_BK`, `DEL_CHALLAN_DETAIL_FUR_BAK` → `FH_*`), 39 receipts (`CSECURITY_DEPOSIT_FUR` → `CSECURITY_DEPOSIT`), 10 product price periods (`PRODUCT_DESC_T_13_JUL_16` → `PRODUCT_DESC_T`). Note: Karachi `DELIVERY_CHALLAN_OLD` stores `DC_NO` negated (−92 = DC 92); compare DC keys with `ABS(DC_NO)`.
- **Load fixes:** `02_LOAD_TRANSACTIONS_ONLY` now takes `ORDER_CONFIRM_BRV` rows without `CR_DATE` with their OC (216 rows for Sep-2026), empties the transaction tables children-first (the alphabetical order was blocked by the 03 foreign keys, e.g. ORDER_CONFIRM before ORDER_CONFIRM_DETAIL) and clears their `ERR$_` logs at the start of each run; loads older permits (header + lines) when one of their lines is adjusted in the window, so `FK_PERMIT_ADJ_CITY_58` holds (Sep-2026: 111 older permits, all 313 adjustments load); `02` reconciliation points to the right `ERR$_` tables for the DC/DM tables.
- **ERR$\_ tables:** one per loaded table, created by `DBMS_ERRLOG`; a row appears only when the load rejects it. All 167 were empty on 19 Nov 2026. They are not part of the application and may be dropped after the production load is reconciled.

### 2.3 Geography: Zone → Territory → Area → City (decision 19 Nov 2026)

`GEO_HIERARCHY` has one row per node on every level (`GEO_LEVEL` 1–4); `GEO_CODE` is the readable path `Z<zone>-T<territory>-A<area>-C<city>`, unique per branch. Every legacy geography code is in `LEGACY_MAP` (ENTITY = legacy table, NEW_CODE = GEO_CODE). Legacy geography tables are unchanged and keep working for old reports.

| Level       | Karachi (BRNCH 1)                                                                                               | Islamabad (BRNCH 2)    |
| ----------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1 Zone      | MASTER_AREA (+3 zone codes used in AREA but missing in MASTER_AREA: 7 SOUTH REGION FWO, 8 AJK, 9 KPK — confirm) | copy of ZONE_DESC      |
| 2 Territory | AREA (SD-1, KHI-1 …)                                                                                            | ZONE_DESC              |
| 3 Area      | DISTRICT                                                                                                        | TERRITORY              |
| 4 City      | CITY (+5 cities only in CITY_V_TAB)                                                                             | AREA (code = AREA_DOC) |

Karachi `ZONE_DESC` (customer zone: KARACHI, HYDERABAD …) is not in the chain; it stays on `CUSTOMER_INFO.ZONE_CODE`.

`CUSTOMER_INFO.GEO_CODE` = deepest known node, `GEO_SOURCE` = how it was set:
`KHI_SALES_HISTORY` (city invoiced to most often in SD_SALES_VS_MRP; city codes match 100 %, district codes were renumbered over time), `ISB_AREA`, `ISB_TERRITORY` (customer's area code 21/22 … does not exist in AREA), `MANUAL` (never overwritten by 02d). 19 Nov 2026: ISB 1,469/1,469 placed; KHI 1,402 placed, 3,344 not placed (no city in any legacy source; only 84 of them active since 2024) → list for Sales in `db/reports/KHI_CUSTOMERS_WITHOUT_GEO.csv`.

### 2.4 Tax rates found in PRODUCT_DESC_T

`SALES_TAX_FED` and `CED_SETUP` are empty in both legacy DBs. The legacy system keeps **FED per ton in `PRODUCT_DESC_T.CED`** and the **sales tax % in `PRODUCT_DESC_T.P_SALES_TAX_PER`**, per product and period (`PERIOD#`, `DATE_FROM`, `DATE_TO`); legacy invoice history matches it (e.g. OPC 2024: FED 140,000 on 35 t = 4,000/t). `SALES_TAX` (17 % since 2000) is stale. Review for Finance: `db/reports/FED_RATE_REVIEW.csv` (816 periods: 285 match history, 11 differ, 23 have DATE_TO before DATE_FROM, 99 overlap another period). Decision 19 Nov 2026: invoices take FED/ton and ST% from `PRODUCT_DESC_T` of the effective period (latest `PERIOD#` with `DATE_FROM` ≤ date wins) — BUSINESS_RULES BR-TAX-02/03/10.

### 2.5 Test-server limits (Oracle XE 11g test server)

The damaged SYS dictionary breaks `DBMS_OUTPUT` (`SET SERVEROUTPUT ON`), `DROP` and **`ALTER TABLE … MODIFY`** (ORA-00604). `ADD` column, `CREATE`, DML and anonymous PL/SQL work. 05 was adjusted to run here (no SERVEROUTPUT, ZZ_ADD_COL as a local procedure in each block, no DROP). Not applied on this server: `CUSTOMER_INFO.EMAIL` widening to 100 (stays 35) — run it on the production server.

Legacy columns that the new app **also fills** for old reports: `FH_DELIVERY_CHALLAN.INVOICE_NO/INVOICE_DATE` (first invoice of the DC), `W_TARE`, `WT_GROSS`, `QTY_VERIFIED` (net tons), `VEHICLE_NO`, `TRANSP_CODE`, `TOKEN_NO`; `DELIVERY_ORDER.DISPATCHED` (rounded), `CANCEL_CODE`, `CANCEL_DATE`; `ORDER_CONFIRM.APPROVED`, `CANCEL_CODE`; `CASH_CHEQUE_RECEIPTS.CANCEL_STATS`, `RETURN_CD`, `RETURN_DATE`, `CLEAR_DATE`.

### 2.6 Simple masters (003, P1-01)

Masters are deactivated, never deleted: `ACTIVE CHAR(1) DEFAULT 'Y'`, `ROW_VER`, `UPDATED_BY/ON` added to GROUP_MST, PRODUCT_TYPE, PROD_BRAND, DELIVERY_ORDER_TYPE, BAG, BAGS_COLOR, CHANNEL_DESC, BANK_DESC, COMPANY_BANK, INSTRUMENT_TYPE, CATEGORY_TYPE, TRANSPORTER_DESC, MODE_OF_TRANSPORT, CREDIT_TYPE, CREDIT_NOTE_TYPE, REGION. Legacy flags (`BAG.STATS`, `PROD_BRAND.STATS`, `PRODUCT_DESC_T.STATUS`) are kept as they are.

- `CHANNEL_DESC.REPORT_GROUP` (new): R7 group DEALER / DIRECT_INST / DEALER_INST / DISTRIBUTOR. Empty after migration — **Sales to fill per channel**. Legacy `GRP` (numbers, Hattar only) is unchanged.
- Bank short code for R4 = existing `COMPANY_BANK.ABBR` (ABL, SONB …), no new column.
- PRODUCT_DESC_T field names in the API (inferred from data, e.g. OPC period 57: 25,654.24 × 1.18 = 30,272; **to confirm with Finance**): `CODE` = MRP per ton tax-inclusive, `R_PRICE` = retail per ton excl. ST, `COMPANY_PRICE` = retail − FED, `P_SALES_TAX` = ST per ton, `CED` = FED per ton, `P_SALES_TAX_PER` = ST %, `AVG_RATE` shown as legacy average rate.
- Keys used by the API: AREA has no PK (AREA_DOC unique per branch), BAG/PRODUCT_TYPE/TRANSPORTER_DESC/CREDIT_TYPE/COMPANY_BANK/MODE_OF_TRANSPORT/CREDIT_NOTE_TYPE/PROD_BRAND use their unique keys from 01/03.

## 3. New tables (by 05)

| Table                | Purpose                                                      | Key                                                                                                 | Notes                                                                           |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| SCHEMA_VERSION       | Applied migrations                                           | VERSION                                                                                             | Runner inserts one row per file                                                 |
| APP_USER             | Users of the new system                                      | USER_ID; UK USRID                                                                                   | argon2id hash; `MUST_CHANGE_PWD`; lockout fields; `LEGACY_UNIT_ID/LEGACY_USRID` |
| APP_PASSWORD_HISTORY | Last passwords                                               | (USER_ID, CHANGED_ON) idx                                                                           | Reuse check (last 5)                                                            |
| APP_ROLE             | Roles                                                        | ROLE_CODE                                                                                           | Seeded (PERMISSIONS §2)                                                         |
| APP_PERMISSION       | Permission keys `module.action`                              | PERM_KEY                                                                                            | Seeded from `packages/shared/permissions.js`                                    |
| APP_ROLE_PERMISSION  | Role → permission                                            | (ROLE_CODE, PERM_KEY)                                                                               |                                                                                 |
| APP_USER_BRANCH      | Branches a user may open                                     | (USER_ID, BRNCH)                                                                                    | `IS_DEFAULT`                                                                    |
| APP_USER_ROLE        | Roles per user **per branch**                                | (USER_ID, BRNCH, ROLE_CODE)                                                                         |                                                                                 |
| APP_REFRESH_TOKEN    | Rotating refresh tokens                                      | TOKEN_ID; UK TOKEN_HASH                                                                             | Family id for reuse detection                                                   |
| APP_SETTING          | Settings per branch (0 = default)                            | (BRNCH, SETTING_KEY)                                                                                | Keys in §5                                                                      |
| APP_DEVICE           | Weighbridge agents, gate tablets                             | DEVICE_ID                                                                                           | Secret encrypted; bound to branch                                               |
| AUDIT_LOG            | Immutable audit trail                                        | AUDIT_ID                                                                                            | Insert-only grant                                                               |
| IDEMPOTENCY_KEY      | Replay-safe commands                                         | IDEM_KEY                                                                                            | Purged after 7 days                                                             |
| USER_NOTIFICATION    | In-app bell                                                  | NOTIF_ID                                                                                            |                                                                                 |
| ATTACHMENT           | Files (payment slips, export docs)                           | ATT_ID                                                                                              | Stored on disk/object store; path + sha256                                      |
| APPROVAL_RULE        | Configurable approval rules                                  | RULE_ID                                                                                             | Levels 1–3, role per level                                                      |
| APPROVAL_REQUEST     | Pending/decided requests with snapshot                       | REQ_ID                                                                                              | Status machine                                                                  |
| APPROVAL_ACTION      | Each decision                                                | ACTION_ID                                                                                           |                                                                                 |
| NOTIFICATION_OUTBOX  | Transactional outbox: notifications + jobs                   | OUTBOX_ID; UK DEDUP_KEY                                                                             | Worker polls `STATUS, NEXT_TRY_ON`                                              |
| SYNC_CONFLICT        | Offline events that could not apply                          | CONFLICT_ID                                                                                         | Review queue                                                                    |
| CUSTOMER_LEDGER      | Posted DO/DC ledgers                                         | LEDGER_ID; UK (BRNCH, LEDGER_TYPE, DOC_TYPE, DOC_YEAR, DOC_NO, DOC_LINE, ENTRY_KIND, CUSTOMER_CODE) | UK prevents double posting; insert-only                                         |
| GATE_PASS            | Truck visit: gate-in → weights → exit                        | GP_ID; UK CLIENT_ID                                                                                 | Links to DC (`DC_NO`) or DMs (`FH_DELIVERY_MEMO.GP_ID`)                         |
| WEIGH_TICKET         | Every weighbridge reading                                    | TICKET_ID; UK (DEVICE_ID, DEVICE_READING_ID)                                                        | Insert-only; MANUAL needs reason (check constraint)                             |
| SALES_INVOICE        | One invoice per DC line / DM, full tax breakdown, FBR fields | INVOICE_ID; UK (BRNCH, INVOICE_YEAR, INVOICE_NO)                                                    | Stored figures, never recalculated                                              |
| FBR_SUBMISSION       | Every FBR API attempt                                        | SUB_ID                                                                                              | Request/response kept                                                           |
| TAX_WITHHELD         | Income/sales tax withheld by customers                       | TW_ID                                                                                               | R12 block 7                                                                     |

Full DDL with types: `db/05_NEW_SYSTEM_TABLES.sql`.

### 3.1 Relationships (new ↔ legacy)

```
CUSTOMER_INFO (BRNCH, CUSTOMER_CODE) ◀─ CUSTOMER_LEDGER, SALES_INVOICE, GATE_PASS (by column)
SALES_REQUEST_MASTER.DRAFT_OC_NO ─▶ ORDER_CONFIRM.ORDER_NO
ORDER_CONFIRM ─▶ DELIVERY_ORDER (ORDER_NO) ─▶ FH_DEL_CHALLAN_DETAIL (DO_NO) ─▶ SALES_INVOICE (INVOICE_ID)
PERMIT_MST_CITY ─▶ PERMIT_DTL_CITY (LNKNO) ─▶ FH_DELIVERY_MEMO (PERMIT_NO, LNKNO) ─▶ SALES_INVOICE
GATE_PASS (GP_ID) ─▶ FH_DELIVERY_CHALLAN.GP_ID / FH_DELIVERY_MEMO.GP_ID ; WEIGH_TICKET.GP_ID ; SALES_INVOICE.GP_ID
SALES_INVOICE ─▶ FBR_SUBMISSION
APPROVAL_REQUEST.REQ_ID ◀─ ORDER_CONFIRM.OVERRIDE_REQ_ID, PERMIT_MST_CITY.CFO_REQ_ID/OVERRIDE_REQ_ID, GATE_PASS.WEIGHT_OVR_REQ_ID/EXIT_OVR_REQ_ID, CREDIT_NOTE.APPROVAL_REQ_ID
```

Links to legacy tables are by column (no FK), because legacy rows break them; services validate them (requirements spec §13.3).

## 4. DOC_SEQUENCE document types

| DOC_TYPE | Document              | Table / column                                                     |
| -------- | --------------------- | ------------------------------------------------------------------ |
| SRF      | Sales request         | SALES_REQUEST_MASTER.SRF_NO                                        |
| OC       | Order confirmation    | ORDER_CONFIRM.ORDER_NO                                             |
| BRV      | Bank receipt          | CASH_CHEQUE_RECEIPTS.RECEIPT_NO                                    |
| DO       | Delivery order        | DELIVERY_ORDER.DEL_ORDER_NO                                        |
| PMT      | Permit                | PERMIT_MST_CITY.PERMIT_NO                                          |
| DC       | Delivery challan      | FH_DELIVERY_CHALLAN.DC_NO                                          |
| DM       | Delivery memo         | FH_DELIVERY_MEMO.DM_NO                                             |
| INV      | Sales invoice         | SALES_INVOICE.INVOICE_NO                                           |
| CN / DN  | Credit / debit note   | CREDIT_NOTE.SRL_NO (one series, `DB_CR_CD` distinguishes)          |
| OCA      | Order cancel advice   | ORDER_CANCEL_MASTER.OC_ADVISE_NO                                   |
| RCX      | Receipt cancel        | RECEIPT_CANCEL_MASTER.CANCEL_NO                                    |
| DOA      | DO adjustment advice  | DO_ADJUSTMENT.ADVICE_NO                                            |
| INC      | Incentive run         | INCENTIVE.SRL_NO                                                   |
| CLM      | Credit limit document | CREDIT_LIMITS_F.SERNO (P1-04; seeded from legacy max, Hattar 4565) |

Migration seeds `LAST_NO` = max legacy number per (branch, year, type) so numbering continues (BR-NUM-04).

**Seeded 20 Nov 2026 (`pnpm db:seed`, FY 2027) — legacy formats observed, to confirm with Finance before P2:**

| Type                      | Karachi (1) last | Hattar (2) last | Observed pattern                                                              | Status                                                                   |
| ------------------------- | ---------------- | --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| SRF                       | 21653342         | 66461226        | 8-digit running; legacy `YEAR` empty                                          | to confirm                                                               |
| OC                        | 227000758        | 227000138       | `2` + FY (`27`) + 6-digit running                                             | to confirm                                                               |
| BRV                       | 2026100011       | 107432          | KHI `YYYYMM` + 4 digits (monthly reset); ISB plain running                    | **to confirm — KHI resets monthly, counter alone will not reproduce it** |
| DO                        | 22746000012      | 22710000206     | `2` + FY + 2-digit sub-code + 6 digits (sub-code varies, e.g. 01, 03, 10, 46) | **to confirm — several sub-series**                                      |
| PMT                       | 2027639          | 20272300        | FY + running; legacy stores the `.1/.2` suffix inside the number (2027639.1)  | to confirm                                                               |
| CN/DN                     | 22700063         | 22700225        | `227` + 5 digits, one series                                                  | to confirm                                                               |
| OCA                       | 279              | 2323            | running                                                                       | to confirm                                                               |
| DOA                       | 2160373          | 0               | running                                                                       | to confirm                                                               |
| RCX                       | 0                | 0               | legacy text `YYYY-NNNN`; new series starts at 0                               | to confirm                                                               |
| DC, DM, INV, GP, CXL, INC | 0                | 0               | no legacy rows in SALES_NEW (dispatch DB, BRD Q1)                             | start at 0 until the dispatch DB is migrated                             |

Until confirmed, `nextNumber` continues each counter from the raw legacy maximum. Per-type composition (prefix/year/month) is added when Finance confirms, without changing the allocation (`FOR UPDATE` counter). Where a legacy number is unique across years (e.g. DO numbers like 22702000001), the year in `DOC_SEQUENCE` is the fiscal year and the number format keeps the legacy pattern — confirm per document type with Finance before go-live (TASKS P0-07).

## 5. Settings (`APP_SETTING`, seeded with defaults, BRNCH 0)

| Key                              | Default    | Rule                                                                                      |
| -------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| DO_RATE_LOCK_DAYS                | 14         | BR-PRC-07                                                                                 |
| CONTRACT_VALID_MONTHS            | 3          | BR-SRF-07                                                                                 |
| WEIGHT_TOLERANCE_KG              | 100        | BR-WGT-05                                                                                 |
| WEIGH_STABLE_COUNT               | 5          | BR-WGT-01                                                                                 |
| WEIGH_STABLE_KG                  | 10         | BR-WGT-01                                                                                 |
| TARE_WARN_KG                     | 300        | BR-WGT-03                                                                                 |
| BAG_WEIGHT_KG                    | 50         | BR-GATE-06                                                                                |
| INVOICE_QTY_BASIS                | NET_WEIGHT | BR-INV-01 (open Q2)                                                                       |
| ALLOW_EXIT_WITHOUT_FBR           | N          | BR-EXIT-02 (open Q3)                                                                      |
| TEMP_TOKEN_ENABLED               | N          | BR-GATE-05 (open Q4)                                                                      |
| BILTY_REQUIRED                   | Y          | BR-GATE-02                                                                                |
| PERMIT_CFO_QTY                   | (empty)    | BR-PMT-03                                                                                 |
| FURTHER_TAX_PCT                  | 0          | BR-TAX-06                                                                                 |
| EXPORT_EXPENSE_USD_PER_TON       | 7.5        | R12                                                                                       |
| EXPORT_FX_RATE                   | 105.2      | R12                                                                                       |
| LINK_EXPIRY_DAYS                 | 7          | BR-NTF-04                                                                                 |
| NTF_MAX_TRIES                    | 5          | BR-NTF-02                                                                                 |
| PLANT_WAIT_ALERT_MIN             | 120        | BR-NTF-03                                                                                 |
| OFFLINE_CACHE_MIN                | 5          | BR-OFF-02                                                                                 |
| MAX_FUTURE_DAYS                  | 366        | BR-DQ-01                                                                                  |
| LOGIN_MAX_FAILS / LOGIN_LOCK_MIN | 5 / 15     | PRD 4.1                                                                                   |
| PWD_LIFE_DAYS / PWD_HISTORY      | 90 / 5     | PRD 4.1                                                                                   |
| FBR_ENV                          | SANDBOX    | per branch: also FBR_POS_ID, FBR_TOKEN_ENC, FBR_BASE_URL, FBR_SELLER_NTN, FBR_SELLER_STRN |

## 6. Index plan (beyond 01/03/05)

Add an index when a list screen or report filters/sorts on columns not covered; record it in a migration. Required for go-live (some already in 05):

- `CUSTOMER_LEDGER (BRNCH, CUSTOMER_CODE, LEDGER_TYPE, ENTRY_DATE, LEDGER_ID)` — R1/R13/balance.
- `SALES_INVOICE (BRNCH, INVOICE_DATE, PRODUCT_CODE)` — R2/R3/R9/R12.
- `CASH_CHEQUE_RECEIPTS (BRNCH, DOC_STATUS, CR_DATE)` — verification queue, R4/R8.
- `DELIVERY_ORDER (BRNCH, DOC_STATUS, CUSTOMER_CODE)` — open commitments, R10.
- `PERMIT_DTL_CITY (BRNCH, PERMIT_NO)` (PK covers via LNKNO? add if plans show full scans) — R11.
- `GATE_PASS (BRNCH, STATUS, GATE_IN_ON)` — plant board.

## 7. Migration to production (summary; tasks in TASKS.md P6)

1. Fresh Oracle 19c schema → run 01 → 02 (full) → 03 → 04 → 05 → migrations → seed.
2. Load legacy dispatch DB (once identified) into FH_* / GATE_PASS history (mapping to be written).
3. Build `CUSTOMER_LEDGER` opening rows per customer from legacy balances as of cut-over date; reconcile against legacy R1/R13 for every customer (difference must be 0).
4. Set `DOC_STATUS` on migrated documents from legacy flags (mapping table in `tools/migrate/status-map.js`).
5. Seed `DOC_SEQUENCE` from legacy max numbers.
6. Migrate users from SEC_USERNAME → APP_USER (must change password), map SEC_USERPERM → roles (PERMISSIONS §5) and review with each department.
7. Data quality report: impossible dates, invalid CNIC/NTN, customers without zone/territory/area, duplicate names.
