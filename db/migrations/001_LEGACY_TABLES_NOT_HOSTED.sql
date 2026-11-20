-- =====================================================================
--  migrations/001_LEGACY_TABLES_NOT_HOSTED.sql
--  Gives a home in the unified schema to legacy business tables that 01 does not
--  have, so the structure can hold every legacy row (found by the 19-Nov-2026
--  column-by-column audit; see docs/SCHEMA.md 2.2).
--  * Same rules as 01: union of KHI/ISB columns, widest type, NOT NULL only where
--    NOT NULL in every source, BRNCH + COMPC on every table, keys start with BRNCH.
--  * Oracle 11g compatible, names <= 30, no data loaded here (see 02c).
--  Run as SALES_NEW after 01-04 (05 can run before or after).
-- =====================================================================
SET DEFINE OFF
WHENEVER SQLERROR EXIT
SELECT CASE WHEN USER = 'SALES_NEW' THEN 'OK: connected as SALES_NEW' ELSE TO_CHAR(1/0) END AS user_check FROM dual;
WHENEVER SQLERROR CONTINUE

-- INV_FH   <- ISB.INV_FH, KHI.SD_IMRANSB1, KHI.SD_IMRANSB
CREATE TABLE INV_FH
(
  DATA_TYPE       CHAR(7),
  DC_NO           NUMBER,
  COMP_NO         NUMBER,
  INVOICE_NO      NUMBER(8),
  DC_DATE         DATE,
  VEHICLE_NO      VARCHAR2(10),
  ZONE_CODE       VARCHAR2(10),
  G_CD            VARCHAR2(10),
  GROUP_ZONE      VARCHAR2(300),
  AREA_CD         VARCHAR2(22),
  AREA_NAME       VARCHAR2(60),
  DIST_CD         VARCHAR2(22),
  DIST_NAME       VARCHAR2(60),
  CITY_CD         NUMBER,
  CITY_NAME       VARCHAR2(50),
  PRODUCT_TYPE    VARCHAR2(255),
  CUSTOMER_GROUP  NUMBER(3),
  GROUP_DESC      VARCHAR2(200),
  CUSTOMER_CODE   VARCHAR2(11),
  CUSTOMER_NAME   VARCHAR2(60),
  PRODUCT_CODE    VARCHAR2(4),
  PRODUCT_NAME    VARCHAR2(60),
  QTY             NUMBER,
  VALU            NUMBER,
  FED             NUMBER,
  C_PRICE         NUMBER,
  S_TAX           NUMBER,
  INSENTIV        NUMBER,
  COMPC           NUMBER DEFAULT 1 NOT NULL,
  BRNCH           NUMBER NOT NULL
);
COMMENT ON TABLE INV_FH IS 'Dispatch/invoice summary per DC line. ISB INV_FH (2018-2023) + KHI SD_IMRANSB1 (2012-2024, same structure) + 2 extra rows of KHI SD_IMRANSB.';
CREATE INDEX IX_INV_FH_1 ON INV_FH (BRNCH, DC_DATE);
CREATE INDEX IX_INV_FH_2 ON INV_FH (BRNCH, CUSTOMER_CODE, DC_DATE);
CREATE INDEX IX_INV_FH_3 ON INV_FH (BRNCH, DC_NO);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'INV_FH', err_log_table_name => 'ERR$_INV_FH', skip_unsupported => TRUE);

-- SD_SALES_VS_MRP   <- KHI.SD_SALES_VS_MRP
CREATE TABLE SD_SALES_VS_MRP
(
  INVOICE_NO           NUMBER(8),
  INVOICE_DATE         DATE,
  DC_NO                NUMBER(8) NOT NULL,
  DC_DATE              DATE NOT NULL,
  DO_NO                NUMBER NOT NULL,
  OC_NO                NUMBER(9) NOT NULL,
  CUSTOMER_CODE        VARCHAR2(11) NOT NULL,
  CUSTOMER_NAME        VARCHAR2(60),
  SALES_TAX_NO         VARCHAR2(100),
  NTN                  VARCHAR2(50),
  CNIC                 VARCHAR2(50),
  CITY_CD              NUMBER,
  CITY_NAME            VARCHAR2(50),
  DIST_CD              NUMBER,
  ARE_CD               NUMBER,
  DIST_NAME            VARCHAR2(50),
  ARE_NAME             VARCHAR2(50),
  FREIGHT              NUMBER,
  COGM                 NUMBER,
  FIX_PLANT            NUMBER,
  FIX_HO               NUMBER,
  DEPRC                NUMBER,
  C_PRICE              NUMBER,
  P_TYPE               VARCHAR2(9),
  PRODUCT_CODE         VARCHAR2(4),
  QTY                  NUMBER,
  VALUE_FED            NUMBER,
  FED                  NUMBER,
  VALUE_INC_CED        NUMBER,
  SALES_TAX_AMT        NUMBER,
  TOTAL                NUMBER,
  WHT_TAX              NUMBER,
  QTY_M                NUMBER,
  VALUE_FED_M          NUMBER,
  FED_M                NUMBER,
  VALUE_INC_CED_M      NUMBER,
  SALES_TAX_AMT_M      NUMBER,
  TOTAL_M              NUMBER,
  WH_TAX_M             NUMBER,
  SUB_INC              NUMBER,
  RAW_MATERIAL         NUMBER,
  PACKING_MATERIAL     NUMBER,
  ELECTRICITY_EXPENSE  NUMBER,
  COAL_COST            NUMBER,
  GAS_COST             NUMBER,
  OTHERS               NUMBER,
  FIX_HOG              NUMBER,
  COMPC                NUMBER DEFAULT 1 NOT NULL,
  BRNCH                NUMBER NOT NULL
);
COMMENT ON TABLE SD_SALES_VS_MRP IS 'Karachi invoice history 1999-2024: invoice, DC, DO, OC, customer, city, qty, FED, sales tax, WHT, cost (COGM, raw/packing material, fuel).';
CREATE INDEX IX_SD_SALES_VS_MRP_1 ON SD_SALES_VS_MRP (BRNCH, INVOICE_DATE);
CREATE INDEX IX_SD_SALES_VS_MRP_2 ON SD_SALES_VS_MRP (BRNCH, CUSTOMER_CODE, INVOICE_DATE);
CREATE INDEX IX_SD_SALES_VS_MRP_3 ON SD_SALES_VS_MRP (BRNCH, DC_NO);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'SD_SALES_VS_MRP', err_log_table_name => 'ERR$_SD_SALES_VS_MRP', skip_unsupported => TRUE);

