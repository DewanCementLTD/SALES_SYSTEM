-- =====================================================================
--  migrations/018_SYNC_EVENT.sql  (TASKS P3-10, BR-OFF-01…04)
--  One row per offline event pushed by a plant tablet / PWA (client UUID): replays return the
--  stored result (BR-OFF-04). Failed events also go to SYNC_CONFLICT for the dispatch supervisor.
--  Oracle 11g compatible.
-- =====================================================================

CREATE TABLE SYNC_EVENT (
  CLIENT_ID    VARCHAR2(40)  NOT NULL,
  BRNCH        NUMBER        NOT NULL,
  EVENT_TYPE   VARCHAR2(20)  NOT NULL,
  STATUS       VARCHAR2(10)  NOT NULL,
  RESULT       CLOB,
  CONFLICT_ID  NUMBER,
  DEVICE_ID    VARCHAR2(40),
  USRID        VARCHAR2(20),
  DEVICE_TIME  DATE,
  RECEIVED_ON  DATE          NOT NULL,
  CONSTRAINT PK_SYNC_EVENT PRIMARY KEY (CLIENT_ID),
  CONSTRAINT CK_SE_STATUS CHECK (STATUS IN ('APPLIED','CONFLICT'))
);
CREATE INDEX IX_SE_TIME ON SYNC_EVENT (BRNCH, RECEIVED_ON);
