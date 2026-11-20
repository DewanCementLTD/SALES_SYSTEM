-- =====================================================================
--  migrations/009_RATE_SHEET_SEQ.sql  (TASKS P1-07)
--  Technical line ids of city rate sheets (AREA_RATES_P.P_LNKNO, AREA_RATES_D.LNKNO) for new sheets:
--  sequences that start above the legacy maxima (both branches share one series per table).
--  The sheet number AREA_RATES_M.SERNO is a document number: DOC_SEQUENCE type RSH (seed).
--  Oracle 11g compatible; anonymous PL/SQL only creates a sequence that does not exist yet.
-- =====================================================================

DECLARE
  n NUMBER;
  c NUMBER;
BEGIN
  SELECT COUNT(*) INTO c FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'SEQ_AREA_RATES_P';
  IF c = 0 THEN
    SELECT NVL(MAX(P_LNKNO), 0) + 1 INTO n FROM AREA_RATES_P;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_AREA_RATES_P START WITH ' || n || ' NOCACHE';
  END IF;
  SELECT COUNT(*) INTO c FROM USER_SEQUENCES WHERE SEQUENCE_NAME = 'SEQ_AREA_RATES_D';
  IF c = 0 THEN
    SELECT NVL(MAX(LNKNO), 0) + 1 INTO n FROM AREA_RATES_D;
    EXECUTE IMMEDIATE 'CREATE SEQUENCE SEQ_AREA_RATES_D START WITH ' || n || ' CACHE 100';
  END IF;
END;
/
