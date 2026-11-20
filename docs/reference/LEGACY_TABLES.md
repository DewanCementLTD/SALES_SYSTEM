# Legacy-named tables (generated from 01_DCL_SALES_TABLES.sql + 03 keys)

Generated reference. Source of truth is `db/01_DCL_SALES_TABLES.sql` and `db/03_DCL_SALES_KEYS_AFTER_LOAD.sql`. Do not edit by hand; regenerate if those change.

Every table carries `COMPC` (company, 1 = DCL) and `BRNCH` (1 = Karachi, 2 = Islamabad/Hattar). Every primary/unique/foreign key starts with `BRNCH`.

## System and setup

### COMPANY

Company/branch header: name, address, STRN, NTN. Source: Karachi + Islamabad.

- UK UK_COMPANY_N1: (BRNCH, COMP_CODE)

| Column | Type | Null |
| --- | --- | --- |
| COMP_CODE | VARCHAR2(3) | Y |
| COMP_NAME | VARCHAR2(60) | Y |
| INCOME_TAX | NUMBER(5,2) | Y |
| EXCISE_DUTY | NUMBER(5,2) | Y |
| SYSTEM_PATH | VARCHAR2(60) | Y |
| LOGO_PATH | VARCHAR2(60) | Y |
| OTHER_EXPENSE | NUMBER(5,2) | Y |
| YSTART | DATE | Y |
| YEND | DATE | Y |
| CURRENT_YEAR | NUMBER(4) | Y |
| TRADE_DISC_LMT | NUMBER | Y |
| ADDRESS | VARCHAR2(100) | Y |
| EXECUTE_PATH | VARCHAR2(100) | Y |
| SERVER_PATH_FORM | VARCHAR2(100) | Y |
| SERVER_PATH_REPORT | VARCHAR2(100) | Y |
| CREDIT_MONITOR | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### UNIT_MST

Units (plants) of the company. Source: Karachi + Islamabad.

- UK UK_UNIT_MST_N1: (BRNCH, UNIT_ID)

| Column | Type | Null |
| --- | --- | --- |
| UNIT_ID | VARCHAR2(1) | Y |
| UNIT_NAME | VARCHAR2(30) | Y |
| GRP_ID | VARCHAR2(1) | Y |
| GRP_NM | VARCHAR2(20) | Y |
| UNIT | VARCHAR2(1) | Y |
| SALES_ABRV | VARCHAR2(100) | Y |
| UNIT_GRP | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SALES_YEAR

Fiscal years with start/end dates. Source: Karachi + Islamabad.

- PK: (BRNCH, YEAR)

| Column | Type | Null |
| --- | --- | --- |
| YEAR | NUMBER(4) | N |
| YSTART | DATE | Y |
| YEND | DATE | Y |
| CLOSE | NUMBER(1) | Y |
| CLOSE_DATE | DATE | Y |
| R | NUMBER | Y |
| U | NUMBER | Y |
| C | NUMBER | Y |
| E | NUMBER | Y |
| DESCR | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DAYS_LOCK

Days locked for back-dated entry. Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| DY | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BLOCK_DO_DATE

Dates on which DOs may not be issued. Source: Karachi only.

- UK UK_BLOCK_DO_DATE_N1: (BRNCH, FROM_DATE)

| Column | Type | Null |
| --- | --- | --- |
| FROM_DATE | DATE | Y |
| TO_DAE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DOC_SEQUENCE

New: next document number per branch, year and document type. Source: New (no legacy data).

- PK: (BRNCH, YEAR, DOC_TYPE)

| Column | Type | Null |
| --- | --- | --- |
| BRNCH | NUMBER | N |
| YEAR | NUMBER(4) | N |
| DOC_TYPE | VARCHAR2(10) | N |
| LAST_NO | NUMBER(19) | N |
| PREFIX | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |

### LEGACY_MAP

New: old code → new code per entity (migration trace). Source: New (no legacy data).

- PK: (BRNCH, ENTITY, LEGACY_CODE)

| Column | Type | Null |
| --- | --- | --- |
| BRNCH | NUMBER | N |
| ENTITY | VARCHAR2(30) | N |
| LEGACY_CODE | VARCHAR2(50) | N |
| NEW_CODE | VARCHAR2(50) | N |
| SOURCE_DB | VARCHAR2(10) | N |
| MAP_DATE | DATE | Y |
| COMPC | NUMBER | N |

### PRINT_TEXT

New: standard clause texts on prints (e.g. Contract Review Form). Source: New (no legacy data).

- PK: (BRNCH, TEXT_CODE, SR_NO)

| Column | Type | Null |
| --- | --- | --- |
| BRNCH | NUMBER | N |
| TEXT_CODE | VARCHAR2(30) | N |
| SR_NO | NUMBER(3) | N |
| TEXT_BODY | VARCHAR2(4000) | N |
| ACTIVE | VARCHAR2(1) | N |
| ENTER_BY | VARCHAR2(20) | Y |
| ENTER_DATE | DATE | Y |
| COMPC | NUMBER | N |

### MSG_TEMPLATE

New: email/WhatsApp message templates for report sharing. Source: New (no legacy data).

- PK: (TEMPLATE_CODE, CHANNEL)

| Column | Type | Null |
| --- | --- | --- |
| TEMPLATE_CODE | VARCHAR2(30) | N |
| CHANNEL | VARCHAR2(10) | N |
| SUBJECT | VARCHAR2(200) | Y |
| BODY | VARCHAR2(4000) | N |
| ACTIVE | VARCHAR2(1) | N |
| BRNCH | NUMBER | Y |
| COMPC | NUMBER | N |

### USER_MAIL_ACCOUNT

New: sender mail account per user. Source: New (no legacy data).

- PK: (USRID)

| Column | Type | Null |
| --- | --- | --- |
| USRID | VARCHAR2(20) | N |
| EMAIL | VARCHAR2(100) | N |
| SMTP_HOST | VARCHAR2(100) | N |
| SMTP_PORT | NUMBER(5) | N |
| SMTP_USER | VARCHAR2(100) | N |
| SMTP_PWD_ENC | VARCHAR2(500) | N |
| USE_TLS | VARCHAR2(1) | N |
| ACTIVE | VARCHAR2(1) | N |
| BRNCH | NUMBER | Y |
| COMPC | NUMBER | N |

### SHARE_LOG

New: log of every report shared by email/WhatsApp. Source: New (no legacy data).

- PK: (ID)

| Column | Type | Null |
| --- | --- | --- |
| ID | NUMBER | N |
| BRNCH | NUMBER | N |
| USRID | VARCHAR2(20) | N |
| REPORT_CODE | VARCHAR2(30) | N |
| CUSTOMER_CODE | VARCHAR2(20) | Y |
| CHANNEL | VARCHAR2(10) | N |
| RECIPIENT | VARCHAR2(200) | N |
| FILE_NAME | VARCHAR2(200) | Y |
| LINK_TOKEN | VARCHAR2(100) | Y |
| LINK_EXPIRES | DATE | Y |
| STATUS | VARCHAR2(10) | N |
| ERROR_MSG | VARCHAR2(1000) | Y |
| SENT_ON | DATE | N |
| COMPC | NUMBER | N |

### GL_MAP

New: GL account per document type and entry (finance posting). Source: New (no legacy data).

- PK: (BRNCH, DOC_TYPE, ENTRY_CODE)

| Column | Type | Null |
| --- | --- | --- |
| BRNCH | NUMBER | N |
| DOC_TYPE | VARCHAR2(10) | N |
| ENTRY_CODE | VARCHAR2(20) | N |
| DR_CR | VARCHAR2(1) | N |
| ACC_CODE | VARCHAR2(8) | N |
| DESCR | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |

### EXCHANGE_RATE_MAST

Exchange rate sheet header (export). Source: Karachi only.

- PK: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | VARCHAR2(10) | N |
| PRODUCT_TYPE | VARCHAR2(1) | Y |
| DOLLAR_RATE | NUMBER(10,2) | Y |
| EXC_RATE | NUMBER(10,2) | Y |
| EFCT_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### EXCHANGE_RATE_DTL

Exchange rate lines per currency. Source: Karachi only.

