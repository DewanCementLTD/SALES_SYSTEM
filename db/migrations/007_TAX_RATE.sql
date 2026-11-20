-- =====================================================================
--  migrations/007_TAX_RATE.sql  (TASKS P1-05, BR-TAX-05, BR-PRC-06)
--  Effective-dated withholding-tax rates by filer status and section. A rate applies from
--  EFFECTIVE_FROM until a later approved row for the same key starts; rows are never edited
--  (a change is a new row, BR-PRC-01). DOC_STATUS PENDING_APPROVAL -> APPROVED / REJECTED
--  (approval rule RATE_CHANGE). BRNCH 0 = both branches; a branch row wins over 0.
--  FED and sales tax stay on PRODUCT_DESC_T periods (BR-TAX-02/03/10); further tax is the
--  FURTHER_TAX_PCT setting (BR-TAX-06).
--  Oracle 11g compatible. Re-running gives ORA-00955 (already exists) and changes nothing.
-- =====================================================================

CREATE SEQUENCE SEQ_TAX_RATE START WITH 1 NOCACHE;

CREATE TABLE TAX_RATE
(
  TAX_RATE_ID     NUMBER        NOT NULL,
  COMPC           NUMBER        DEFAULT 1 NOT NULL,
  BRNCH           NUMBER        DEFAULT 0 NOT NULL,
  TAX_KIND        VARCHAR2(20)  NOT NULL,
  FILER_STATUS    VARCHAR2(1)   NOT NULL,
  SECTION         VARCHAR2(20)  DEFAULT '-' NOT NULL,
  RATE_PCT        NUMBER(7,4)   NOT NULL,
  EFFECTIVE_FROM  DATE          NOT NULL,
  REMARKS         VARCHAR2(200),
  DOC_STATUS      VARCHAR2(20)  NOT NULL,
  ROW_VER         NUMBER        DEFAULT 1 NOT NULL,
  CREATED_BY      VARCHAR2(30)  NOT NULL,
  CREATED_ON      DATE          NOT NULL,
  APPROVED_BY     VARCHAR2(30),
  APPROVED_ON     DATE,
  CONSTRAINT PK_TAX_RATE PRIMARY KEY (TAX_RATE_ID),
  CONSTRAINT CK_TAX_RATE_KIND CHECK (TAX_KIND IN ('WHT')),
  CONSTRAINT CK_TAX_RATE_FILER CHECK (FILER_STATUS IN ('F','N','E')),
  CONSTRAINT CK_TAX_RATE_STATUS CHECK (DOC_STATUS IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
  CONSTRAINT CK_TAX_RATE_PCT CHECK (RATE_PCT >= 0 AND RATE_PCT <= 100)
);

CREATE INDEX IX_TAX_RATE_KEY ON TAX_RATE (TAX_KIND, FILER_STATUS, SECTION, BRNCH, EFFECTIVE_FROM);
