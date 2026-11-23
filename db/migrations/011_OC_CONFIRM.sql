-- =====================================================================
--  migrations/011_OC_CONFIRM.sql  (TASKS P2-03, BR-OC-05/07, BR-DO-01)
--  * DELIVERY_ORDER.DEST_GEO_CODE: destination city of a DO (from its OC); the legacy DEST_AREA
--    (VARCHAR2(15)) is too short for GEO_HIERARCHY codes.
--  * SEQ_OC_BRV: technical id ORDER_CONFIRM_BRV.SERNO for new OC ↔ BRV links, above the legacy max.
--  Oracle 11g compatible. Re-runnable (already-exists errors ignored; the sequence is created once).
-- =====================================================================

ALTER TABLE DELIVERY_ORDER ADD (DEST_GEO_CODE VARCHAR2(50));
CREATE INDEX IX_DO_CUST_STATUS ON DELIVERY_ORDER (BRNCH, CUSTOMER_CODE, DOC_STATUS);
CREATE INDEX IX_OC_BRV_RECEIPT ON ORDER_CONFIRM_BRV (BRNCH, RECEIPT_NO);

DECLARE
  n NUMBER;
  c NUMBER;
BEGIN
  SELECT COUNT(*) INTO c FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'SEQ_OC_BRV';
  IF c = 0 THEN
    SELECT NVL(MAX(SERNO), 0) + 1 INTO n FROM ORDER_CONFIRM_BRV;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_OC_BRV START WITH ' || n || ' NOCACHE';
  END IF;
END;
/