-- SD_SALE   <- KHI.SD_SALE
CREATE TABLE SD_SALE
(
  AREA_CODE     VARCHAR2(3),
  V_TYPE        VARCHAR2(3),
  DEPT_CODE     NUMBER(7),
  V_NO          VARCHAR2(11),
  ACODE         VARCHAR2(10),
  DEBIT         NUMBER(15,2),
  CREDIT        NUMBER(15,2),
  BANK_FLAG     CHAR(1),
  CHEQUE_NO     VARCHAR2(20),
  CHEQUE_DATE   DATE,
  DEPOSIT_NO    VARCHAR2(20),
  DEPOSIT_DATE  DATE,
  NARRATION     VARCHAR2(100),
  SUPP_FLAG     CHAR(1),
  SUPP_CODE     NUMBER(4),
  BILL_NO       VARCHAR2(20),
  S_NO          VARCHAR2(5),
  CASH_CODE     VARCHAR2(4),
  SALES_INV_NO  VARCHAR2(10),
  BILL_DATE     DATE,
  PDV_NO        VARCHAR2(11),
  LCHECK        VARCHAR2(10),
  LOC           VARCHAR2(2),
  CCODE         VARCHAR2(8),
  TYPE          CHAR(1),
  COMPC         NUMBER DEFAULT 1 NOT NULL,
  BRNCH         NUMBER NOT NULL
);
COMMENT ON TABLE SD_SALE IS 'Karachi finance voucher lines (account, debit/credit, cheque, deposit, sales invoice no) sent to accounts.';
CREATE INDEX IX_SD_SALE_1 ON SD_SALE (BRNCH, V_TYPE, V_NO);
CREATE INDEX IX_SD_SALE_2 ON SD_SALE (BRNCH, SALES_INV_NO);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'SD_SALE', err_log_table_name => 'ERR$_SD_SALE', skip_unsupported => TRUE);

-- ALT_OPEN_BALANCE   <- KHI.ALT_OPEN_BALANCE
CREATE TABLE ALT_OPEN_BALANCE
(
  CUSTOMER_CODE  VARCHAR2(11) NOT NULL,
  OPEN_DATE      DATE NOT NULL,
  CARD_BAL       NUMBER(16,2),
  DO_BAL         NUMBER(16,2),
  LEDGER_BAL     NUMBER(16,2),
  CLOSE_BY       VARCHAR2(10),
  CLOSE_DATE     DATE,
  YEAR           NUMBER(4),
  CLEAN          NUMBER(14),
  TRANSITORY     NUMBER(14),
  BILLING        NUMBER(14),
  ADVANCE        NUMBER(14),
  SECURITY       NUMBER(14),
  INCENTIVE      NUMBER(14),
  TAX            NUMBER(14),
  BOUNCE         NUMBER(14),
  COMPC          NUMBER DEFAULT 1 NOT NULL,
  BRNCH          NUMBER NOT NULL
);
COMMENT ON TABLE ALT_OPEN_BALANCE IS 'Alternate customer opening balances 1998-2011 (same layout as OPENING_BALANCES, different figures).';
CREATE INDEX IX_ALT_OPEN_BALANCE_1 ON ALT_OPEN_BALANCE (BRNCH, CUSTOMER_CODE, OPEN_DATE);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'ALT_OPEN_BALANCE', err_log_table_name => 'ERR$_ALT_OPEN_BALANCE', skip_unsupported => TRUE);

