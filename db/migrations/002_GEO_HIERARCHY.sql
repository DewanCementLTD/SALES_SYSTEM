-- =====================================================================
--  migrations/002_GEO_HIERARCHY.sql
--  One 4-level geography for both branches: Zone -> Territory -> Area -> City
--  (decision 19 Nov 2026, BRD decision log / Q9).
--
--  GEO_HIERARCHY holds one row per node on every level:
--    zone node      ZONE_CODE set,  TERRITORY/AREA/CITY empty   (GEO_LEVEL 1)
--    territory node ZONE + TERRITORY                            (GEO_LEVEL 2)
--    area node      ZONE + TERRITORY + AREA                     (GEO_LEVEL 3)
--    city node      all four codes                              (GEO_LEVEL 4)
--  so a customer, rate or document can point to the deepest level that is known.
--
--  Source mapping (filled by db/02d_LOAD_GEO.sql, legacy tables are not changed):
--    Karachi  : Zone = MASTER_AREA, Territory = AREA (SD-1, KHI-1 ...), Area = DISTRICT, City = CITY
--    Islamabad: Zone = copy of ZONE_DESC, Territory = ZONE_DESC, Area = TERRITORY, City = AREA (AREA_DOC)
--  Old code -> new GEO_CODE is recorded in LEGACY_MAP (ENTITY = legacy table name).
--
--  Oracle 11g compatible; GEO_ID from SEQ_GEO_HIERARCHY (technical id, not a document number).
--  Run as SALES_NEW. Re-running gives ORA-00955 / ORA-01430 (already exists) and changes nothing.
-- =====================================================================
SET DEFINE OFF
WHENEVER SQLERROR EXIT
SELECT CASE WHEN USER = 'SALES_NEW' THEN 'OK: connected as SALES_NEW' ELSE TO_CHAR(1/0) END AS user_check FROM dual;
WHENEVER SQLERROR CONTINUE

CREATE SEQUENCE SEQ_GEO_HIERARCHY START WITH 1 NOCACHE;

CREATE TABLE GEO_HIERARCHY
(
  GEO_ID          NUMBER        NOT NULL,
  GEO_CODE        VARCHAR2(50)  NOT NULL,          -- readable path, e.g. Z2-T1-A2-C4
  GEO_LEVEL       NUMBER(1)     NOT NULL,          -- 1 zone, 2 territory, 3 area, 4 city
  ZONE_CODE       VARCHAR2(20)  NOT NULL,
  ZONE_NAME       VARCHAR2(300) NOT NULL,
  TERRITORY_CODE  VARCHAR2(20),
  TERRITORY_NAME  VARCHAR2(100),
  AREA_CODE       VARCHAR2(20),
  AREA_NAME       VARCHAR2(100),
  CITY_CODE       VARCHAR2(20),
  CITY_NAME       VARCHAR2(100),
  SOURCE_TABLE    VARCHAR2(30)  NOT NULL,          -- legacy table of this node
  LEGACY_CODE     VARCHAR2(50)  NOT NULL,          -- legacy key of this node (as in LEGACY_MAP)
  REMARKS         VARCHAR2(200),
  ACTIVE          CHAR(1)       DEFAULT 'Y' NOT NULL,
  CREATED_ON      DATE          DEFAULT SYSDATE NOT NULL,
  COMPC           NUMBER        DEFAULT 1 NOT NULL,
  BRNCH           NUMBER        NOT NULL,
  CONSTRAINT PK_GEO_HIERARCHY PRIMARY KEY (GEO_ID),
  CONSTRAINT UK_GEO_HIERARCHY_CODE UNIQUE (BRNCH, GEO_CODE),
  CONSTRAINT CK_GEO_LEVEL CHECK (
       (GEO_LEVEL = 1 AND TERRITORY_CODE IS NULL AND AREA_CODE IS NULL AND CITY_CODE IS NULL)
    OR (GEO_LEVEL = 2 AND TERRITORY_CODE IS NOT NULL AND AREA_CODE IS NULL AND CITY_CODE IS NULL)
    OR (GEO_LEVEL = 3 AND TERRITORY_CODE IS NOT NULL AND AREA_CODE IS NOT NULL AND CITY_CODE IS NULL)
    OR (GEO_LEVEL = 4 AND TERRITORY_CODE IS NOT NULL AND AREA_CODE IS NOT NULL AND CITY_CODE IS NOT NULL)),
  CONSTRAINT CK_GEO_ACTIVE CHECK (ACTIVE IN ('Y','N'))
);
COMMENT ON TABLE GEO_HIERARCHY IS 'Unified 4-level geography Zone -> Territory -> Area -> City for both branches; one row per node on every level.';
CREATE INDEX IX_GEO_HIER_PATH ON GEO_HIERARCHY (BRNCH, ZONE_CODE, TERRITORY_CODE, AREA_CODE, CITY_CODE);
CREATE INDEX IX_GEO_HIER_SRC  ON GEO_HIERARCHY (BRNCH, SOURCE_TABLE, LEGACY_CODE);

-- Customer placement in the geography (deepest known level)
ALTER TABLE CUSTOMER_INFO ADD (GEO_CODE   VARCHAR2(50));
ALTER TABLE CUSTOMER_INFO ADD (GEO_SOURCE VARCHAR2(20));
COMMENT ON COLUMN CUSTOMER_INFO.GEO_CODE   IS 'GEO_HIERARCHY.GEO_CODE of the customer (same BRNCH); deepest known level.';
COMMENT ON COLUMN CUSTOMER_INFO.GEO_SOURCE IS 'How GEO_CODE was set: KHI_SALES_HISTORY, ISB_AREA, ISB_TERRITORY, MANUAL.';
CREATE INDEX IX_CUST_GEO ON CUSTOMER_INFO (BRNCH, GEO_CODE);

EXEC DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'GEO_HIERARCHY', err_log_table_name => 'ERR$_GEO_HIERARCHY', skip_unsupported => TRUE);

PROMPT ===== 002 done. Only ORA-00955 / ORA-01430 / ORA-01408 (already exists) are acceptable. =====
