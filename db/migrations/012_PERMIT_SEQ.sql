-- =====================================================================
--  migrations/012_PERMIT_SEQ.sql  (TASKS P2-05, BR-PMT-*)
--  Technical ids for new permit rows, above the legacy maxima:
--  SEQ_PERMIT_DTL → PERMIT_DTL_CITY.LNKNO (area line), SEQ_PERMIT_ADJ → PERMIT_ADJ_CITY.SERNO
--  (quantity adjustment). The permit number itself comes from DOC_SEQUENCE PMT (BR-NUM).
--  PERMIT_DTL_CITY.RATE_OVERRIDE marks a city rate changed from the rate sheet.
--  Oracle 11g compatible; re-runnable.
-- =====================================================================

ALTER TABLE PERMIT_DTL_CITY ADD (RATE_OVERRIDE CHAR(1), SHEET_RATE NUMBER(16,2));
CREATE INDEX IX_PERMIT_CUST ON PERMIT_MST_CITY (BRNCH, CUSTOMER_CODE, DOC_STATUS);

DECLARE
  n NUMBER;
  c NUMBER;
BEGIN
  SELECT COUNT(*) INTO c FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'SEQ_PERMIT_DTL';
  IF c = 0 THEN
    SELECT NVL(MAX(LNKNO), 0) + 1 INTO n FROM PERMIT_DTL_CITY;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_PERMIT_DTL START WITH ' || n || ' NOCACHE';
  END IF;
  SELECT COUNT(*) INTO c FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'SEQ_PERMIT_ADJ';
  IF c = 0 THEN
    SELECT NVL(MAX(SERNO), 0) + 1 INTO n FROM PERMIT_ADJ_CITY;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_PERMIT_ADJ START WITH ' || n || ' NOCACHE';
  END IF;
END;
/