-- COST_OF_GOODS_SOLD   <- KHI.COST_OF_GOODS_SOLD
CREATE TABLE COST_OF_GOODS_SOLD
(
  FROM_DATE  DATE,
  TO_DATE    DATE,
  STATUS     VARCHAR2(1),
  TR_ID      NUMBER(4) NOT NULL,
  COMPC      NUMBER DEFAULT 1 NOT NULL,
  BRNCH      NUMBER NOT NULL,
  CONSTRAINT PK_COST_OF_GOODS_SOLD PRIMARY KEY (BRNCH, TR_ID)
);
COMMENT ON TABLE COST_OF_GOODS_SOLD IS 'COGS period header (TR_ID, from/to date, status).';
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'COST_OF_GOODS_SOLD', err_log_table_name => 'ERR$_COST_OF_GOODS_SOLD', skip_unsupported => TRUE);

-- COST_OF_GOODS_SOLD_DTL   <- KHI.COST_OF_GOODS_SOLD_DTL
CREATE TABLE COST_OF_GOODS_SOLD_DTL
(
  TR_ID    NUMBER(4),
  DC_TYPE  VARCHAR2(10),
  COGS     NUMBER(10,2),
  COMPC    NUMBER DEFAULT 1 NOT NULL,
  BRNCH    NUMBER NOT NULL
);
COMMENT ON TABLE COST_OF_GOODS_SOLD_DTL IS 'COGS per DC type for a period.';
CREATE INDEX IX_COST_OF_GOODS_SOLD_DTL_1 ON COST_OF_GOODS_SOLD_DTL (BRNCH, TR_ID, DC_TYPE);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'COST_OF_GOODS_SOLD_DTL', err_log_table_name => 'ERR$_COST_OF_GOODS_SOLD_DTL', skip_unsupported => TRUE);

-- COST_OF_GOODS_SOLD_ACCUMULATED   <- KHI.COST_OF_GOODS_SOLD_ACCUMULATED
CREATE TABLE COST_OF_GOODS_SOLD_ACCUMULATED
(
  STATUS       VARCHAR2(1),
  A_FROM_DATE  DATE,
  A_TO_DATE    DATE,
  TR_ID        NUMBER(4),
  COMPC        NUMBER DEFAULT 1 NOT NULL,
  BRNCH        NUMBER NOT NULL
);
COMMENT ON TABLE COST_OF_GOODS_SOLD_ACCUMULATED IS 'Accumulated COGS period header.';
CREATE INDEX IX_COST_OF_GOODS_SOLD_ACCU_1 ON COST_OF_GOODS_SOLD_ACCUMULATED (BRNCH, TR_ID);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'COST_OF_GOODS_SOLD_ACCUMULATED', err_log_table_name => 'ERR$_COST_OF_GOODS_SOLD_ACCUMU', skip_unsupported => TRUE);

-- COST_OF_GOODS_SOLD_ACUMLTD_DTL   <- KHI.COST_OF_GOODS_SOLD_ACUMLTD_DTL
CREATE TABLE COST_OF_GOODS_SOLD_ACUMLTD_DTL
(
  TR_ID             NUMBER(4),
  DC_TYPE           VARCHAR2(10),
  ACCUMULATED_COGS  NUMBER(13,4),
  COMPC             NUMBER DEFAULT 1 NOT NULL,
  BRNCH             NUMBER NOT NULL
);
COMMENT ON TABLE COST_OF_GOODS_SOLD_ACUMLTD_DTL IS 'Accumulated COGS per DC type.';
CREATE INDEX IX_COST_OF_GOODS_SOLD_ACUM_1 ON COST_OF_GOODS_SOLD_ACUMLTD_DTL (BRNCH, TR_ID, DC_TYPE);
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'COST_OF_GOODS_SOLD_ACUMLTD_DTL', err_log_table_name => 'ERR$_COST_OF_GOODS_SOLD_ACUMLT', skip_unsupported => TRUE);

-- CITY_V_TAB   <- KHI.CITY_V_TAB
CREATE TABLE CITY_V_TAB
(
  G_CD        NUMBER(3) NOT NULL,
  GROUP_ZONE  VARCHAR2(300),
  AREA_CD     NUMBER NOT NULL,
  AREA_NAME   VARCHAR2(50),
  DIST_CD     NUMBER NOT NULL,
  DIST_NAME   VARCHAR2(50),
  CITY_CD     NUMBER NOT NULL,
  CITY_NAME   VARCHAR2(50),
  COMPC       NUMBER DEFAULT 1 NOT NULL,
  BRNCH       NUMBER NOT NULL,
  CONSTRAINT PK_CITY_V_TAB PRIMARY KEY (BRNCH, G_CD, AREA_CD, DIST_CD, CITY_CD)
);
COMMENT ON TABLE CITY_V_TAB IS 'Karachi geography in one row: zone group (G_CD) -> area -> district -> city. Source for mapping Karachi to Zone -> Territory -> Area.';
EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'CITY_V_TAB', err_log_table_name => 'ERR$_CITY_V_TAB', skip_unsupported => TRUE);
