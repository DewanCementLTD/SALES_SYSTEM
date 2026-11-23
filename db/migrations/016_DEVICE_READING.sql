-- =====================================================================
--  migrations/016_DEVICE_READING.sql  (TASKS P3-02, BR-WGT-01/07, ARCHITECTURE §6.4)
--  Captured weighbridge readings as signed and uploaded by the agent, before the weighing screen
--  uses one for a tare or gross (WEIGH_TICKET needs the gate pass; its UK (DEVICE_ID,
--  DEVICE_READING_ID) makes sure a reading is used once). Insert-only; kept for audit.
--  Oracle 11g compatible.
-- =====================================================================

CREATE TABLE DEVICE_READING (
  DEVICE_ID    VARCHAR2(40)  NOT NULL,
  READING_ID   VARCHAR2(60)  NOT NULL,
  BRNCH        NUMBER        NOT NULL,
  WEIGHT_KG    NUMBER(10)    NOT NULL,
  STABLE       CHAR(1)       NOT NULL,
  READ_ON      DATE          NOT NULL,
  RECEIVED_ON  DATE          NOT NULL,
  SIGNATURE    VARCHAR2(100) NOT NULL,
  CONSTRAINT PK_DEVICE_READING PRIMARY KEY (DEVICE_ID, READING_ID),
  CONSTRAINT FK_DEVREAD_DEVICE FOREIGN KEY (DEVICE_ID) REFERENCES APP_DEVICE (DEVICE_ID),
  CONSTRAINT CK_DEVREAD_STABLE CHECK (STABLE IN ('Y','N'))
);
CREATE INDEX IX_DEVREAD_TIME ON DEVICE_READING (BRNCH, RECEIVED_ON);
