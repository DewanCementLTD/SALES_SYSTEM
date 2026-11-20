-- =====================================================================
--  migrations/005_CUSTOMER_BLOCK.sql  (TASKS P1-03, BR-CUS-08, decision 20 Nov 2026)
--  Block / unblock history of the new system. Legacy BLOCK_CUSTOMER (customer <-> group rows
--  without date or block flag) stays unchanged and is shown read-only as "legacy groups".
--  The customer's current status is CUSTOMER_INFO.DOC_STATUS (BLOCKED / APPROVED); the latest
--  row here says why and whether dispatch against existing DOs is stopped.
--  Oracle 11g compatible. Re-running gives ORA-00955 (already exists) and changes nothing.
-- =====================================================================

CREATE SEQUENCE SEQ_CUSTOMER_BLOCK START WITH 1 NOCACHE;

CREATE TABLE CUSTOMER_BLOCK
(
  BLOCK_ID       NUMBER         NOT NULL,
  COMPC          NUMBER         DEFAULT 1 NOT NULL,
  BRNCH          NUMBER         NOT NULL,
  CUSTOMER_CODE  VARCHAR2(11)   NOT NULL,
  ACTION         VARCHAR2(10)   NOT NULL,
  STOP_DISPATCH  CHAR(1)        DEFAULT 'N' NOT NULL,
  REASON         VARCHAR2(1000) NOT NULL,
  CREATED_BY     VARCHAR2(30)   NOT NULL,
  CREATED_ON     DATE           NOT NULL,
  CONSTRAINT PK_CUSTOMER_BLOCK PRIMARY KEY (BLOCK_ID),
  CONSTRAINT CK_CUST_BLOCK_ACTION CHECK (ACTION IN ('BLOCK','UNBLOCK')),
  CONSTRAINT CK_CUST_BLOCK_STOP CHECK (STOP_DISPATCH IN ('Y','N'))
);

CREATE INDEX IX_CUSTOMER_BLOCK ON CUSTOMER_BLOCK (BRNCH, CUSTOMER_CODE, BLOCK_ID);