- FK FK_EXCHANGE_RATE_DTL_10: (BRNCH, SERNO) → EXCHANGE_RATE_MAST (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | VARCHAR2(10) | Y |
| PRODUCT_CODE | VARCHAR2(4) | N |
| AVG_RAT | NUMBER(12,2) | Y |
| PRODUCT_TYPE | VARCHAR2(1) | Y |
| DOLLAR_RATE | NUMBER(10,2) | Y |
| EXC_RATE | NUMBER(10,2) | Y |
| EFCT_DATE | DATE | Y |
| STATUS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AGGING_GROUP

Ageing buckets for debtor reports. Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| UNIT_FROM | NUMBER(2) | Y |
| UNIT_TO | NUMBER(2) | Y |
| SALE_TYPE | VARCHAR2(2) | Y |
| DATE_FROM | DATE | Y |
| DATE_TO | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AGGING_RULE

Rules that place balances in ageing buckets. Source: Karachi only.

- UK UK_AGGING_RULE_N1: (BRNCH, SNO)

| Column | Type | Null |
| --- | --- | --- |
| SNO | NUMBER(3) | Y |
| F_DAY | NUMBER(4) | Y |
| T_DAY | NUMBER(4) | Y |
| F_DATE | DATE | Y |
| T_DAATE | DATE | Y |
| NO_OF_DAYS | VARCHAR2(10) | Y |
| FLAG | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Users and audit

### SEC_USERNAME

Users: login, level, expiry, lock rules. Source: Karachi + Islamabad.

- PK: (BRNCH, USRID)
- UK UK_SEC_USERNAME_N1: (BRNCH, MOBILE)

| Column | Type | Null |
| --- | --- | --- |
| UNIT_ID | VARCHAR2(2) | N |
| USRID | VARCHAR2(2) | N |
| DESCR | VARCHAR2(40) | N |
| ULEVL | VARCHAR2(1) | N |
| DESIG | VARCHAR2(40) | Y |
| PASWD | VARCHAR2(100) | N |
| PDATE | DATE | N |
| LOCKL | NUMBER | N |
| CONTR | NUMBER | Y |
| STATS | VARCHAR2(1) | Y |
| FTIME | DATE | Y |
| TTIME | DATE | Y |
| SCREN | VARCHAR2(1) | Y |
| PLIFE | NUMBER(5) | Y |
| EXPDT | DATE | N |
| DCODE | VARCHAR2(3) | Y |
| WEBLG | VARCHAR2(3) | Y |
| LOC_ID | VARCHAR2(3) | Y |
| ORG_ID | VARCHAR2(8) | Y |
| DEPT_ID | VARCHAR2(3) | Y |
| MOBILE | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_USERCMPN

Branches a user may open. Source: Karachi + Islamabad.

- UK UK_SEC_USERCMPN_N1: (BRNCH, USRID, UNIT_ID)
- FK FK_SEC_USERCMPN_15: (BRNCH, USRID) → SEC_USERNAME (BRNCH, USRID)

| Column | Type | Null |
| --- | --- | --- |
| USRID | VARCHAR2(3) | Y |
| UNIT_ID | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_MODULE_S

Screens/reports (modules) of the system. Source: Karachi + Islamabad.

- UK UK_SEC_MODULE_S_N1: (BRNCH, SYSTM, MODUL)

| Column | Type | Null |
| --- | --- | --- |
| SYSTM | VARCHAR2(2) | N |
| MODUL | VARCHAR2(40) | N |
| EXTNS | VARCHAR2(3) | N |
| DESCR | VARCHAR2(40) | N |
| WDATE | DATE | Y |
| INSRT | VARCHAR2(1) | Y |
| QUERY | VARCHAR2(1) | Y |
| UPDAT | VARCHAR2(1) | Y |
| DELET | VARCHAR2(1) | Y |
| PRINT | VARCHAR2(1) | Y |
| AUTHR | VARCHAR2(40) | Y |
| VERSN | VARCHAR2(10) | Y |
| STATS | VARCHAR2(1) | Y |
| USRID | VARCHAR2(3) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_MAINMENU

Menu tree (self-referencing). Source: Karachi + Islamabad.

- PK: (BRNCH, SERNO)
- FK FK_SEC_MAINMENU_13: (BRNCH, PARNO) → SEC_MAINMENU (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | VARCHAR2(4) | N |
| DESCR | VARCHAR2(100) | N |
| RIGHT | VARCHAR2(1) | N |
| DTYPE | VARCHAR2(1) | N |
| MODNM | VARCHAR2(40) | Y |
| PARNO | VARCHAR2(4) | Y |
| DETDS | VARCHAR2(300) | Y |
| PAR01 | VARCHAR2(20) | Y |
| PAR02 | VARCHAR2(20) | Y |
| USRID | VARCHAR2(3) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_USERPERM

Rights per user and module: insert, query, update, delete, print. Source: Karachi + Islamabad.

- UK UK_SEC_USERPERM_N1: (BRNCH, UNIT_ID, USRID, SYSTM, MODUL)

| Column | Type | Null |
| --- | --- | --- |
| UNIT_ID | VARCHAR2(2) | N |
| USRID | VARCHAR2(2) | N |
| SYSTM | VARCHAR2(2) | N |
| MODUL | VARCHAR2(40) | N |
| EXTNS | VARCHAR2(3) | N |
| PDATE | DATE | Y |
| INSRT | VARCHAR2(1) | Y |
| QUERY | VARCHAR2(1) | Y |
| UPDAT | VARCHAR2(1) | Y |
| DELET | VARCHAR2(1) | Y |
| PRINT | VARCHAR2(1) | Y |
| STATS | VARCHAR2(1) | Y |
| PAR01 | VARCHAR2(10) | Y |
| PAR02 | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_USERMENU

Menu entries per user. Source: Karachi + Islamabad.

- UK UK_SEC_USERMENU_N1: (BRNCH, USRID, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| USRID | VARCHAR2(10) | N |
| SERNO | VARCHAR2(10) | Y |
| RIGHT | VARCHAR2(10) | Y |
| DTYPE | VARCHAR2(2) | Y |
| PARNO | VARCHAR2(10) | Y |
| DETDS | VARCHAR2(100) | Y |
| MODNM | VARCHAR2(50) | Y |
| PAR01 | VARCHAR2(10) | Y |
| PAR02 | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_USER_FAV

User favourite screens. Source: Karachi + Islamabad.

- UK UK_SEC_USER_FAV_N1: (BRNCH, USRID, MODLE)

| Column | Type | Null |
| --- | --- | --- |
| USRID | VARCHAR2(10) | Y |
| MODLE | VARCHAR2(200) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_LHISTORY

Login history. Source: Karachi + Islamabad.

- UK UK_SEC_LHISTORY_N1: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | VARCHAR2(30) | Y |
| PASWD | VARCHAR2(100) | Y |
| USRID | VARCHAR2(10) | Y |
| UNIT_ID | VARCHAR2(10) | Y |
| WSTNO | VARCHAR2(30) | Y |
| LTIME | DATE | Y |
| SYSTM | VARCHAR2(30) | Y |
| LDATE | DATE | Y |
| OUTDT | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SEC_MOD_ACES

Screen access log. Source: Karachi + Islamabad.

- FK FK_SEC_MOD_ACES_14: (BRNCH, USRID) → SEC_USERNAME (BRNCH, USRID)

| Column | Type | Null |
| --- | --- | --- |
| USRID | VARCHAR2(6) | N |
| SERNO | VARCHAR2(7) | N |
| WDATE | DATE | N |
| MODNM | VARCHAR2(50) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### U_AUDIT

Audit trail of changes. Source: Karachi + Islamabad.


| Column | Type | Null |
| --- | --- | --- |
| ADATE | DATE | Y |
| TIME | VARCHAR2(8) | Y |
| AUSER | VARCHAR2(10) | Y |
| MODULE | VARCHAR2(12) | Y |
| ACTION | VARCHAR2(12) | Y |
| DETAIL | VARCHAR2(40) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### LOG_CUSTOMER_INFO

History of customer record changes (ISB). Source: Islamabad only.


| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| ZONE_CODE | VARCHAR2(10) | Y |
| CHANNEL_CODE | VARCHAR2(3) | Y |
| CUSTOMER_NAME | VARCHAR2(60) | Y |
| CUSTOMER_ADDRESS1 | VARCHAR2(60) | Y |
| CUSTOMER_ADDRESS2 | VARCHAR2(60) | Y |
| PH_NO | VARCHAR2(35) | Y |
| MOBILE_NO | VARCHAR2(35) | Y |
| FAX_NO | VARCHAR2(35) | Y |
| EMAIL | VARCHAR2(35) | Y |
| CUSTOMER_TYPE | VARCHAR2(3) | Y |
| CREDIT_LIMITE | NUMBER(14,2) | Y |
| CASH_DEPOSIT | NUMBER(14,2) | Y |
| DEBIT_AMOUNT | NUMBER(14,2) | Y |
| CREDIT_AMOUNT | NUMBER(14,2) | Y |
| MODE_OF_BUS | CHAR(1) | Y |
| CROSS_REF | VARCHAR2(11) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | VARCHAR2(10) | Y |
| TAX_DEDUCT | VARCHAR2(1) | Y |
| SECURITY_DESC | VARCHAR2(200) | Y |
| MISC | NUMBER(1) | Y |
| CLOSED | VARCHAR2(1) | Y |
| SALES_TAX_TYPE | VARCHAR2(1) | Y |
| SALES_TAX_NO | VARCHAR2(25) | Y |
| CLEAN | NUMBER(14,2) | Y |
| TRANSITORY | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| TAX | NUMBER(14,2) | Y |
| BOUNCE | NUMBER(14,2) | Y |
| CARD_OPEN_DATE | DATE | Y |
| CARD_CLOSED_DATE | DATE | Y |
| TERRITORY_CODE | VARCHAR2(20) | N |
| AREA_CODE | VARCHAR2(2) | N |
| BUFFER | NUMBER(14,2) | Y |
| BANK_FLOAT | NUMBER(14,2) | Y |
| NTN | VARCHAR2(50) | Y |
| CNIC | VARCHAR2(50) | Y |
| CUSTOMER_GROUP | NUMBER(3) | Y |
| REG_NO | VARCHAR2(50) | Y |
| SALES_TAX_STATS | VARCHAR2(1) | Y |
| INCOM_TAX_TYPE | VARCHAR2(1) | Y |
| INCOM_TAX_STATS | VARCHAR2(1) | Y |
| TYPE_IUD_CM | VARCHAR2(1) | Y |
| V_MACHINE | VARCHAR2(200) | Y |
| V_OSUSER | VARCHAR2(200) | Y |
| DML_TIME | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Geography

### ZONE_DESC

Zones (top level). Source: Karachi + Islamabad.

- PK: (BRNCH, ZONE_CODE)

| Column | Type | Null |
| --- | --- | --- |
| ZONE_CODE | VARCHAR2(10) | N |
| ZONE_NAME | VARCHAR2(60) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TERRITORY

Territories under a zone (ISB shape, used by both). Source: Islamabad only.

- PK: (BRNCH, ZONE_CODE, TERRITORY_CODE)
- FK FK_TERRITORY_69: (BRNCH, ZONE_CODE) → ZONE_DESC (BRNCH, ZONE_CODE)

| Column | Type | Null |
| --- | --- | --- |
| TERRITORY_CODE | VARCHAR2(2) | N |
| ZONE_CODE | VARCHAR2(10) | N |
| TERRITORY_DESC | VARCHAR2(60) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AREA

Areas/cities under a territory. Source: Karachi + Islamabad.

- UK UK_AREA_N1: (BRNCH, ZONE_CODE, TERRITORY_CODE, AREA_DOC)
- FK FK_AREA_18: (BRNCH, ZONE_CODE) → ZONE_DESC (BRNCH, ZONE_CODE)
- FK FK_AREA_71: (BRNCH, ZONE_CODE, TERRITORY_CODE) → TERRITORY (BRNCH, ZONE_CODE, TERRITORY_CODE)

| Column | Type | Null |
| --- | --- | --- |
| AREA_CD | NUMBER | Y |
| AREA_NAME | VARCHAR2(50) | Y |
| M_AREA_CD | NUMBER | Y |
| ZONE_CODE | VARCHAR2(10) | Y |
| TERRITORY_CODE | VARCHAR2(20) | Y |
| AREA_DOC | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### MASTER_AREA

Karachi master areas (legacy shape). Source: Karachi only.

- PK: (BRNCH, M_AREA_CD)

| Column | Type | Null |
| --- | --- | --- |
| M_AREA_CD | NUMBER(3) | N |
| MASTER_AREA_NMAE | VARCHAR2(300) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DISTRICT

Karachi districts under an area. Source: Karachi only.

- PK: (BRNCH, AREA_CD, DIST_CD)

| Column | Type | Null |
| --- | --- | --- |
| AREA_CD | NUMBER | N |
| DIST_CD | NUMBER | N |
| DIST_NAME | VARCHAR2(50) | Y |
| OLD_DISTRICT_CD | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CITY

Karachi cities under a district. Source: Karachi only.

- PK: (BRNCH, AREA_CD, DIST_CD, CITY_CD)
- FK FK_CITY_6: (BRNCH, AREA_CD, DIST_CD) → DISTRICT (BRNCH, AREA_CD, DIST_CD)

| Column | Type | Null |
| --- | --- | --- |
| AREA_CD | NUMBER | N |
| DIST_CD | NUMBER | N |
| CITY_CD | NUMBER | N |
| CITY_NAME | VARCHAR2(50) | Y |
| OLD_DIST_CD | NUMBER | Y |
| STATS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DISTRICT_DTL

District details used in rates and reports. Source: Karachi + Islamabad.

- UK UK_DISTRICT_DTL_N1: (BRNCH, DIST_CD, EFDATE, AREA_CD)

| Column | Type | Null |
| --- | --- | --- |
| DIST_CD | NUMBER | N |
| FREIGHT | NUMBER | Y |
| COGM | NUMBER | Y |
| FIX_PLANT | NUMBER | Y |
| FIX_HO | NUMBER | Y |
| DEPRC | NUMBER | Y |
| EFDATE | DATE | N |
| WDATE | DATE | Y |
| AREA_CD | NUMBER | N |
| SERNO | VARCHAR2(10) | Y |
| RAW_MATERIAL | NUMBER | Y |
| PACKING_MATERIAL | NUMBER | Y |
| ELECTRICITY_EXPENSE | NUMBER | Y |
| COAL_COST | NUMBER | Y |
| GAS_COST | NUMBER | Y |
| OTHERS | NUMBER | Y |
| FIX_HOG | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### REGION

Price regions. Source: Karachi + Islamabad.

- PK: (BRNCH, REGION)

| Column | Type | Null |
| --- | --- | --- |
| REGION | VARCHAR2(3) | N |
| DESCRIPTION | VARCHAR2(35) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### REGION_DETAIL

Areas in a price region. Source: Karachi + Islamabad.

- UK UK_REGION_DETAIL_N1: (BRNCH, REGION, CUSTOMER_FROM, CUSTOMER_TO)
- FK FK_REGION_DETAIL_61: (BRNCH, REGION) → REGION (BRNCH, REGION)

| Column | Type | Null |
| --- | --- | --- |
| REGION | VARCHAR2(3) | N |
| CUSTOMER_FROM | VARCHAR2(11) | N |
| CUSTOMER_TO | VARCHAR2(11) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### NEW_REGION

Karachi revised regions. Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| NEW_REGION_ID | NUMBER | Y |
| REGION_DESC | VARCHAR2(100) | Y |
| FROM_CODE | VARCHAR2(7) | Y |
| TO_CODE | VARCHAR2(7) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### REG_DESC

Region descriptions. Source: Karachi only.

- PK: (BRNCH, CODE)

| Column | Type | Null |
| --- | --- | --- |
| CODE | VARCHAR2(10) | N |
| REG_CODE | VARCHAR2(3) | Y |
| REG_NO | NUMBER | Y |
| DESCRIPTION | VARCHAR2(25) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Products and tax

### GROUP_MST

Product groups (Bulk & Exempted, Clinker, Export, Local, Scrape, GGBFS). Source: Karachi only.

- PK: (BRNCH, GRP_ID)

| Column | Type | Null |
| --- | --- | --- |
| GRP_ID | NUMBER | N |
| NAME | VARCHAR2(255) | Y |
| ORD_BY | NUMBER(5) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRODUCT_TYPE

Product types under a group. Source: Karachi + Islamabad.

- UK UK_PRODUCT_TYPE_N1: (BRNCH, PROD_ID)
- FK FK_PRODUCT_TYPE_11: (BRNCH, GRP_ID_FK) → GROUP_MST (BRNCH, GRP_ID)

| Column | Type | Null |
| --- | --- | --- |
| PROD_ID | VARCHAR2(20) | N |
| NAME | VARCHAR2(255) | Y |
| ORD_BY | NUMBER | Y |
| GRP_ID_FK | NUMBER(5) | Y |
| GROUP_PRODUCT_ID | NUMBER(4) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### GROUP_PRODUCT

Product grouping for reports. Source: Karachi only.

- PK: (BRNCH, GROUP_PRODUCT_ID)

| Column | Type | Null |
| --- | --- | --- |
| GROUP_PRODUCT_ID | NUMBER(4) | N |
| GROUP_PRODUCT_CODE | VARCHAR2(50) | Y |
| GROUP_PRODUCT_NAME | VARCHAR2(50) | Y |
| GROUP_PRODUCT_ORDER | NUMBER(3) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRODUCT_DESC_T

Products per branch and period: MRP, retail, FED, sales tax. Source: Karachi + Islamabad.

- PK: (BRNCH, PRODUCT_CODE, PERIOD#)

| Column | Type | Null |
| --- | --- | --- |
| PRODUCT_CODE | VARCHAR2(4) | N |
| PRODUCT_NAME | VARCHAR2(60) | N |
| AVG_RATE | NUMBER(12,2) | Y |
| CED | NUMBER(12,2) | Y |
| CODE | NUMBER(12,2) | Y |
| PRODUCT_TYPE | VARCHAR2(1) | Y |
| R_PRICE | NUMBER | Y |
| COMPANY_PRICE | NUMBER | Y |
| P_SALES_TAX | NUMBER(10,2) | Y |
| P_SALES_TAX_PER | NUMBER(10,2) | Y |
| PERIOD# | NUMBER | N |
| DATE_FROM | DATE | Y |
| DATE_TO | DATE | Y |
| STATUS | VARCHAR2(1) | Y |
| BRAND | VARCHAR2(4) | Y |
| HSCODE | VARCHAR2(9) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRODUCT_DESC_DTL

Product detail lines. Source: Karachi only.

- PK: (BRNCH, PDD_ID)

| Column | Type | Null |
| --- | --- | --- |
| PDD_ID | NUMBER | N |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| AVG_RATE | NUMBER | Y |
| CED | NUMBER | Y |
| DT_FROM | DATE | Y |
| DT_TO | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PROD_BRAND

Product brand names. Source: Karachi only.

- UK UK_PROD_BRAND_N1: (BRNCH, BRAND)

| Column | Type | Null |
| --- | --- | --- |
| BRAND | VARCHAR2(4) | Y |
| DESCR | VARCHAR2(100) | Y |
| STATS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BAG

Bag types. Source: Karachi + Islamabad.

- UK UK_BAG_N1: (BRNCH, BAG_CD)

| Column | Type | Null |
| --- | --- | --- |
| BAG_CD | NUMBER | Y |
| BAG_DESC | VARCHAR2(200) | Y |
| PRODID | VARCHAR2(6) | Y |
| STATS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BAGS_COLOR

Bag colours. Source: Karachi only.

- PK: (BRNCH, COLOR)

| Column | Type | Null |
| --- | --- | --- |
| COLOR | NUMBER | N |
| DESCR | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DELIVERY_ORDER_TYPE

DO types (product + local/outstation). Source: Karachi + Islamabad.

- PK: (BRNCH, DO_CODE)

| Column | Type | Null |
| --- | --- | --- |
| DO_CODE | VARCHAR2(10) | N |
| DO_DESC | VARCHAR2(60) | Y |
| DO_TYPE | VARCHAR2(2) | Y |
| PRODUCT_CODE | VARCHAR2(4) | N |
| LOGO | BLOB | Y |
| CODE | NUMBER(2) | N |
| MGROUP | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SALES_TAX

Sales tax rates. Source: Karachi + Islamabad.


| Column | Type | Null |
| --- | --- | --- |
| SALES_TAX_TYPE | VARCHAR2(1) | N |
| DESCRIPTIONS | VARCHAR2(20) | N |
| PERCENT | NUMBER(6,2) | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SALES_TAX_FED

FED rates. Source: Karachi only.

- UK UK_SALES_TAX_FED_N1: (BRNCH, WDATE)

| Column | Type | Null |
| --- | --- | --- |
| WDATE | DATE | Y |
| STAX | NUMBER | Y |
| STAX1 | NUMBER | Y |
| FED | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CED_SETUP

CED setup. Source: Karachi only.

- UK UK_CED_SETUP_N1: (BRNCH, S_NO)

| Column | Type | Null |
| --- | --- | --- |
| S_NO | NUMBER(3) | Y |
| FROM_DATE | DATE | Y |
| TO_DATE | DATE | Y |
| CED_PERCENTAGE | NUMBER(6,2) | Y |
| REMS | VARCHAR2(2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Pricing and discounts

### TRADE_PRICE

Trade price per customer, city and product (DO clients). Source: Karachi + Islamabad.

- PK: (BRNCH, AREA_CODE)

| Column | Type | Null |
| --- | --- | --- |
| AREA_CODE | VARCHAR2(10) | N |
| AREA_DESC | VARCHAR2(30) | N |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| TRADE_DISC | NUMBER(8,2) | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| INVOICE_PRICE | NUMBER | Y |
| PRICE_EXCL_ST | NUMBER | Y |
| COMPANY_PRICE | NUMBER | Y |
| ACTIVE | VARCHAR2(1) | Y |
| SALES_TAX_PERCENT | NUMBER(10,2) | Y |
| SALES_TAX_AMT | NUMBER(10,2) | Y |
| RETAIL_PRICE | NUMBER(10,2) | Y |
| CED | NUMBER(10,2) | Y |
| PRICE_DISCOUNT | NUMBER(10,2) | Y |
| AREA | NUMBER | Y |
| DISTRICT | NUMBER | Y |
| AREACD_PK | VARCHAR2(8) | Y |
| CUSTOMER_CODE | VARCHAR2(14) | Y |
| EF_DATE | DATE | Y |
| TARGET | NUMBER | Y |
| CITY_CD | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AREA_RATES_M

Daily city rate sheet header (permit clients). Source: Karachi + Islamabad.

- PK: (BRNCH, SERNO)
- UK UK_AREA_RATES_M_N1: (BRNCH, WDATE)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| WDATE | DATE | Y |
| STATUS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AREA_RATES_P

Products on a rate sheet. Source: Karachi + Islamabad.

- PK: (BRNCH, P_LNKNO)
- FK FK_AREA_RATES_P_1: (BRNCH, SERNO) → AREA_RATES_M (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| P_LNKNO | NUMBER | N |
| PRODUCT_CODE | VARCHAR2(10) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AREA_RATES_D

City-wise rates on a rate sheet. Source: Karachi + Islamabad.

- PK: (BRNCH, LNKNO)
- FK FK_AREA_RATES_D_2: (BRNCH, P_LNKNO) → AREA_RATES_P (BRNCH, P_LNKNO)
- FK FK_AREA_RATES_D_3: (BRNCH, SERNO) → AREA_RATES_M (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| LNKNO | NUMBER | N |
| P_LNKNO | NUMBER | Y |
| ZONE_CODE | VARCHAR2(10) | Y |
| TERRITORY_CODE | VARCHAR2(10) | Y |
| AREA_DOC | NUMBER | Y |
| BOOKING_P | NUMBER | Y |
| FREIGHT | NUMBER | Y |
| NET_BOOK | NUMBER | Y |
| REBATE | NUMBER | Y |
| EX_FACTORY | NUMBER | Y |
| TAX_236 | NUMBER | Y |
| FED | NUMBER | Y |
| SALES_TAX | NUMBER | Y |
| NET_RET | NUMBER | Y |
| MRP | NUMBER | Y |
| LINKNO_DIST | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### AREA_RATES_DIST

District-wise rates (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| LNKNO | NUMBER | N |
| P_LNKNO | NUMBER | Y |
| G_CD | NUMBER | Y |
| AREA_CD | NUMBER | Y |
| DIST_CD | NUMBER | Y |
| BOOKING_P | NUMBER | Y |
| FREIGHT | NUMBER | Y |
| NET_BOOK | NUMBER | Y |
| REBATE | NUMBER | Y |
| EX_FACTORY | NUMBER | Y |
| TAX_236 | NUMBER | Y |
| FED | NUMBER | Y |
| SALES_TAX | NUMBER | Y |
| NET_RET | NUMBER | Y |
| MRP | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### REGION_PRICE_LIST

Price list per region. Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| REGION | VARCHAR2(3) | N |
| PRODUCT_CODE | VARCHAR2(4) | N |
| PRICE | NUMBER(14,2) | N |
| NORMAL_DISC | NUMBER(14,2) | Y |
| QTY_DISC | NUMBER(14,2) | Y |
| DEPOSIT_DISC | NUMBER(14,2) | Y |
| ADVANCE_DISC | NUMBER(14,2) | Y |
| TOTAL_DISC | NUMBER(14,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRICE_OPENING

Opening price per customer, area and product. Source: Karachi only.

- PK: (BRNCH, SERNO, CUSTOMER_CODE, EFDATE, AREA, DISTRICT, PRODUCT_CODE)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| EFDATE | DATE | N |
| AREA | NUMBER | N |
| DISTRICT | NUMBER | N |
| AREA_CODE | VARCHAR2(10) | N |
| PRODUCT_CODE | VARCHAR2(4) | N |
| MRP | NUMBER | N |
| FREIGHT | NUMBER | Y |
| D_MARGN | NUMBER | Y |
| S_MARGN | NUMBER | Y |
| R_MARGN | NUMBER | Y |
| OTHER | NUMBER | Y |
| COMPANY_PRICE | NUMBER | Y |
| I_TAX | NUMBER | Y |
| BOOKING_PRICE | NUMBER | Y |
| DIFF | NUMBER | Y |
| FED | NUMBER | Y |
| STAX | NUMBER | Y |
| TOTAL | NUMBER | Y |
| INVOICE | NUMBER | Y |
| INSENTIV | NUMBER | Y |
| RTENTION | NUMBER | Y |
| TARGET | NUMBER | Y |
| STATS | VARCHAR2(1) | Y |
| WDATE | DATE | Y |
| LNKNO | NUMBER | N |
| RESPER | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRICE_SLAB_PERIOD

Price slab periods. Source: Karachi only.

- PK: (BRNCH, P_CODE)

| Column | Type | Null |
| --- | --- | --- |
| P_CODE | NUMBER | N |
| FROM_DATE | DATE | Y |
| TO_DATE | DATE | Y |
| STATUS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRICE_SLAB

Price slabs. Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| PRICE_CODE | VARCHAR2(10) | Y |
| PRICE | NUMBER | Y |
| P_CODE | NUMBER | Y |
| SP_PRICE | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PRICE_SLAB_OC

Slab applied on an OC. Source: Karachi only.

- UK UK_PRICE_SLAB_OC_N1: (BRNCH, P_CODE, OC_NUMBER)

| Column | Type | Null |
| --- | --- | --- |
| P_CODE | NUMBER(3) | Y |
| OC_NUMBER | NUMBER(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### OC_PRICE_DTL

Price breakdown of an OC (ISB). Source: Islamabad only.


| Column | Type | Null |
| --- | --- | --- |
| D_ORDER_NO | NUMBER | Y |
| D_ORDER_DATE | DATE | Y |
| D_CUSTOMER_CODE | VARCHAR2(50) | Y |
| D_PRICE_CODE | VARCHAR2(20) | Y |
| D_RETAIL_PRICE | NUMBER | Y |
| D_TRADE_DISC | NUMBER | Y |
| D_CED | NUMBER | Y |
| D_SALES_TAX | NUMBER | Y |
| D_CONS_PRICE | NUMBER | Y |
| D_NET_BOOK_PRICE | NUMBER | Y |
| D_TOT_NET | NUMBER | Y |
| STATS | VARCHAR2(1) | Y |
| ENTRY_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ZONE_CITY_FRIEGHT_M

Freight sheet header. Source: Islamabad only.

- UK UK_ZONE_CITY_FRIEGHT_M_N1: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| WDATE | DATE | Y |
| EDATE | DATE | Y |
| STATUS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ZONE_CITY_FRIEGHT_D

Freight per city. Source: Islamabad only.

- UK UK_ZONE_CITY_FRIEGHT_D_N1: (BRNCH, SERNO, AREA_DOC)
- FK FK_ZONE_CITY_FRIEGHT_D_77: (BRNCH, SERNO) → ZONE_CITY_FRIEGHT_M (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| AREA_DOC | NUMBER | Y |
| FRIEGHT | NUMBER | Y |
| FRIEGHT_PER | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RATE_UPDATE_HISTORY

History of rate changes (ISB). Source: Islamabad only.


| Column | Type | Null |
| --- | --- | --- |
| WDATE | DATE | Y |
| UPDATE_BY | VARCHAR2(30) | Y |
| REMARKS | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DISCOUNT_TYPE

Discount types. Source: Karachi + Islamabad.

- PK: (BRNCH, DISCOUNT_CODE)

| Column | Type | Null |
| --- | --- | --- |
| DISCOUNT_CODE | VARCHAR2(10) | N |
| DISCOUNT_DESC | VARCHAR2(60) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DISCOUNT2

Discounts per customer/product. Source: Karachi + Islamabad.


| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| REGION | VARCHAR2(3) | Y |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| DATE_FROM | DATE | Y |
| DATE_TO | DATE | Y |
| STANDARD_DISC | NUMBER(16) | Y |
| QTY_DISC | NUMBER(16) | Y |
| MARKET_DISC | NUMBER(16) | Y |
| AREA_DISC | NUMBER(16) | Y |
| FINANCIAL_DISC | NUMBER(16) | Y |
| OTHER_DISC | NUMBER(16) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DISCOUNT_APP_MASTER

Discount approval header. Source: Karachi + Islamabad.

- PK: (BRNCH, DISCOUNT_NO)
- FK FK_DISCOUNT_APP_MASTER_46: (BRNCH, DISCOUNT_CODE) → DISCOUNT_TYPE (BRNCH, DISCOUNT_CODE)

| Column | Type | Null |
| --- | --- | --- |
| DISCOUNT_NO | NUMBER(8) | N |
| DISCOUNT_CODE | VARCHAR2(10) | Y |
| DIS_DATE | DATE | Y |
| TOTAL_DISCOUNT | NUMBER(12,2) | Y |
| LAST_APP_NO | NUMBER(8) | Y |
| CANCEL_ON | DATE | Y |
| MODE_OF_PAY | VARCHAR2(10) | Y |
| MIN_QTY_DIS | NUMBER(8,2) | Y |
| TOT_QTY_DIS | NUMBER(10,2) | Y |
| DURATION | DATE | Y |
| ADVANCE_AG_DEP | NUMBER(12,2) | Y |
| QTY_SPECIAL_DIS | NUMBER(8,2) | Y |
| TOT_QTY_SPDIS | NUMBER(8,2) | Y |
| MODE_OF_ADJ | VARCHAR2(10) | Y |
| FRQUENCY | NUMBER(2) | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DISCOUNT_APP_DETAIL

Discount approval lines. Source: Karachi + Islamabad.

- PK: (BRNCH, TR_NO)
- FK FK_DISCOUNT_APP_DETAIL_47: (BRNCH, DISCOUNT_NO) → DISCOUNT_APP_MASTER (BRNCH, DISCOUNT_NO)

| Column | Type | Null |
| --- | --- | --- |
| TR_NO | NUMBER(8) | N |
| DISCOUNT_NO | NUMBER(8) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Customers

### CUSTOMER_INFO

Customer master: code, name, contacts, zone, channel, tax profile, status. Source: Karachi + Islamabad.

- PK: (BRNCH, CUSTOMER_CODE)
- FK FK_CUSTOMER_INFO_19: (BRNCH, ZONE_CODE) → ZONE_DESC (BRNCH, ZONE_CODE)
- FK FK_CUSTOMER_INFO_20: (BRNCH, CHANNEL_CODE) → CHANNEL_DESC (BRNCH, CHANNEL_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| ZONE_CODE | VARCHAR2(10) | Y |
| CHANNEL_CODE | VARCHAR2(3) | Y |
| CUSTOMER_NAME | VARCHAR2(60) | Y |
| CUSTOMER_ADDRESS1 | VARCHAR2(60) | Y |
| CUSTOMER_ADDRESS2 | VARCHAR2(60) | Y |
| PH_NO | VARCHAR2(35) | Y |
| MOBILE_NO | VARCHAR2(35) | Y |
| FAX_NO | VARCHAR2(35) | Y |
| EMAIL | VARCHAR2(35) | Y |
| CUSTOMER_TYPE | VARCHAR2(3) | Y |
| CREDIT_LIMITE | NUMBER(14,2) | Y |
| CASH_DEPOSIT | NUMBER(14,2) | Y |
| DEBIT_AMOUNT | NUMBER(14,2) | Y |
| CREDIT_AMOUNT | NUMBER(14,2) | Y |
| MODE_OF_BUS | CHAR(1) | Y |
| CROSS_REF | VARCHAR2(11) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | VARCHAR2(10) | Y |
| TAX_DEDUCT | VARCHAR2(1) | Y |
| SECURITY_DESC | VARCHAR2(200) | Y |
| MISC | NUMBER(1) | Y |
| CLOSED | VARCHAR2(1) | Y |
| SALES_TAX_TYPE | VARCHAR2(1) | Y |
| SALES_TAX_NO | VARCHAR2(100) | Y |
| CLEAN | NUMBER(14,2) | Y |
| TRANSITORY | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| TAX | NUMBER(14,2) | Y |
| BOUNCE | NUMBER(14,2) | Y |
| CARD_OPEN_DATE | DATE | Y |
| CARD_CLOSED_DATE | DATE | Y |
| BUFFER | NUMBER(14,2) | Y |
| NTN | VARCHAR2(50) | Y |
| CNIC | VARCHAR2(50) | Y |
| CUSTOMER_GROUP | NUMBER(3) | Y |
| GL_CODE | VARCHAR2(10) | Y |
| ACTIVE | VARCHAR2(1) | Y |
| WH_TAX | NUMBER | Y |
| MCODE | VARCHAR2(7) | Y |
| CUSTM_M | VARCHAR2(7) | Y |
| TRNSP | VARCHAR2(1) | Y |
| SALES_TAX_STATS | VARCHAR2(1) | Y |
| INCOM_TAX_TYPE | VARCHAR2(1) | Y |
| INCOM_TAX_STATS | VARCHAR2(1) | Y |
| REGISTER_NAME | VARCHAR2(60) | Y |
| JURISDICTION | VARCHAR2(60) | Y |
| REGISTER_NUMBER | VARCHAR2(50) | Y |
| TERRITORY_CODE | VARCHAR2(20) | Y |
| REG_NO | VARCHAR2(50) | Y |
| BANK_FLOAT | NUMBER | Y |
| AREA_CODE | VARCHAR2(2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMER_MASTER

Master (parent) customer grouping branches of one dealer. Source: Karachi only.

- PK: (BRNCH, MCODE)

| Column | Type | Null |
| --- | --- | --- |
| MCODE | VARCHAR2(7) | N |
| DESCR | VARCHAR2(100) | Y |
| SNAME | VARCHAR2(20) | Y |
| CR_LIMIT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMER_GROUP

Customer groups. Source: Karachi + Islamabad.

- UK UK_CUSTOMER_GROUP_N1: (BRNCH, GROUP_ID)

| Column | Type | Null |
| --- | --- | --- |
| GROUP_ID | NUMBER | Y |
| GROUP_DESC | VARCHAR2(200) | Y |
| ADV_GROUP_DESC | VARCHAR2(200) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUST_GRP_MST

Customer group header (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| CG_ID | NUMBER(4) | Y |
| CG_S_NM | VARCHAR2(80) | Y |
| CG_L_NM | VARCHAR2(100) | Y |
| CG_CNTP | VARCHAR2(40) | Y |
| CG_GST# | VARCHAR2(35) | Y |
| CG_ADD1 | VARCHAR2(100) | Y |
| CG_ADD2 | VARCHAR2(100) | Y |
| CG_PH | VARCHAR2(30) | Y |
| CG_FAX | VARCHAR2(30) | Y |
| CG_EMAIL | VARCHAR2(30) | Y |
| CG_NTN# | VARCHAR2(20) | Y |
| CG_GLCODE | VARCHAR2(10) | Y |
| CG_TYPE | NUMBER | Y |
| CG_CITY | NUMBER(4) | Y |
| CG_COUNTRY | NUMBER(3) | Y |
| OLD_CUSTID | NUMBER(4) | Y |
| UNIT_ID | NUMBER(2) | Y |
| LOC_ID_UPD | VARCHAR2(2) | Y |
| ORG_ID_UPD | VARCHAR2(8) | Y |
| DEPT_ID_UPD | VARCHAR2(2) | Y |
| USR_ID_UPD | VARCHAR2(2) | Y |
| USR_DATE_UPD | DATE | Y |
| OPEN_BAL | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUST_GRP_DTL

Customers in a group (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| CG_ID | NUMBER(4) | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| CUSTOMER_COMPANY_ID | NUMBER(2) | Y |
| CG_ACTIVE | VARCHAR2(1) | Y |
| CG_D_ID | NUMBER(4) | Y |
| OPEN_BALANCE | NUMBER | Y |
| LOC_ID_UPD | VARCHAR2(2) | Y |
| ORG_ID_UPD | VARCHAR2(8) | Y |
| DEPT_ID_UPD | VARCHAR2(2) | Y |
| USR_ID_UPD | VARCHAR2(2) | Y |
| USR_DATE_UPD | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMERS_DCL

DCL customer list (KHI). Source: Karachi only.

- PK: (BRNCH, CUSTOMER_ID)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_ID | NUMBER | N |
| CUSTOMER_TYPE_ID | NUMBER(3) | Y |
| CUSTOMER_S_NAME | VARCHAR2(75) | Y |
| CUSTOMER_L_NAME | VARCHAR2(100) | Y |
| CUSTOMER_CONTACT_PERSON | VARCHAR2(35) | Y |
| CUSTOMER_GST_NO | VARCHAR2(35) | Y |
| CUSTOMER_ADD1 | VARCHAR2(100) | Y |
| CUSTOMER_ADD2 | VARCHAR2(100) | Y |
| CUSTOMER_PHONE | VARCHAR2(25) | Y |
| CUSTOMER_FAX | VARCHAR2(25) | Y |
| CUSTOMER_CELL | VARCHAR2(25) | Y |
| CUSTOMER_EMAIL | VARCHAR2(35) | Y |
| CUSTOMER_WEB | VARCHAR2(45) | Y |
| CUSTOMER_STATUS | VARCHAR2(1) | Y |
| CUSTOMER_CITY_ID | NUMBER(4) | Y |
| CUSTOMER_COUNTRY_ID | NUMBER(3) | Y |
| CUSTOMER_COMPANY_ID | NUMBER(2) | Y |
| NTN# | VARCHAR2(15) | Y |
| G_CODE | NUMBER | Y |
| GL_CODE | NUMBER(8) | Y |
| G_NAME | VARCHAR2(75) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMER_AREA

Areas a customer serves. Source: Karachi + Islamabad.

- UK UK_CUSTOMER_AREA_N1: (BRNCH, CUST_ID, ZONE_CODE, TERRITORY_CODE, AREA_DOC)
- FK FK_CUSTOMER_AREA_75: (BRNCH, CUST_ID) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CUST_ID | VARCHAR2(20) | Y |
| ZONE_CODE | NUMBER | Y |
| TERRITORY_CODE | NUMBER | Y |
| AREA_DOC | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMER_BANK_ACC

Customer bank accounts. Source: Karachi + Islamabad.

- PK: (BRNCH, BANK_CODE, ACCOUNT_NO)
- FK FK_CUSTOMER_BANK_ACC_30: (BRNCH, ZONE_CODE) → ZONE_DESC (BRNCH, ZONE_CODE)
- FK FK_CUSTOMER_BANK_ACC_31: (BRNCH, BANK_CODE) → BANK_DESC (BRNCH, BANK_CODE)
- FK FK_CUSTOMER_BANK_ACC_32: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| BANK_CODE | VARCHAR2(4) | N |
| ACCOUNT_NO | VARCHAR2(12) | N |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| ZONE_CODE | VARCHAR2(3) | Y |
| BRANCH_NAME | VARCHAR2(100) | N |
| CUST_ACC_ID | NUMBER(6) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CATEGORY_TYPE

BRV category: Clean, Transitory, Cash deposit, Cheque. Source: Karachi + Islamabad.

- PK: (BRNCH, CAT_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CAT_CODE | VARCHAR2(3) | N |
| CAT_DESC | VARCHAR2(60) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CHANNEL_DESC

Channels: dealer, direct, distributor, export…. Source: Karachi + Islamabad.

- PK: (BRNCH, CHANNEL_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CHANNEL_CODE | VARCHAR2(3) | N |
| CHANNEL_DESC | VARCHAR2(60) | N |
| SORT_BY | NUMBER | Y |
| GRP | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BLOCK_CUSTOMER

Block/unblock history per customer. Source: Karachi only.

- UK UK_BLOCK_CUSTOMER_N1: (BRNCH, B_CUSTOMER_CODE)
- FK FK_BLOCK_CUSTOMER_4: (BRNCH, G_CODE) → BLOCK_CUSTOMER_GROUP (BRNCH, G_CODE)
- FK FK_BLOCK_CUSTOMER_5: (BRNCH, B_CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| B_CUSTOMER_CODE | VARCHAR2(11) | Y |
| G_CODE | VARCHAR2(3) | Y |
| REMS | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BLOCK_CUSTOMER_GROUP

Block reasons/groups. Source: Karachi only.

- PK: (BRNCH, G_CODE)

| Column | Type | Null |
| --- | --- | --- |
| G_CODE | VARCHAR2(3) | N |
| G_NAME | VARCHAR2(100) | Y |
| SORT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BLOCK_ADV_DEBTS

Blocked advances and debts. Source: Karachi only.

- UK UK_BLOCK_ADV_DEBTS_N1: (BRNCH, CUSTOMER_CODE, TYPE)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| TYPE | VARCHAR2(50) | Y |
| AMOUNT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RESPONSIBLE_PERSON

Responsible sales person. Source: Karachi only.

- UK UK_RESPONSIBLE_PERSON_N1: (BRNCH, RESPER)

| Column | Type | Null |
| --- | --- | --- |
| RESPER | NUMBER | Y |
| DESCR | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Credit and security

### CREDIT_TYPE

Credit types A–J (clean, transitory, billing…). Source: Karachi + Islamabad.


| Column | Type | Null |
| --- | --- | --- |
| CREDIT_CODE | VARCHAR2(3) | N |
| CREDIT_DESC | VARCHAR2(40) | N |
| TYPE | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_LIMITS

Limits per customer and credit type. Source: Karachi + Islamabad.

- PK: (BRNCH, CUSTOMER_CODE)
- FK FK_CREDIT_LIMITS_28: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| CLEAN | NUMBER(14,2) | Y |
| CLEAN_A | NUMBER(14,2) | Y |
| TRANSITORY | NUMBER(14,2) | Y |
| TRANSITORY_A | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| BILLING_A | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| ADVANCE_A | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| SECURITY_A | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| INCENTIVE_A | NUMBER(14,2) | Y |
| TAX | NUMBER(14,2) | Y |
| TAX_A | NUMBER(14,2) | Y |
| BOUNCE | NUMBER(14,2) | Y |
| BOUNCE_A | NUMBER(14,2) | Y |
| BUFFER | NUMBER(14,2) | Y |
| BUFFER_A | NUMBER(14,2) | Y |
| BANK_FLOAT_A | NUMBER | Y |
| BANK_FLOAT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_LIMITS_F

Credit limit approval document. Source: Karachi + Islamabad.

- PK: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| CUSTOMER_CODE | VARCHAR2(20) | Y |
| WDATE | DATE | Y |
| OC_BAL | NUMBER | Y |
| LAST_APROVED | NUMBER | Y |
| AP_AMOUNT | NUMBER | Y |
| REMARK | VARCHAR2(200) | Y |
| PTYPE | VARCHAR2(2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_APP_MASTER

Credit approval header. Source: Karachi + Islamabad.


| Column | Type | Null |
| --- | --- | --- |
| CAS_NO | NUMBER(8) | N |
| CAS_DATE | DATE | N |
| CREDIT_CODE | VARCHAR2(3) | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_APP_DETAIL

Credit approval lines. Source: Karachi + Islamabad.

- FK FK_CREDIT_APP_DETAIL_26: (BRNCH, CAS_NO) → CREDIT_APP_MASTER (BRNCH, CAS_NO)
- FK FK_CREDIT_APP_DETAIL_27: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CAS_NO | NUMBER(8) | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| CREDIT_LIMIT | NUMBER(14,2) | Y |
| START_FROM | DATE | N |
| EXPIRE_ON | DATE | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_APP_MASTER1

Credit approval header (KHI, second form). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| CASE_NO | NUMBER(8) | N |
| CASE_DATE | DATE | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| CREDIT_LIMIT | NUMBER(14,2) | Y |
| PERIOD_CREDIT | NUMBER(4) | Y |
| SECURITY | NUMBER(14,2) | Y |
| GUANRANTY | VARCHAR2(20) | Y |
| GUANRANTY_DATE | DATE | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST | VARCHAR2(1) | Y |
| POST_BY | CHAR(10) | Y |
| POST_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_APP_DETAIL1

Credit approval lines (KHI, second form). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| CASE_NO | NUMBER(8) | N |
| CREDIT_CODE | VARCHAR2(3) | N |
| CREDIT_AMOUNT | NUMBER(14,2) | Y |
| PERIOD | NUMBER(4) | Y |
| TYPE_OF_SEC | VARCHAR2(10) | Y |
| PRE_CREDIT_AMT | NUMBER(14,2) | Y |
| EXPIRED_ON | DATE | Y |
| LAST_CASE_NO | NUMBER(8) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMER_CREDIT_APP

Customer approval request (credit, tax limit, cash). Source: Karachi + Islamabad.

- PK: (BRNCH, SERNO)
- UK UK_CUSTOMER_CREDIT_APP_N1: (BRNCH, CUSTM, EDATE, APP)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| CUSTM | VARCHAR2(100) | Y |
| CLIMIT | NUMBER | Y |
| EDATE | DATE | Y |
| REQUEST_DT | DATE | Y |
| REQUESTER | VARCHAR2(100) | Y |
| APP_DATE | DATE | Y |
| APP_NAME | VARCHAR2(100) | Y |
| APP | VARCHAR2(1) | Y |
| UNIT | NUMBER | Y |
| UNIT_NM | VARCHAR2(50) | Y |
| APP_TYPE | VARCHAR2(10) | Y |
| TAX_TYPE | VARCHAR2(10) | Y |
| AMT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### LOG_CUSTOMER_CREDIT_APP

History of approval requests (ISB). Source: Islamabad only.


| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| CUSTM | VARCHAR2(100) | Y |
| CLIMIT | NUMBER | Y |
| EDATE | DATE | Y |
| REQUEST_DT | DATE | Y |
| REQUESTER | VARCHAR2(100) | Y |
| APP_DATE | DATE | Y |
| APP_NAME | VARCHAR2(100) | Y |
| APP | VARCHAR2(1) | Y |
| UNIT | NUMBER | Y |
| UNIT_NM | VARCHAR2(50) | Y |
| APP_TYPE | VARCHAR2(10) | Y |
| TAX_TYPE | VARCHAR2(10) | Y |
| AMT | NUMBER | Y |
| TYPE_IUD_CM | VARCHAR2(1) | Y |
| V_MACHINE | VARCHAR2(200) | Y |
| V_OSUSER | VARCHAR2(200) | Y |
| DML_TIME | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_MONITOR

Credit monitoring entries (ISB). Source: Islamabad only.


| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| TDATE | DATE | N |
| CREDIT_TYPE | VARCHAR2(3) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| MODULE | VARCHAR2(12) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SECURITY_DEPOSIT

Security deposit lines per customer. Source: Karachi + Islamabad.

- FK FK_SECURITY_DEPOSIT_63: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| DESCRIPTION | VARCHAR2(30) | N |
| AMOUNT | NUMBER(16,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CSECURITY_DEPOSIT

Customer security deposit receipts. Source: Karachi + Islamabad.

- UK UK_CSECURITY_DEPOSIT_N1: (BRNCH, RECEIPT_NO, DR_CR)
- FK FK_CSECURITY_DEPOSIT_29: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| RECEIPT_NO | NUMBER(7) | N |
| TDATE | DATE | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| TYPE | VARCHAR2(1) | N |
| CHQ_NO | VARCHAR2(20) | Y |
| AMOUNT | NUMBER(14,2) | N |
| REMARKS | VARCHAR2(60) | Y |
| DR_CR | VARCHAR2(1) | N |
| CHQ_DATE | DATE | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| PRINT | NUMBER(1) | Y |
| POST | VARCHAR2(1) | Y |
| VOUCHER_NO | VARCHAR2(20) | Y |
| VOUCHER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TSECURITY_DEPOSIT

Transporter security deposits (ISB). Source: Islamabad only.

- PK: (BRNCH, RECEIPT_NO, DR_CR)
- FK FK_TSECURITY_DEPOSIT_70: (BRNCH, TRANSP_CODE) → TRANSPORTER_DESC (BRNCH, TRANSP_CODE)

| Column | Type | Null |
| --- | --- | --- |
| RECEIPT_NO | NUMBER(7) | N |
| TDATE | DATE | N |
| TRANSP_CODE | VARCHAR2(3) | N |
| TYPE | VARCHAR2(1) | N |
| CHQ_NO | VARCHAR2(20) | Y |
| AMOUNT | NUMBER(14,2) | N |
| REMARKS | VARCHAR2(60) | Y |
| DR_CR | VARCHAR2(1) | N |
| CHQ_DATE | DATE | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| PRINT | NUMBER(1) | Y |
| POST | VARCHAR2(1) | Y |
| VOUCHER_NO | VARCHAR2(20) | Y |
| VOUCHER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Banks and receipts (BRV)

### BANK_DESC

Banks. Source: Karachi + Islamabad.

- PK: (BRNCH, BANK_CODE)

| Column | Type | Null |
| --- | --- | --- |
| BANK_CODE | VARCHAR2(4) | N |
| BANK_NAME | VARCHAR2(60) | N |
| BANK_TYPE | VARCHAR2(3) | N |
| ACC_ID | VARCHAR2(8) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### COMPANY_BANK

Company deposit accounts. Source: Karachi + Islamabad.


| Column | Type | Null |
| --- | --- | --- |
| BANK_CODE | VARCHAR2(6) | N |
| BANK_DESC | VARCHAR2(40) | N |
| ACCOUNT | VARCHAR2(20) | N |
| BRANCH_NAME | VARCHAR2(30) | N |
| DEF | NUMBER(1) | Y |
| ABBR | VARCHAR2(6) | Y |
| RETURN_CHARGES | NUMBER(6,2) | Y |
| ACC_ID | VARCHAR2(8) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### INSTRUMENT_TYPE

Mode of payment: DD, TT, cheque, pay order…. Source: Karachi + Islamabad.

- PK: (BRNCH, INST_CODE)

| Column | Type | Null |
| --- | --- | --- |
| INST_CODE | VARCHAR2(3) | N |
| INST_DESC | VARCHAR2(60) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CASH_CHEQUE_RECEIPTS

BRV: every customer payment with instrument and status. Source: Karachi + Islamabad.

- UK UK_CASH_CHEQUE_RECEIPTS_N1: (BRNCH, RECEIPT_NO, CASH_CHEQ_CD)
- FK FK_CASH_CHEQUE_RECEIPTS_21: (BRNCH, BANK) → COMPANY_BANK (BRNCH, BANK_CODE)
- FK FK_CASH_CHEQUE_RECEIPTS_22: (BRNCH, BANK_CODE) → BANK_DESC (BRNCH, BANK_CODE)
- FK FK_CASH_CHEQUE_RECEIPTS_23: (BRNCH, INST_CODE) → INSTRUMENT_TYPE (BRNCH, INST_CODE)
- FK FK_CASH_CHEQUE_RECEIPTS_24: (BRNCH, CAT_CODE) → CATEGORY_TYPE (BRNCH, CAT_CODE)
- FK FK_CASH_CHEQUE_RECEIPTS_25: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| RECEIPT_NO | NUMBER(16) | N |
| BANK_CODE | VARCHAR2(4) | Y |
| ACCOUNT_NO | VARCHAR2(12) | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| CR_DATE | DATE | Y |
| CASH_CHEQ_CD | VARCHAR2(1) | N |
| CHEQUE_NO | VARCHAR2(60) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| RETURN_CD | VARCHAR2(1) | Y |
| POST_BY | VARCHAR2(10) | Y |
| REM | VARCHAR2(100) | Y |
| CAT_CODE | VARCHAR2(3) | Y |
| INST_CODE | VARCHAR2(3) | Y |
| RETURN_DATE | DATE | Y |
| RECEIPT_DATE | DATE | Y |
| MOD_REC_NO | NUMBER(19) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| POST | VARCHAR2(1) | Y |
| PRINT | NUMBER(2) | Y |
| TAX | NUMBER(14,2) | Y |
| CHEQUE_DATE | DATE | Y |
| LOCAL_OUT | VARCHAR2(10) | Y |
| SUBMIT | NUMBER(1) | Y |
| BANK | VARCHAR2(6) | Y |
| DEPOSIT_DATE | DATE | Y |
| CLEAR_DATE | DATE | Y |
| TRANSITORY | NUMBER(14,2) | Y |
| BUFFER | NUMBER(14,2) | Y |
| CLEAN | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| TAX_A | NUMBER(14,2) | Y |
| A_CHK | VARCHAR2(2) | Y |
| SALES_TAX | NUMBER(14,2) | Y |
| FREIGHT | NUMBER | Y |
| TRANS_NAME | VARCHAR2(20) | Y |
| USRID | VARCHAR2(10) | Y |
| CHQ# | NUMBER | Y |
| CANCEL_STATS | VARCHAR2(1) | Y |
| CANCEL_AMT | NUMBER | Y |
| CANCEL_DT | DATE | Y |
| CLEAR_DT | DATE | Y |
| FUND_FROM | VARCHAR2(50) | Y |
| DEPOSIT_BANK_CODE | VARCHAR2(4) | Y |
| DEPOSITOR | VARCHAR2(50) | Y |
| DISTRIBUTOR | VARCHAR2(11) | Y |
| BANK_FLOAT | NUMBER | Y |
| CITY | VARCHAR2(50) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ORDER_CONFIRM_BRV

Link BRV ↔ OC with amount applied. Source: Karachi only.

- PK: (BRNCH, SERNO)
- FK FK_ORDER_CONFIRM_BRV_72: (BRNCH, ORDER_NO) → ORDER_CONFIRM (BRNCH, ORDER_NO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| ORDER_NO | NUMBER | Y |
| RECEIPT_NO | NUMBER | Y |
| MOD_REC_NO | NUMBER | Y |
| CR_DATE | DATE | Y |
| CASH_CHEQ_CD | VARCHAR2(2) | Y |
| AMOUNT | NUMBER | Y |
| REM | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BRV_DTL

BRV detail lines (KHI). Source: Karachi only.

- PK: (BRNCH, DTLNO)

| Column | Type | Null |
| --- | --- | --- |
| DTLNO | NUMBER | N |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| INV_NO | NUMBER | Y |
| INV_DATE | DATE | Y |
| DC_NO | NUMBER | Y |
| QTY | NUMBER | Y |
| INV_AMOUNT | NUMBER | Y |
| BRV_NO | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BANK_DEPOSIT

Bank deposit slips. Source: Karachi + Islamabad.

- UK UK_BANK_DEPOSIT_N1: (BRNCH, DEPOSIT_DATE)

| Column | Type | Null |
| --- | --- | --- |
| DEPOSIT_DATE | DATE | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BANK_DEPOSIT1

Bank deposit detail (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| MOD_REC_NO | NUMBER(19) | Y |
| CR_DATE | DATE | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| CUSTOMER_NAME | VARCHAR2(60) | Y |
| LOCAL_OUT | VARCHAR2(10) | Y |
| BANK_NAME | VARCHAR2(60) | N |
| CHEQUE_DATE | DATE | Y |
| CHEQUE_NO | VARCHAR2(60) | Y |
| INST_DESC | VARCHAR2(60) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| REM | VARCHAR2(100) | Y |
| BANK | VARCHAR2(250) | Y |
| COMPANY_BANK | VARCHAR2(250) | Y |
| ACCOUNT | VARCHAR2(250) | Y |
| DEPOSIT | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RECEIPT_CANCEL_MASTER

BRV cancellation header. Source: Karachi + Islamabad.

- UK UK_RECEIPT_CANCEL_MASTER_N1: (BRNCH, CANCEL_NO)
- UK UK_RECEIPT_CANCEL_MASTER_N2: (BRNCH, CANCEL_NO, CASH_CHEQ_CD)
- FK FK_RECEIPT_CANCEL_MASTER_60: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CANCEL_NO | VARCHAR2(19) | N |
| MEMO_NO | VARCHAR2(30) | Y |
| MEMO_DATE | DATE | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| CASH_CHEQ_CD | VARCHAR2(1) | N |
| CANCEL_TYPE | VARCHAR2(1) | N |
| RETURN_CHARGES | NUMBER(6,2) | Y |
| AMOUNT | NUMBER(14,2) | N |
| REMARKS | VARCHAR2(60) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| POST | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RECEIPT_CANCEL_DETAIL

BRV cancellation lines. Source: Karachi + Islamabad.

- UK UK_RECEIPT_CANCEL_DETAIL_N1: (BRNCH, CANCEL_NO, SRL_NO)
- FK FK_RECEIPT_CANCEL_DETAIL_78: (BRNCH, CANCEL_NO) → RECEIPT_CANCEL_MASTER (BRNCH, CANCEL_NO)

| Column | Type | Null |
| --- | --- | --- |
| CANCEL_NO | VARCHAR2(19) | N |
| CASH_CHEQ_CD | VARCHAR2(1) | N |
| SRL_NO | NUMBER(13) | N |
| RECEIPT_NO | NUMBER(19) | N |
| RECEIPT_SRL | NUMBER(16) | N |
| AMOUNT | NUMBER(14,2) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RECEIPT_CANCEL

BRV cancellation (single form). Source: Karachi + Islamabad.

- PK: (BRNCH, CANCEL_NO)

| Column | Type | Null |
| --- | --- | --- |
| CANCEL_NO | NUMBER(6) | N |
| RECEIPT_NO | NUMBER(6) | N |
| CASH_CHEQ_CD | CHAR(1) | N |
| CANCEL_DATE | DATE | N |
| AMOUNT | NUMBER(14,2) | Y |
| POST_BY | VARCHAR2(10) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| REM | VARCHAR2(60) | Y |
| CONDITION | VARCHAR2(1) | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| RECEIPT_SRL | NUMBER(6) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### BRV_CANCEL_DTL

Cancelled BRV copy (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| RECEIPT_NO | NUMBER(6) | N |
| BANK_CODE | VARCHAR2(4) | Y |
| ACCOUNT_NO | VARCHAR2(12) | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| CR_DATE | DATE | Y |
| CASH_CHEQ_CD | VARCHAR2(1) | Y |
| CHEQUE_NO | VARCHAR2(60) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| RETURN_CD | VARCHAR2(1) | Y |
| POST_BY | VARCHAR2(10) | Y |
| REM | VARCHAR2(100) | Y |
| CAT_CODE | VARCHAR2(3) | Y |
| INST_CODE | VARCHAR2(3) | Y |
| RETURN_DATE | DATE | Y |
| RECEIPT_DATE | DATE | Y |
| MOD_REC_NO | NUMBER(9) | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| POST | VARCHAR2(1) | Y |
| PRINT | NUMBER(2) | Y |
| TAX | NUMBER(14,2) | Y |
| CHEQUE_DATE | DATE | Y |
| LOCAL_OUT | VARCHAR2(10) | Y |
| SUBMIT | NUMBER(1) | Y |
| BANK | VARCHAR2(6) | Y |
| DEPOSIT_DATE | DATE | Y |
| CLEAR_DATE | DATE | Y |
| TRANSITORY | NUMBER(14,2) | Y |
| BUFFER | NUMBER(14,2) | Y |
| CLEAN | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| TAX_A | NUMBER(14,2) | Y |
| A_CHK | VARCHAR2(2) | Y |
| SALES_TAX | NUMBER(14,2) | Y |
| FREIGHT | NUMBER | Y |
| TRANS_NAME | VARCHAR2(20) | Y |
| USRID | VARCHAR2(10) | Y |
| CHQ# | NUMBER | Y |
| CANCEL_STATS | VARCHAR2(1) | Y |
| CANCEL_AMT | NUMBER | Y |
| CANCEL_DT | DATE | Y |
| CLEAR_DT | DATE | Y |
| STATUS | VARCHAR2(1) | Y |
| FUND_FROM | VARCHAR2(50) | Y |
| DEPOSIT_BANK_CODE | VARCHAR2(4) | Y |
| DEPOSITOR | VARCHAR2(50) | Y |
| DISTRIBUTOR | VARCHAR2(11) | Y |
| BANK_FLOAT | NUMBER | Y |
| CITY | VARCHAR2(50) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Orders: SRF and OC

### SALES_REQUEST_MASTER

SRF header: customer, product, quantity, terms. Source: Karachi + Islamabad.

- PK: (BRNCH, SRF_NO)
- FK FK_SALES_REQUEST_MASTER_38: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)
- FK FK_SALES_REQUEST_MASTER_80: (BRNCH, BAG_CD) → BAG (BRNCH, BAG_CD)
- FK FK_SALES_REQUEST_MASTER_81: (BRNCH, COLOR) → BAGS_COLOR (BRNCH, COLOR)

| Column | Type | Null |
| --- | --- | --- |
| SRF_NO | NUMBER(14) | N |
| PRODUCT_CODE | VARCHAR2(4) | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| SRF_DATE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| MODE_OF_DELIV | VARCHAR2(4) | Y |
| MODE_OF_TRANSP | VARCHAR2(3) | Y |
| LOCAL_EXPORT | CHAR(1) | Y |
| REMARKS | VARCHAR2(100) | Y |
| POST_BY | CHAR(1) | Y |
| NAME_OF_PER | VARCHAR2(60) | Y |
| CODE_NO | VARCHAR2(10) | Y |
| ADDRESS | VARCHAR2(120) | Y |
| TERM_OF_SALE | CHAR(1) | Y |
| SPECIAL_INST | VARCHAR2(100) | Y |
| NO_OF_BAGS | NUMBER(8,2) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| SALES_TAX_TYPE | VARCHAR2(1) | Y |
| SALES_TAX_NO | VARCHAR2(25) | Y |
| REG | VARCHAR2(10) | Y |
| MOD_REC_NO | NUMBER(9) | Y |
| CASH_CHEQ_CD | VARCHAR2(1) | Y |
| BAG_CD | NUMBER | Y |
| NTN | VARCHAR2(50) | Y |
| CNIC | VARCHAR2(50) | Y |
| PINO | VARCHAR2(40) | Y |
| FORM_E | VARCHAR2(30) | Y |
| LC_NO | VARCHAR2(20) | Y |
| BRV_NO | NUMBER | Y |
| BRV_AMONT | NUMBER | Y |
| BRV_REM | VARCHAR2(200) | Y |
| COLOR | NUMBER | Y |
| TCHNG_ALLOW | VARCHAR2(1) | Y |
| FREIGHT_STATUS | VARCHAR2(20) | Y |
| AREA_CODE | NUMBER | Y |
| SILO | VARCHAR2(3) | Y |
| TRANSPORTER_2 | VARCHAR2(3) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SALES_REQUEST_DETAIL

SRF schedule lines. Source: Karachi + Islamabad.

- PK: (BRNCH, SRF_NO, SR_NO)
- FK FK_SALES_REQUEST_DETAIL_62: (BRNCH, SRF_NO) → SALES_REQUEST_MASTER (BRNCH, SRF_NO)

| Column | Type | Null |
| --- | --- | --- |
| SR_NO | CHAR(18) | N |
| SRF_NO | NUMBER(8) | N |
| SCH_DATE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| SRF_DATE | DATE | Y |
| POST_BY | CHAR(1) | Y |
| POST_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ORDER_CONFIRM

OC header: price breakdown, net value, approval. Source: Karachi + Islamabad.

- PK: (BRNCH, ORDER_NO)
- FK FK_ORDER_CONFIRM_39: (BRNCH, AREA_CODE) → TRADE_PRICE (BRNCH, AREA_CODE)
- FK FK_ORDER_CONFIRM_40: (BRNCH, SRF_NO) → SALES_REQUEST_MASTER (BRNCH, SRF_NO)
- FK FK_ORDER_CONFIRM_41: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| ORDER_NO | NUMBER(9) | N |
| SRF_NO | NUMBER(14) | N |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| ORDER_DATE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| RETAIL_PRICE | NUMBER(14,2) | Y |
| SALES_TAX | NUMBER(12,2) | Y |
| CONS_PRICE | NUMBER(12,2) | Y |
| EXPENSE | NUMBER(12,2) | Y |
| DISCOUNT | NUMBER(12,2) | Y |
| POST_BY | CHAR(1) | Y |
| CANCEL_CODE | CHAR(1) | Y |
| SR_NO | NUMBER(6) | Y |
| NET_BOOK_PRICE | NUMBER(14,2) | Y |
| TOT_NET | NUMBER(17,2) | Y |
| REMARKS | VARCHAR2(100) | Y |
| TMP_SRF | NUMBER(8) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| PRINT | NUMBER(2) | Y |
| CED | NUMBER(12,2) | Y |
| GROSS_PRICE | NUMBER(12,2) | Y |
| AREA_CODE | VARCHAR2(10) | Y |
| TRADE_DISC | NUMBER(8,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| CLEAN | NUMBER(14,2) | Y |
| BUFFER | NUMBER(14,2) | Y |
| APPROVED | VARCHAR2(10) | Y |
| NOT_APPROVED | VARCHAR2(10) | Y |
| EX_FACT_PRICE | NUMBER | Y |
| TAX_FLAG | VARCHAR2(1) | Y |
| TAX_PERCENT | NUMBER(6,3) | Y |
| PAYMENT_RECEIVE | NUMBER | Y |
| CREDIT_BALANCE | NUMBER | Y |
| CREDIT_SALE | NUMBER | Y |
| AREA_CODE_BK | VARCHAR2(10) | Y |
| BRV_TYP | VARCHAR2(4) | Y |
| BRV_REMRK | VARCHAR2(100) | Y |
| CREDIT_STATS | VARCHAR2(1) | Y |
| INCOM_TAX_STATS | VARCHAR2(1) | Y |
| SALES_TAX_STATS | VARCHAR2(1) | Y |
| INCOM_TAX_TYPE | VARCHAR2(1) | Y |
| SALES_TAX_TYPE | VARCHAR2(1) | Y |
| TBUFFER | NUMBER | Y |
| TTRANSITORY | NUMBER | Y |
| TADVANCE | NUMBER | Y |
| TBANK_FLOAT | NUMBER | Y |
| TINCENTIVE | NUMBER | Y |
| TRANSITORY | NUMBER | Y |
| TSECURITY | NUMBER | Y |
| TBOUNCE | NUMBER | Y |
| TCLEAN | NUMBER | Y |
| TBILLING | NUMBER | Y |
| TTAX | NUMBER | Y |
| TSECURIRY | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ORDER_CONFIRM_DETAIL

OC schedule lines (one per DO). Source: Karachi + Islamabad.

- PK: (BRNCH, ORDER_NO, SR_NO)
- FK FK_ORDER_CONFIRM_DETAIL_56: (BRNCH, ORDER_NO) → ORDER_CONFIRM (BRNCH, ORDER_NO)

| Column | Type | Null |
| --- | --- | --- |
| SR_NO | NUMBER(4) | N |
| ORDER_NO | NUMBER(9) | N |
| SCH_DATE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| ORDER_DATE | DATE | Y |
| POST_BY | CHAR(1) | Y |
| SRF_NO | NUMBER(8) | Y |
| POST_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ORDER_CANCEL_MASTER

Order cancellation advice header. Source: Karachi + Islamabad.

- PK: (BRNCH, OC_ADVISE_NO)
- FK FK_ORDER_CANCEL_MASTER_54: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| OC_ADVISE_NO | NUMBER(6) | N |
| OC_ADVISE_DATE | DATE | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| POST | VARCHAR2(1) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| BUFFER | NUMBER(14,2) | Y |
| CLEAN | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| TRANSITORY | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ORDER_CANCEL_DETAIL

Order cancellation lines. Source: Karachi + Islamabad.

- PK: (BRNCH, OC_ADVISE_NO, SR_NO)
- UK UK_ORDER_CANCEL_DETAIL_N1: (BRNCH, DOC_TYPE, DO_NO)
- UK UK_ORDER_CANCEL_DETAIL_N2: (BRNCH, DO_NO)
- FK FK_ORDER_CANCEL_DETAIL_55: (BRNCH, OC_ADVISE_NO) → ORDER_CANCEL_MASTER (BRNCH, OC_ADVISE_NO)

| Column | Type | Null |
| --- | --- | --- |
| OC_ADVISE_NO | NUMBER(6) | N |
| SR_NO | NUMBER(6) | N |
| DO_NO | NUMBER(11) | Y |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| DATE_OF_ISSUE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| DO_DATE | DATE | Y |
| OC_NO | NUMBER(9) | Y |
| OC_DATE | DATE | Y |
| POST_BY | CHAR(1) | Y |
| DOC_TYPE | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| AMOUNT | NUMBER(14,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ORDER_CANCELLATION

Order cancellation (single form). Source: Karachi + Islamabad.

- PK: (BRNCH, OC_ADVISE_NO)
- FK FK_ORDER_CANCELLATION_53: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| OC_ADVISE_NO | NUMBER(6) | N |
| OC_ADVISE_DATE | DATE | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| SR_NO | NUMBER(6) | Y |
| DO_NO | NUMBER(8) | Y |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| DATE_OF_ISSUE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| DO_DATE | DATE | Y |
| OC_NO | NUMBER(8) | Y |
| OC_DATE | DATE | Y |
| POST_BY | CHAR(1) | Y |
| DOC_TYPE | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SD_OCA_MST

OC adjustment header (KHI). Source: Karachi only.

- PK: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| WDATE | DATE | Y |
| CUSTM | VARCHAR2(100) | Y |
| EDATE | DATE | Y |
| USRID | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### SD_OCA_DTL

OC adjustment lines (KHI). Source: Karachi only.

- PK: (BRNCH, LNKNO)
- FK FK_SD_OCA_DTL_12: (BRNCH, SERNO) → SD_OCA_MST (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| LNKNO | NUMBER | N |
| DO_NO | NUMBER | Y |
| QTY | NUMBER | Y |
| DO_DATE | DATE | Y |
| OC_NUMBER | NUMBER | Y |
| DO_TYPE | VARCHAR2(10) | Y |
| PROD | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## DO and permit

### DELIVERY_ORDER

DO: one per OC line, DO type, quantity, dispatched quantity. Source: Karachi + Islamabad.

- PK: (BRNCH, DO_TYPE, DEL_ORDER_NO)
- FK FK_DELIVERY_ORDER_42: (BRNCH, DO_TYPE) → DELIVERY_ORDER_TYPE (BRNCH, DO_CODE)
- FK FK_DELIVERY_ORDER_43: (BRNCH, ORDER_NO) → ORDER_CONFIRM (BRNCH, ORDER_NO)
- FK FK_DELIVERY_ORDER_44: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| DEL_ORDER_NO | NUMBER(11) | N |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| ORDER_NO | NUMBER(9) | Y |
| SRF_NO | NUMBER(8) | Y |
| ORDER_DATE | DATE | Y |
| SCHED_DATE | DATE | Y |
| RE_SCHE_DATE | DATE | Y |
| CANCEL_CODE | CHAR(1) | Y |
| POST_BY | VARCHAR2(10) | Y |
| DO_QUANTITY | NUMBER(8,2) | Y |
| QTY_TYPE | VARCHAR2(4) | Y |
| NO_OF_BAGS | NUMBER(6) | Y |
| SR_NO | NUMBER(6) | Y |
| DO_TYPE | VARCHAR2(10) | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| DISPATCHED | NUMBER(8,2) | Y |
| YEAR | NUMBER(4) | Y |
| CANCEL_DATE | DATE | Y |
| PRINT | NUMBER(2) | Y |
| POST | VARCHAR2(1) | Y |
| ADJ_QTY | NUMBER | Y |
| USRID | VARCHAR2(10) | Y |
| BARCODE | VARCHAR2(20) | Y |
| BRC | VARCHAR2(1) | Y |
| ADJ | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DO_ADJUSTMENT

DO quantity/rate adjustment advice. Source: Karachi + Islamabad.

- PK: (BRNCH, ADVICE_YR, ADVICE_NO)
- FK FK_DO_ADJUSTMENT_48: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| ADVICE_YR | NUMBER(4) | N |
| ADVICE_NO | NUMBER(7) | N |
| ADVICE_DT | DATE | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| PERIOD_FROM | DATE | N |
| PERIOD_TO | DATE | N |
| AUTHORISED_BY | VARCHAR2(40) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| QUANTITY | NUMBER(10,2) | Y |
| DESIGNATION | VARCHAR2(40) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| BUFFER | NUMBER(14,2) | Y |
| CLEAN | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| DO_NO | NUMBER | Y |
| TRANSITORY | NUMBER | Y |
| OC_NO | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### GODOWN_DO

Godown DO header (KHI). Source: Karachi only.

- UK UK_GODOWN_DO_N1: (BRNCH, DO_NO)

| Column | Type | Null |
| --- | --- | --- |
| DO_NO | NUMBER | Y |
| CUSTOMER_NAME | VARCHAR2(200) | Y |
| DC_DATE | DATE | Y |
| DC_TIME | VARCHAR2(100) | Y |
| PROD_CD | VARCHAR2(10) | Y |
| BRAND | VARCHAR2(20) | Y |
| QTY | NUMBER | Y |
| BAGS | NUMBER | Y |
| PREP_BY | VARCHAR2(100) | Y |
| BRV_NO | NUMBER | Y |
| REMRK | VARCHAR2(200) | Y |
| STATS | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### GODOWN_DO_DTL

Godown DO lines (KHI). Source: Karachi only.

- PK: (BRNCH, DO_NO, SR_NO)
- FK FK_GODOWN_DO_DTL_79: (BRNCH, DO_NO) → GODOWN_DO (BRNCH, DO_NO)

| Column | Type | Null |
| --- | --- | --- |
| SR_NO | NUMBER(3) | N |
| DO_NO | NUMBER(9) | N |
| SCH_DATE | DATE | Y |
| QUANTITY | NUMBER(8,2) | Y |
| ORDER_DATE | DATE | Y |
| POST_BY | CHAR(1) | Y |
| SRF_NO | NUMBER(8) | Y |
| POST_DATE | DATE | Y |
| DO_NO_DTL | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PERMIT_MST_CITY

City-wise permit header: customer, validity, total. Source: Karachi + Islamabad.

- PK: (BRNCH, PERMIT_NO)
- FK FK_PERMIT_MST_CITY_73: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| PERMIT_NO | NUMBER | N |
| PERMIT_DATE | DATE | Y |
| VALID_FROM | DATE | Y |
| VALID_TO | DATE | Y |
| CUSTOMER_CODE | VARCHAR2(15) | Y |
| QTY | NUMBER | Y |
| APPROVED | VARCHAR2(1) | Y |
| YEAR | NUMBER(4) | Y |
| DOB | NUMBER | Y |
| DCB | NUMBER | Y |
| CRLMT | NUMBER | Y |
| PRODUCT_CODE | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PERMIT_DTL_CITY

Permit areas: quantity, rate, balance. Source: Karachi + Islamabad.

- PK: (BRNCH, LNKNO)
- FK FK_PERMIT_DTL_CITY_57: (BRNCH, PERMIT_NO) → PERMIT_MST_CITY (BRNCH, PERMIT_NO)

| Column | Type | Null |
| --- | --- | --- |
| PERMIT_NO | NUMBER | Y |
| LNKNO | NUMBER | N |
| AREA_DOC | VARCHAR2(15) | Y |
| QTY | NUMBER | Y |
| CUSTOMER_CODE | VARCHAR2(20) | Y |
| CRATE | NUMBER | Y |
| AMOUNT | NUMBER | Y |
| BAG | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PERMIT_ADJ_CITY

Permit quantity adjustments. Source: Karachi + Islamabad.

- PK: (BRNCH, SERNO)
- FK FK_PERMIT_ADJ_CITY_58: (BRNCH, LNKNO) → PERMIT_DTL_CITY (BRNCH, LNKNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| WDATE | DATE | Y |
| PERMIT_NO | NUMBER | Y |
| LNKNO | NUMBER | Y |
| AREA_DOC | VARCHAR2(15) | Y |
| QTY | NUMBER | Y |
| CUSTOMER_CODE | VARCHAR2(20) | Y |
| CRATE | NUMBER | Y |
| AMOUNT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PERMIT_MST

Permit header (ISB, older form). Source: Islamabad only.

- PK: (BRNCH, PERMIT_NO)

| Column | Type | Null |
| --- | --- | --- |
| PERMIT_NO | NUMBER | N |
| PERMIT_DATE | DATE | Y |
| VALID_FROM | DATE | Y |
| VALID_TO | DATE | Y |
| CUSTOMER_GROUP | VARCHAR2(15) | Y |
| QTY | NUMBER | Y |
| APPROVED | VARCHAR2(1) | Y |
| YEAR | NUMBER(4) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### PERMIT_DTL

Permit lines (ISB, older form). Source: Islamabad only.

- UK UK_PERMIT_DTL_N1: (BRNCH, PERMIT_NO, CUSTOMER_CODE)
- FK FK_PERMIT_DTL_59: (BRNCH, PERMIT_NO) → PERMIT_MST (BRNCH, PERMIT_NO)

| Column | Type | Null |
| --- | --- | --- |
| PERMIT_NO | NUMBER | Y |
| CUSTOMER_CODE | VARCHAR2(15) | Y |
| DTL_SNO | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### APCAMA_QUOTA

APCMA quota per period. Source: Karachi + Islamabad.

- UK UK_APCAMA_QUOTA_N1: (BRNCH, QOUTA_DATE)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| QOUTA_DATE | DATE | N |
| QOUTA_QTY | NUMBER | Y |
| MARGIN_QTY | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Dispatch: DC and DM

### FH_DELIVERY_CHALLAN

DC header (KHI, to Nov 2024). Source: Karachi only.

- UK UK_FH_DELIVERY_CHALLAN_N1: (BRNCH, DC_TYPE, DC_NO)
- FK FK_FH_DELIVERY_CHALLAN_37: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)
- FK FK_FH_DELIVERY_CHALLAN_83: (BRNCH, BAGS_ID) → BAG (BRNCH, BAG_CD)

| Column | Type | Null |
| --- | --- | --- |
| DC_NO | NUMBER(8) | N |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| TRANSP_NAME | VARCHAR2(60) | Y |
| DEL_ORDER_NO | NUMBER(8) | Y |
| DC_DATE | DATE | Y |
| REMARKS | VARCHAR2(200) | Y |
| TOKEN_NO | VARCHAR2(30) | Y |
| PACKING_TYPE | VARCHAR2(4) | Y |
| QUANTITY | NUMBER(8,2) | Y |
| W_TARE | NUMBER(10,2) | Y |
| CEMENT_FILLED | NUMBER(10,2) | Y |
| SPROUT_NO | NUMBER(10,2) | Y |
| WT_GROSS | NUMBER(10,2) | Y |
| QTY_VERIFIED | NUMBER(8,2) | Y |
| POST_BY | VARCHAR2(10) | Y |
| CANCEL_CODE | CHAR(1) | Y |
| VEHICLE_NO | VARCHAR2(10) | Y |
| TRANSP_CODE | VARCHAR2(3) | Y |
| INVOICE_NO | NUMBER(8) | Y |
| INVOICE_DATE | DATE | Y |
| DC_TYPE | VARCHAR2(10) | N |
| PACK_TP | NUMBER(10,2) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| POST | VARCHAR2(1) | Y |
| COUPON_FLAG | VARCHAR2(1) | Y |
| S# | NUMBER | Y |
| B_MFG | NUMBER(4) | Y |
| B_CONT | NUMBER(4) | Y |
| BELT_NO | VARCHAR2(20) | Y |
| TIME_LOADING | VARCHAR2(20) | Y |
| PRICE_CODE | VARCHAR2(10) | Y |
| COMP_NO | NUMBER(10) | Y |
| OLD_BELT_NO | VARCHAR2(20) | Y |
| D_CUST_MISC_NAME | VARCHAR2(200) | Y |
| TIME | TIMESTAMP(0) WITH TIME ZONE | Y |
| CITY_CD | NUMBER | Y |
| CONTAINER_NO | VARCHAR2(200) | Y |
| SEAL_NO | VARCHAR2(100) | Y |
| BAGS_ID | NUMBER | Y |
| NEW_REMARKS | VARCHAR2(200) | Y |
| CANCEL_FLAG | CHAR(1) | Y |
| CANCEL_DATE | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### FH_DEL_CHALLAN_DETAIL

DC lines: DO, tons, bags (KHI). Source: Karachi only.

- UK UK_FH_DEL_CHALLAN_DETAIL_N1: (BRNCH, DC_TYPE, DC_NO, DO_NO)
- FK FK_FH_DEL_CHALLAN_DETAIL_45: (BRNCH, DC_TYPE, DC_NO) → FH_DELIVERY_CHALLAN (BRNCH, DC_TYPE, DC_NO)

| Column | Type | Null |
| --- | --- | --- |
| DC_NO | NUMBER(8) | Y |
| DO_NO | NUMBER(11) | Y |
| QUANTITY | NUMBER(8,2) | Y |
| DC_TYPE | VARCHAR2(10) | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| OC_NO | NUMBER(9) | Y |
| VALUE | NUMBER(14,2) | Y |
| RET_CODE | VARCHAR2(15) | Y |
| COUPON_NO | VARCHAR2(15) | Y |
| COUPON_DATE | DATE | Y |
| NEW_VALUE | NUMBER(14,2) | Y |
| NEW_RETAIL_PRICE | NUMBER(14,2) | Y |
| NEW_EXPENSE | NUMBER(12,2) | Y |
| NEW_DISCOUNT | NUMBER(12,2) | Y |
| NEW_CED | NUMBER(12,2) | Y |
| NEW_TRADE_DISC | NUMBER(8,2) | Y |
| NEW_TOT_NET | NUMBER(17,2) | Y |
| NEW_AREA_CODE | VARCHAR2(8) | Y |
| NEW_NET_BOOK_PRICE | NUMBER(14,2) | Y |
| NEW_CONS_PRICE | NUMBER(12,2) | Y |
| NEW_SALES_TAX | NUMBER(12,2) | Y |
| COMP_NO | NUMBER(10) | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| PRICE_CODE | VARCHAR2(10) | Y |
| ZONE | VARCHAR2(20) | Y |
| REMARKS | VARCHAR2(60) | Y |
| CUST_MISC_ADD | VARCHAR2(100) | Y |
| CUST_MISC_NAME | VARCHAR2(150) | Y |
| TIME | TIMESTAMP(0) WITH TIME ZONE | Y |
| DCD_SNO | NUMBER | Y |
| MRP_SALES_TAX | NUMBER | Y |
| MRP_COMPANY_PRICE | NUMBER | Y |
| PACKING_TYPE | VARCHAR2(20) | Y |
| CANCEL_FLAG | CHAR(1) | Y |
| CANCEL_DATE | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### FH_DELIVERY_MEMO

Delivery memo for permits (KHI). Source: Karachi only.

- UK UK_FH_DELIVERY_MEMO_N1: (BRNCH, DM_NO)
- FK FK_FH_DELIVERY_MEMO_82: (BRNCH, BAGTYP) → BAG (BRNCH, BAG_CD)

| Column | Type | Null |
| --- | --- | --- |
| DM_NO | NUMBER(11) | N |
| DM_DATE | DATE | N |
| DOC_NO | NUMBER(11) | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| PRODUCT_CODE | VARCHAR2(4) | N |
| DC_TYPE | VARCHAR2(10) | N |
| SALES_TAX_TYPE | VARCHAR2(1) | N |
| SALES_TAX_NO | VARCHAR2(25) | Y |
| QUANTITY | NUMBER(8,2) | N |
| RETAIL_PRICE | NUMBER(14,2) | N |
| SALES_TAX | NUMBER(12,2) | Y |
| CONS_PRICE | NUMBER(12,2) | Y |
| EXPENSE | NUMBER(12,2) | Y |
| DISCOUNT | NUMBER(12,2) | Y |
| NET_BOOK_PRICE | NUMBER(14,2) | Y |
| TOT_NET | NUMBER(17,2) | Y |
| CED | NUMBER(12,2) | Y |
| GROSS_PRICE | NUMBER(12,2) | Y |
| AREA_CODE | VARCHAR2(8) | Y |
| TRADE_DISC | NUMBER(8,2) | Y |
| EX_FACT_PRICE | NUMBER(14,2) | Y |
| REMARKS | VARCHAR2(100) | Y |
| TOKEN_NO | VARCHAR2(30) | Y |
| PACKING_TYPE | VARCHAR2(4) | N |
| W_TARE | NUMBER(10,2) | Y |
| CEMENT_FILLED | NUMBER(10,2) | Y |
| SPROUT_NO | NUMBER(10,2) | Y |
| WT_GROSS | NUMBER(10,2) | Y |
| QTY_VERIFIED | NUMBER(8,2) | Y |
| POST_BY | VARCHAR2(10) | Y |
| CANCEL_CODE | CHAR(1) | Y |
| VEHICLE_NO | VARCHAR2(10) | Y |
| TRANSP_CODE | VARCHAR2(3) | N |
| INVOICE_NO | NUMBER(8) | N |
| INVOICE_DATE | DATE | N |
| PACK_TP | NUMBER(10,2) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | N |
| POST | VARCHAR2(1) | Y |
| OLD_AREA_CODE | VARCHAR2(8) | Y |
| S# | NUMBER | Y |
| USRID | VARCHAR2(3) | Y |
| COMP_NO | NUMBER | Y |
| PERMIT_NO | NUMBER | Y |
| ZONE_CODE | VARCHAR2(10) | Y |
| TERRITORY_CODE | VARCHAR2(20) | Y |
| COUPON_FLAG | VARCHAR2(1) | Y |
| B_MFG | NUMBER | Y |
| B_CONT | NUMBER | Y |
| BELT_NO | VARCHAR2(20) | Y |
| TIME_LOADING | VARCHAR2(20) | Y |
| PRICE_CODE | VARCHAR2(10) | Y |
| OLD_BELT_NO | VARCHAR2(20) | Y |
| D_CUST_MISC_NAME | VARCHAR2(200) | Y |
| CITY_CD | NUMBER | Y |
| DC_NO | NUMBER | Y |
| TRANSP_NAME | VARCHAR2(60) | Y |
| DEL_ORDER_NO | NUMBER | Y |
| DC_DATE | DATE | Y |
| STATUS | CHAR(1) | Y |
| TIME | TIMESTAMP(0) WITH TIME ZONE | Y |
| BILTY | NUMBER | Y |
| BAGTYP | NUMBER | Y |
| REPORTING_TIME | VARCHAR2(20) | Y |
| LNKNO | NUMBER | Y |
| RATE_DTW | NUMBER | Y |
| RATE_PERMIT | NUMBER | Y |
| QTY_BAG | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### FH_DC_DOCUMENT

Gate/weighbridge: token, truck, tare/gross, gate in/out (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| COMP_NO | NUMBER(10) | N |
| COMP_DT | DATE | Y |
| DT_SR# | NUMBER(5) | Y |
| TOKEN_TYPE | VARCHAR2(6) | Y |
| TOKEN_NO | NUMBER(10) | Y |
| TRUCK_NO | VARCHAR2(10) | Y |
| GROSS_WT | NUMBER(10,2) | Y |
| TARE_WT | NUMBER(10,2) | Y |
| TARE_TIME | VARCHAR2(20) | Y |
| GROSS_TIME | VARCHAR2(20) | Y |
| TARE_SHIFT | VARCHAR2(1) | Y |
| GROSS_SHIFT | VARCHAR2(1) | Y |
| REPORTING_TIME | VARCHAR2(10) | Y |
| MDC_DATE | DATE | Y |
| REMARKS | VARCHAR2(90) | Y |
| VEHICLE_TYPE | VARCHAR2(20) | Y |
| TIME | TIMESTAMP(0) WITH TIME ZONE | Y |
| MGATE_FLG | VARCHAR2(30) | Y |
| OP | VARCHAR2(20) | Y |
| TRANSPORTER_ID | NUMBER | Y |
| OUT_GATE | VARCHAR2(30) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DELIVERY_CHALLAN_OLD

Older DC header (KHI to 2012, ISB to 2015). Source: Karachi + Islamabad.

- UK UK_DELIVERY_CHALLAN_OLD_N1: (BRNCH, DC_TYPE, DC_NO)
- FK FK_DELIVERY_CHALLAN_OLD_37: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| DC_NO | NUMBER(8) | N |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| TRANSP_NAME | VARCHAR2(60) | Y |
| DEL_ORDER_NO | NUMBER(8) | Y |
| DC_DATE | DATE | Y |
| REMARKS | VARCHAR2(60) | Y |
| TOKEN_NO | VARCHAR2(30) | Y |
| PACKING_TYPE | VARCHAR2(4) | Y |
| QUANTITY | NUMBER(8,2) | Y |
| W_TARE | NUMBER(10,2) | Y |
| CEMENT_FILLED | NUMBER(10,2) | Y |
| SPROUT_NO | NUMBER(10,2) | Y |
| WT_GROSS | NUMBER(10,2) | Y |
| QTY_VERIFIED | NUMBER(8,2) | Y |
| POST_BY | VARCHAR2(10) | Y |
| CANCEL_CODE | CHAR(1) | Y |
| VEHICLE_NO | VARCHAR2(10) | Y |
| TRANSP_CODE | VARCHAR2(3) | Y |
| INVOICE_NO | NUMBER(8) | Y |
| INVOICE_DATE | DATE | Y |
| DC_TYPE | VARCHAR2(10) | N |
| PACK_TP | NUMBER(10,2) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| POST | VARCHAR2(1) | Y |
| COUPON_FLAG | VARCHAR2(1) | Y |
| S# | NUMBER | Y |
| CITY_CD | NUMBER | Y |
| BILTY | NUMBER | Y |
| STATUS | CHAR(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DEL_CHALLAN_DETAIL_OLD

Older DC lines. Source: Karachi + Islamabad.

- UK UK_DEL_CHALLAN_DETAIL_OLD_N1: (BRNCH, DC_TYPE, DC_NO, DO_NO)
- FK FK_DEL_CHALLAN_DETAIL_OLD_45: (BRNCH, DC_TYPE, DC_NO) → DELIVERY_CHALLAN_OLD (BRNCH, DC_TYPE, DC_NO)

| Column | Type | Null |
| --- | --- | --- |
| DC_NO | NUMBER(8) | Y |
| DO_NO | NUMBER(11) | Y |
| QUANTITY | NUMBER(8,2) | Y |
| DC_TYPE | VARCHAR2(10) | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| OC_NO | NUMBER(9) | Y |
| VALUE | NUMBER(14,2) | Y |
| RET_CODE | VARCHAR2(15) | Y |
| COUPON_NO | VARCHAR2(15) | Y |
| COUPON_DATE | DATE | Y |
| NEW_VALUE | NUMBER(14,2) | Y |
| NEW_RETAIL_PRICE | NUMBER(14,2) | Y |
| NEW_EXPENSE | NUMBER(12,2) | Y |
| NEW_DISCOUNT | NUMBER(12,2) | Y |
| NEW_CED | NUMBER(12,2) | Y |
| NEW_TRADE_DISC | NUMBER(8,2) | Y |
| NEW_TOT_NET | NUMBER(17,2) | Y |
| NEW_AREA_CODE | VARCHAR2(8) | Y |
| NEW_NET_BOOK_PRICE | NUMBER(14,2) | Y |
| NEW_CONS_PRICE | NUMBER(12,2) | Y |
| NEW_SALES_TAX | NUMBER(12,2) | Y |
| MRP_SALES_TAX | NUMBER | Y |
| MRP_COMPANY_PRICE | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DELIVERY_MEMO_OLD

Older delivery memo (ISB to 2015). Source: Islamabad only.

- UK UK_DELIVERY_MEMO_OLD_N1: (BRNCH, DM_NO)

| Column | Type | Null |
| --- | --- | --- |
| DM_NO | NUMBER(11) | N |
| DM_DATE | DATE | N |
| DOC_NO | NUMBER(11) | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| PRODUCT_CODE | VARCHAR2(4) | N |
| DC_TYPE | VARCHAR2(10) | N |
| SALES_TAX_TYPE | VARCHAR2(1) | N |
| SALES_TAX_NO | VARCHAR2(25) | Y |
| QUANTITY | NUMBER(8,2) | N |
| RETAIL_PRICE | NUMBER(14,2) | N |
| SALES_TAX | NUMBER(12,2) | Y |
| CONS_PRICE | NUMBER(12,2) | Y |
| EXPENSE | NUMBER(12,2) | Y |
| DISCOUNT | NUMBER(12,2) | Y |
| NET_BOOK_PRICE | NUMBER(14,2) | Y |
| TOT_NET | NUMBER(17,2) | Y |
| CED | NUMBER(12,2) | Y |
| GROSS_PRICE | NUMBER(12,2) | Y |
| AREA_CODE | VARCHAR2(8) | Y |
| TRADE_DISC | NUMBER(8,2) | Y |
| EX_FACT_PRICE | NUMBER(14,2) | Y |
| REMARKS | VARCHAR2(100) | Y |
| TOKEN_NO | VARCHAR2(30) | Y |
| PACKING_TYPE | VARCHAR2(4) | N |
| W_TARE | NUMBER(10,2) | Y |
| CEMENT_FILLED | NUMBER(10,2) | Y |
| SPROUT_NO | NUMBER(10,2) | Y |
| WT_GROSS | NUMBER(10,2) | Y |
| QTY_VERIFIED | NUMBER(8,2) | Y |
| POST_BY | VARCHAR2(10) | Y |
| CANCEL_CODE | CHAR(1) | Y |
| VEHICLE_NO | VARCHAR2(10) | Y |
| TRANSP_CODE | VARCHAR2(3) | N |
| INVOICE_NO | NUMBER(8) | N |
| INVOICE_DATE | DATE | N |
| PACK_TP | NUMBER(10,2) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_DATE | DATE | Y |
| YEAR | NUMBER(4) | N |
| POST | VARCHAR2(1) | Y |
| OLD_AREA_CODE | VARCHAR2(8) | Y |
| S# | NUMBER | Y |
| PERMIT_NO | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_AKNOW

DC acknowledgement header (ISB). Source: Islamabad only.

- PK: (BRNCH, DA_NO)
- FK FK_DC_AKNOW_34: (BRNCH, TRANSP_CODE) → TRANSPORTER_DESC (BRNCH, TRANSP_CODE)

| Column | Type | Null |
| --- | --- | --- |
| DA_NO | VARCHAR2(8) | N |
| DA_DATE | DATE | N |
| TRANSP_CODE | VARCHAR2(3) | N |
| DELIVERY_DATE | DATE | Y |
| QUANTITY | NUMBER(14,2) | N |
| AMOUNT | NUMBER(14,2) | N |
| REMARKS | VARCHAR2(60) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_AKNOW_DET

DC acknowledgement lines (ISB). Source: Islamabad only.

- UK UK_DC_AKNOW_DET_N1: (BRNCH, DA_NO, SRL_NO)
- FK FK_DC_AKNOW_DET_35: (BRNCH, DA_NO) → DC_AKNOW (BRNCH, DA_NO)

| Column | Type | Null |
| --- | --- | --- |
| DA_NO | VARCHAR2(8) | Y |
| SRL_NO | NUMBER(3) | N |
| DC_NO | NUMBER(8) | N |
| DC_TYPE | VARCHAR2(10) | N |
| QUANTITY | NUMBER(14,2) | N |
| AMOUNT | NUMBER(14,2) | N |
| DELIVERY_DATE | DATE | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### ACK_MST

Acknowledgement master (KHI). Source: Karachi only.

- UK UK_ACK_MST_N1: (BRNCH, ACK_NO)

| Column | Type | Null |
| --- | --- | --- |
| ACK_NO | NUMBER(11) | Y |
| ACK_DT | DATE | Y |
| DUE_DATE | DATE | Y |
| RET_CODE | VARCHAR2(15) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_COUPON

DC coupons (KHI). Source: Karachi only.

- UK UK_DC_COUPON_N1: (BRNCH, DC_TYPE, DC_NO, COUPON_NO)

| Column | Type | Null |
| --- | --- | --- |
| DC_NO | NUMBER(8) | Y |
| COUPON_NO | VARCHAR2(15) | Y |
| COUPON_DATE | DATE | Y |
| DC_TYPE | VARCHAR2(10) | Y |
| ACK_NO | NUMBER(11) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### MODE_OF_TRANSPORT

Truck, ship, wagon. Source: Karachi + Islamabad.

- UK UK_MODE_OF_TRANSPORT_N1: (BRNCH, MODE_CODE)

| Column | Type | Null |
| --- | --- | --- |
| MODE_CODE | VARCHAR2(3) | N |
| MODE_NAME | VARCHAR2(60) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TRANSPORTER_DESC

Transporters. Source: Karachi + Islamabad.

- UK UK_TRANSPORTER_DESC_N1: (BRNCH, TRANSP_CODE)
- UK UK_TRANSPORTER_DESC_N2: (BRNCH, TRANSP_NAME)

| Column | Type | Null |
| --- | --- | --- |
| TRANSP_NAME | VARCHAR2(60) | Y |
| TRANSP_CODE | VARCHAR2(3) | N |
| PHONE | VARCHAR2(25) | Y |
| FAX | VARCHAR2(25) | Y |
| ADDRESS1 | VARCHAR2(40) | Y |
| ADDRESS | VARCHAR2(40) | Y |
| EMAIL | VARCHAR2(50) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DUMMY_INV_MST

Manual invoice header (KHI). Source: Karachi only.

- PK: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| WDATE | DATE | Y |
| PO_NO | NUMBER | Y |
| PDATE | DATE | Y |
| RECPNO | VARCHAR2(20) | Y |
| LC_NO | VARCHAR2(20) | Y |
| LDATE | DATE | Y |
| CUSTM | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DUMMY_INV_DTL

Manual invoice lines (KHI). Source: Karachi only.

- FK FK_DUMMY_INV_DTL_7: (BRNCH, SERNO) → DUMMY_INV_MST (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| ITEMS | VARCHAR2(20) | Y |
| QTY | NUMBER | Y |
| UNIT | VARCHAR2(20) | Y |
| RATE | NUMBER | Y |
| STAX1 | NUMBER | Y |
| STAX2 | NUMBER | Y |
| AUC_VAL | NUMBER | Y |
| AMOUNT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Ledger, notes, tax and accounts

### OPENING_BALANCES

Opening balance per customer and year. Source: Karachi + Islamabad.

- UK UK_OPENING_BALANCES_N1: (BRNCH, CUSTOMER_CODE, OPEN_DATE)
- FK FK_OPENING_BALANCES_52: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| OPEN_DATE | DATE | N |
| CARD_BAL | NUMBER(16,2) | Y |
| DO_BAL | NUMBER(16,2) | Y |
| LEDGER_BAL | NUMBER(16,2) | Y |
| CLOSE_BY | VARCHAR2(10) | Y |
| CLOSE_DATE | DATE | Y |
| YEAR | NUMBER(4) | Y |
| CLEAN | NUMBER(14) | Y |
| TRANSITORY | NUMBER(14) | Y |
| BILLING | NUMBER(14) | Y |
| ADVANCE | NUMBER(14) | Y |
| SECURITY | NUMBER(14) | Y |
| INCENTIVE | NUMBER(14) | Y |
| TAX | NUMBER(14) | Y |
| BOUNCE | NUMBER(14) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CUSTOMER_OPEN_BALANCE

Customer opening balance (single figure). Source: Karachi + Islamabad.

- FK FK_CUSTOMER_OPEN_BALANCE_33: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| OPEN_DATE | DATE | Y |
| DEBIT_AMOUNT | NUMBER(17,2) | Y |
| CREDIT_AMOUNT | NUMBER(17,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_NOTE_TYPE

Credit note types 001–010. Source: Karachi + Islamabad.

- UK UK_CREDIT_NOTE_TYPE_N1: (BRNCH, CODE)

| Column | Type | Null |
| --- | --- | --- |
| CODE | VARCHAR2(3) | N |
| DESCRIPTION | VARCHAR2(16) | N |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_NOTE

Credit/debit note header. Source: Karachi + Islamabad.

- PK: (BRNCH, SRL_NO, DB_CR_CD, NOTE_TYPE)
- FK FK_CREDIT_NOTE_74: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(8) | N |
| DB_CR_DATE | DATE | Y |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| DB_CR_CD | VARCHAR2(1) | N |
| NOTE_TYPE | VARCHAR2(3) | N |
| AMOUNT | NUMBER(14,2) | N |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| REMARKS | VARCHAR2(500) | Y |
| POST | VARCHAR2(1) | Y |
| BUFFER | NUMBER(14,2) | Y |
| CLEAN | NUMBER(14,2) | Y |
| SECURITY | NUMBER(14,2) | Y |
| ADVANCE | NUMBER(14,2) | Y |
| BILLING | NUMBER(14,2) | Y |
| INCENTIVE | NUMBER(14,2) | Y |
| BANK_CHARGES | NUMBER | Y |
| WITHHOLDING_TAX | NUMBER | Y |
| NET_AMOUNT | NUMBER | Y |
| DO_CODE | VARCHAR2(10) | Y |
| CITY_CD | NUMBER | Y |
| SD_TYPE | VARCHAR2(1) | Y |
| BANK_CODE | VARCHAR2(6) | Y |
| AREA_CD | NUMBER | Y |
| DIST_CD | NUMBER | Y |
| TRANSITORY | NUMBER | Y |
| COLLECTION_INCENTIVE_AMOUNT | NUMBER(14,2) | Y |
| DEAL_INCENTIVE_QUANTITY | NUMBER(14,2) | Y |
| TARGET_QUANTITY | NUMBER(14,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### CREDIT_NOTE_DETAIL

Credit note lines. Source: Karachi + Islamabad.

- UK UK_CREDIT_NOTE_DETAIL_N1: (BRNCH, SRL_NO, DB_CR_CD, NOTE_TYPE, SR_NO)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(8) | N |
| SR_NO | NUMBER(3) | Y |
| PARTICULAR | VARCHAR2(60) | Y |
| AMOUNT | NUMBER(14,2) | N |
| DB_CR_CD | VARCHAR2(1) | Y |
| NOTE_TYPE | VARCHAR2(3) | Y |
| FLAG | CHAR(1) | Y |
| WHT_PERC | NUMBER | Y |
| NO | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DEBIT_CREDIT_NOTE

Debit/credit note (single form). Source: Karachi + Islamabad.

- PK: (BRNCH, SR_NO)
- FK FK_DEBIT_CREDIT_NOTE_36: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| SR_NO | NUMBER(6) | N |
| DB_CR_DATE | DATE | N |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| CODE_NO | VARCHAR2(10) | Y |
| DB_CR_CD | CHAR(1) | N |
| AMOUNT | NUMBER(14,2) | Y |
| CHEQUE_NO | VARCHAR2(35) | Y |
| RECEIPT_NO | NUMBER(6) | Y |
| RECEIPT_DATE | DATE | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_ADJ_1

DC ledger adjustment 1 (KHI). Source: Karachi only.

- PK: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| CUSTM | VARCHAR2(20) | Y |
| WDATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_ADJ_2

DC ledger adjustment 2 (KHI). Source: Karachi only.

- PK: (BRNCH, DOCNO)

| Column | Type | Null |
| --- | --- | --- |
| DOCNO | NUMBER | N |
| SERNO | NUMBER | Y |
| CUSTM | VARCHAR2(20) | Y |
| DOC_DATE | DATE | Y |
| SLR | VARCHAR2(100) | Y |
| DOC_TYPE | VARCHAR2(10) | Y |
| DOC_NO | VARCHAR2(100) | Y |
| NARRATION | VARCHAR2(200) | Y |
| DR | NUMBER | Y |
| CR | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_ADJ_3

DC ledger adjustment 3 (KHI). Source: Karachi only.

- PK: (BRNCH, DOCNO)

| Column | Type | Null |
| --- | --- | --- |
| DOCNO | NUMBER | N |
| SERNO | NUMBER | Y |
| CUSTM | VARCHAR2(20) | Y |
| DOC_DATE | DATE | Y |
| SLR | VARCHAR2(100) | Y |
| DOC_TYPE | VARCHAR2(10) | Y |
| DOC_NO | VARCHAR2(100) | Y |
| NARRATION | VARCHAR2(200) | Y |
| DR | NUMBER | Y |
| CR | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### DC_LADGER_ADJ

DC ledger adjustments (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| NOK# | NUMBER | Y |
| CUSTM | VARCHAR2(20) | Y |
| DOC_DATE | DATE | Y |
| SLR | NUMBER | Y |
| DOC_TYPE | VARCHAR2(10) | Y |
| DOC_NO | NUMBER | Y |
| NARRATION | VARCHAR2(200) | Y |
| DR | NUMBER | Y |
| CR | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TAX

Withholding tax deduction header. Source: Karachi + Islamabad.

- PK: (BRNCH, SRL_NO)
- FK FK_TAX_67: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(10) | N |
| TAX_DATE | DATE | Y |
| CUSTOMER_CODE | VARCHAR2(11) | N |
| AMOUNT | NUMBER(25,2) | Y |
| REMARKS | VARCHAR2(1000) | Y |
| DISABLE | VARCHAR2(1) | Y |
| ENTER_BY | VARCHAR2(110) | Y |
| ENTER_DATE | DATE | Y |
| POST | VARCHAR2(1) | Y |
| POST_BY | VARCHAR2(110) | Y |
| POST_DATE | DATE | Y |
| TAX_TYPE | VARCHAR2(1) | Y |
| TR_TYPE | VARCHAR2(1) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TAX_DETAIL

Withholding tax lines. Source: Karachi + Islamabad.

- UK UK_TAX_DETAIL_N1: (BRNCH, SRL_NO, RECEIPT_TYPE, RECEIPT_NO)
- FK FK_TAX_DETAIL_68: (BRNCH, SRL_NO) → TAX (BRNCH, SRL_NO)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(8) | N |
| RECEIPT_TYPE | VARCHAR2(1) | Y |
| RECEIPT_NO | NUMBER(19) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TAX_CERTIFICATE

Tax certificate header (KHI). Source: Karachi only.

- PK: (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| FYEAR | NUMBER | Y |
| CUST_ID | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TAX_CERTIFICATE_DTL

Tax certificate lines (KHI). Source: Karachi only.

- PK: (BRNCH, LNKNO)
- FK FK_TAX_CERTIFICATE_DTL_17: (BRNCH, SERNO) → TAX_CERTIFICATE (BRNCH, SERNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| LNKNO | NUMBER | N |
| MNTH | DATE | Y |
| TAXABLE | NUMBER | Y |
| INCOM_TAX | NUMBER | Y |
| CHALLAN_NO | VARCHAR2(100) | Y |
| CDATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### VOCH_POST

Voucher posted to finance (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| REF_NO | NUMBER | Y |
| REF_TYPE | VARCHAR2(4) | Y |
| V_NO | NUMBER | Y |
| V_DATE | DATE | Y |
| V_TYPE | VARCHAR2(4) | Y |
| UNIT_ID | VARCHAR2(1) | Y |
| LOC_CD | VARCHAR2(2) | Y |
| USR_ID | VARCHAR2(2) | Y |
| REF_DATE | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### VOCH_DTL

Voucher lines (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| ACC_CODE | VARCHAR2(8) | Y |
| VD_PART | VARCHAR2(100) | Y |
| VD_DR_CR | VARCHAR2(1) | Y |
| DR_AMOUNT | NUMBER | Y |
| CR_AMOUNT | NUMBER | Y |
| UNIT_ID | VARCHAR2(1) | Y |
| LOC_CD | VARCHAR2(2) | Y |
| VD_VTYPE | VARCHAR2(4) | Y |
| VD_VDATE | DATE | Y |
| VD_CHQ# | VARCHAR2(100) | Y |
| REF_TYPE | VARCHAR2(4) | Y |
| SEQ_U | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

## Targets, incentives and retail

### TARGET_MST

Monthly target header. Source: Karachi + Islamabad.

- PK: (BRNCH, SERNO)
- FK FK_TARGET_MST_16: (BRNCH, CUSTM) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | N |
| WDATE | DATE | Y |
| MNTH | VARCHAR2(10) | Y |
| CUSTM | VARCHAR2(20) | Y |
| REMRK | VARCHAR2(200) | Y |
| QTY | NUMBER | Y |
| AMT | NUMBER | Y |
| STATS | VARCHAR2(1) | Y |
| WORK_DAYS | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TARGET_CUST

Target per customer. Source: Karachi + Islamabad.

- UK UK_TARGET_CUST_N1: (BRNCH, TRG_NO, SERNO)
- FK FK_TARGET_CUST_64: (BRNCH, TRG_NO) → TARGET_MST (BRNCH, SERNO)
- FK FK_TARGET_CUST_65: (BRNCH, CUST_ID) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| TRG_NO | NUMBER | Y |
| SERNO | NUMBER | Y |
| CUST_ID | VARCHAR2(20) | Y |
| QTY | NUMBER | Y |
| AMT | NUMBER | Y |
| QTY2 | NUMBER | Y |
| QTY3 | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TARGET_CUST_AREA

Target per customer and area. Source: Karachi + Islamabad.

- UK UK_TARGET_CUST_AREA_N1: (BRNCH, TRG_NO, LNKNO)
- FK FK_TARGET_CUST_AREA_66: (BRNCH, CUST_ID) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| TRG_NO | NUMBER | Y |
| SERNO | NUMBER | Y |
| LNKNO | NUMBER | Y |
| CUST_ID | VARCHAR2(20) | Y |
| AREA_CD | NUMBER | Y |
| QTY | NUMBER | Y |
| AMT | NUMBER | Y |
| QTY2 | NUMBER | Y |
| QTY3 | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TARGET_DTL_CTY

Target per city (KHI). Source: Karachi only.

- PK: (BRNCH, DOCNO)

| Column | Type | Null |
| --- | --- | --- |
| SERNO | NUMBER | Y |
| DIST_CD | NUMBER | Y |
| TARGET | NUMBER | Y |
| REMRK | VARCHAR2(200) | Y |
| DOCNO | NUMBER | N |
| AREA | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TARGET_PERC_MST

Monthly incentive header (ISB). Source: Islamabad only.

- UK UK_TARGET_PERC_MST_N1: (BRNCH, PERC_ID)

| Column | Type | Null |
| --- | --- | --- |
| PERC_ID | NUMBER | Y |
| MNTH | DATE | Y |
| REMARKS | VARCHAR2(200) | Y |
| TAR_MNTH | VARCHAR2(10) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### TARGET_PERC_DTL

Incentive slabs: target % → amount (ISB). Source: Islamabad only.

- FK FK_TARGET_PERC_DTL_76: (BRNCH, PERC_ID) → TARGET_PERC_MST (BRNCH, PERC_ID)

| Column | Type | Null |
| --- | --- | --- |
| PERC_ID | NUMBER | Y |
| TAR_PERC | NUMBER | Y |
| AMOUNT | NUMBER | Y |
| TAR_PERC_1 | NUMBER | Y |
| TAR_PERC_2 | NUMBER | Y |
| AMOUNT_2 | NUMBER | Y |
| SEPCIAL_TAR_PERC | NUMBER | Y |
| SPECIAL_AMOUNT | NUMBER | Y |
| ADDITION_TAR_PERC | NUMBER | Y |
| ADDITION_AMOUNT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### INCENTIVE

Incentive scheme header. Source: Karachi + Islamabad.

- PK: (BRNCH, SRL_NO)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(8) | N |
| MEMO_DATE | DATE | Y |
| MEMO_NO | VARCHAR2(30) | Y |
| DATE_FROM | DATE | Y |
| DATE_TO | DATE | Y |
| CUSTOMER_FROM | VARCHAR2(11) | Y |
| CUSTOMER_TO | VARCHAR2(11) | Y |
| REMARKS | VARCHAR2(256) | Y |
| ENTER_BY | VARCHAR2(10) | Y |
| ENTER_DATE | DATE | Y |
| POST_BY | VARCHAR2(10) | Y |
| POST_DATE | DATE | Y |
| POST | VARCHAR2(1) | Y |
| CLEAN | NUMBER | Y |
| TOTAL | NUMBER | Y |
| INCENTIVE | NUMBER | Y |
| TRANSITORY | NUMBER | Y |
| BUFFER | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### INCENTIVE_PRODUCT

Products in a scheme. Source: Karachi + Islamabad.

- UK UK_INCENTIVE_PRODUCT_N1: (BRNCH, SRL_NO, PRODUCT_CODE)
- FK FK_INCENTIVE_PRODUCT_51: (BRNCH, SRL_NO) → INCENTIVE (BRNCH, SRL_NO)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(8) | N |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| RATE | NUMBER(8,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### INCENTIVE_DETAIL

Incentive per customer. Source: Karachi + Islamabad.

- UK UK_INCENTIVE_DETAIL_N1: (BRNCH, SRL_NO, SR_NO)
- FK FK_INCENTIVE_DETAIL_49: (BRNCH, SRL_NO) → INCENTIVE (BRNCH, SRL_NO)
- FK FK_INCENTIVE_DETAIL_50: (BRNCH, CUSTOMER_CODE) → CUSTOMER_INFO (BRNCH, CUSTOMER_CODE)

| Column | Type | Null |
| --- | --- | --- |
| SRL_NO | NUMBER(8) | N |
| SR_NO | NUMBER(4) | Y |
| CUSTOMER_CODE | VARCHAR2(11) | Y |
| PRODUCT_CODE | VARCHAR2(4) | Y |
| QUANTITY | NUMBER(8,2) | Y |
| RATE | NUMBER(8,4) | Y |
| CR_NOTE_NO | NUMBER(6) | Y |
| AMOUNT | NUMBER(12,2) | Y |
| ACTUAL_QTY | NUMBER(8,2) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### D_CATEGORY

Dealer/retailer categories (KHI). Source: Karachi only.

- UK UK_D_CATEGORY_N1: (BRNCH, CAT_ID)

| Column | Type | Null |
| --- | --- | --- |
| CAT_ID | VARCHAR2(3) | Y |
| F_QTY | NUMBER | Y |
| T_QTY | NUMBER | Y |
| AMT | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### D_DEALER_MASTER

Dealers in retail scheme (KHI). Source: Karachi only.

- PK: (BRNCH, D_CODE)

| Column | Type | Null |
| --- | --- | --- |
| D_CODE | NUMBER | N |
| NAME | VARCHAR2(100) | Y |
| ADDRES | VARCHAR2(800) | Y |
| PHONE | VARCHAR2(50) | Y |
| LOC_ID_UPD | VARCHAR2(2) | Y |
| ORG_ID_UPD | VARCHAR2(8) | Y |
| USR_ID_UPD | VARCHAR2(2) | Y |
| DEPT_ID_UPD | VARCHAR2(2) | Y |
| USR_DATE_UPD | DATE | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### D_RETAILER_MASTER

Retailers (KHI). Source: Karachi only.

- PK: (BRNCH, R_CODE)

| Column | Type | Null |
| --- | --- | --- |
| R_CODE | NUMBER | N |
| NAME | VARCHAR2(100) | Y |
| ADDRES | VARCHAR2(800) | Y |
| PHONE | VARCHAR2(50) | Y |
| CHK_NAME | VARCHAR2(100) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### D_INSENTIVE_MASTER

Retailer incentive (KHI). Source: Karachi only.

- FK FK_D_INSENTIVE_MASTER_8: (BRNCH, R_CODE) → D_RETAILER_MASTER (BRNCH, R_CODE)
- FK FK_D_INSENTIVE_MASTER_9: (BRNCH, D_CODE) → D_DEALER_MASTER (BRNCH, D_CODE)

| Column | Type | Null |
| --- | --- | --- |
| R_CODE | NUMBER | Y |
| D_CODE | NUMBER | Y |
| TR_DATE | DATE | Y |
| VEHICLE_NO | VARCHAR2(10) | Y |
| DC_NO | NUMBER(8) | Y |
| DC_TYPE | VARCHAR2(10) | Y |
| RATE | NUMBER | Y |
| REC_QTY | NUMBER | Y |
| TOT_QTY | NUMBER | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RETAILER_INFO

Retailer details (KHI). Source: Karachi only.

- UK UK_RETAILER_INFO_N1: (BRNCH, RET_CODE)

| Column | Type | Null |
| --- | --- | --- |
| RET_CODE | VARCHAR2(15) | N |
| RET_NAME | VARCHAR2(200) | Y |
| TEL_NO | VARCHAR2(15) | N |
| ADDRESS | VARCHAR2(200) | Y |
| MOBILE_NO | VARCHAR2(15) | Y |
| FAX_NO | VARCHAR2(15) | Y |
| EMAIL | VARCHAR2(25) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RET_PAY_MAS

Retailer payment header (KHI). Source: Karachi only.

- PK: (BRNCH, RECEIPT_NO)

| Column | Type | Null |
| --- | --- | --- |
| RECEIPT_NO | NUMBER(7) | N |
| TDATE | DATE | Y |
| TYPE | VARCHAR2(1) | Y |
| AMOUNT | NUMBER(14,2) | Y |
| CHQ_NO | VARCHAR2(20) | Y |
| REMARKS | VARCHAR2(200) | Y |
| RET_CODE | VARCHAR2(15) | Y |
| ACK_NO | VARCHAR2(15) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### RET_PAY_DET

Retailer payment lines (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| RECEIPT_NO | VARCHAR2(7) | Y |
| TYPE | VARCHAR2(1) | Y |
| RET_CODE | VARCHAR2(15) | Y |
| COUPON_NO | VARCHAR2(15) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |

### MARKETING

Marketing visit/activity log (KHI). Source: Karachi only.


| Column | Type | Null |
| --- | --- | --- |
| ENT_DATE | DATE | Y |
| DO_NO | NUMBER(11) | Y |
| VEH_NO | VARCHAR2(100) | Y |
| USER_ID | VARCHAR2(20) | Y |
| SHEET_NO | NUMBER(6) | Y |
| REM | VARCHAR2(200) | Y |
| COMPC | NUMBER | N |
| BRNCH | NUMBER | N |
