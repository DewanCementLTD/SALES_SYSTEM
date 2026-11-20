-- =====================================================================
--  04_CLEANUP_DUPLICATES.sql   (run as SALES_NEW)
--  Fixes the problems reported by 03. Every section shows a preview first.
--  Nothing is committed automatically: check the output, then type COMMIT
--  (or ROLLBACK if something looks wrong).
--
--  SPOOL "C:/Users/Administrator/Desktop/SALES_SYSTEM/run_04.log"
--  @"C:/Users/Administrator/Desktop/SALES_SYSTEM/04_CLEANUP_DUPLICATES.sql"
--  SPOOL OFF
-- =====================================================================
SET DEFINE OFF
SET ECHO ON
SET PAGESIZE 500 LINESIZE 200
WHENEVER SQLERROR EXIT ROLLBACK
SELECT CASE WHEN USER = 'SALES_NEW' THEN 'OK: connected as SALES_NEW' ELSE TO_CHAR(1/0) END AS user_check FROM dual;
WHENEVER SQLERROR CONTINUE

-- ---------------------------------------------------------------------
-- 0. (DDL first - DDL auto-commits, so it must run before the reviewable DML)
--    Constraints that are wrong for history/log tables -> drop them
--    (their indexes stay as normal indexes).
-- ---------------------------------------------------------------------
ALTER TABLE BLOCK_CUSTOMER DROP CONSTRAINT UK_BLOCK_CUSTOMER_N1 KEEP INDEX;
ALTER TABLE SEC_LHISTORY   DROP CONSTRAINT UK_SEC_LHISTORY_N1   KEEP INDEX;

-- ---------------------------------------------------------------------
-- 1. GROUP_MST: Islamabad has no GROUP_MST table, so ISB product types
--    (GRP_ID 1..5) point to nothing. Copy the Karachi groups as BRNCH = 2.
-- ---------------------------------------------------------------------
PROMPT === 1. KHI groups that will be copied for ISB ===
SELECT GRP_ID, NAME, ORD_BY FROM GROUP_MST WHERE BRNCH = 1 ORDER BY GRP_ID;

INSERT INTO GROUP_MST (GRP_ID, NAME, ORD_BY, COMPC, BRNCH)
SELECT g.GRP_ID, g.NAME, g.ORD_BY, g.COMPC, 2
  FROM GROUP_MST g
 WHERE g.BRNCH = 1
   AND g.GRP_ID IN (SELECT DISTINCT GRP_ID_FK FROM PRODUCT_TYPE WHERE BRNCH = 2)
   AND NOT EXISTS (SELECT 1 FROM GROUP_MST x WHERE x.BRNCH = 2 AND x.GRP_ID = g.GRP_ID);

PROMPT === ISB product types and the group they now point to (check names match) ===
SELECT p.PROD_ID, p.NAME product, p.GRP_ID_FK, g.NAME grp
  FROM PRODUCT_TYPE p LEFT JOIN GROUP_MST g ON g.BRNCH = p.BRNCH AND g.GRP_ID = p.GRP_ID_FK
 WHERE p.BRNCH = 2 ORDER BY p.GRP_ID_FK, p.PROD_ID;

-- ---------------------------------------------------------------------
-- 2. SEC_MODULE_S: 6 modules are defined twice (SD_ACUDEBTSUM, SD_BANK_DEPOSIT,
--    SD_KASHIF, SD_OST_KP3 in KHI; SD_CRLMT, SD_PERMIT_DM in ISB).
--    Keep the most recent definition (latest WDATE).
-- ---------------------------------------------------------------------
PROMPT === 2. duplicate module rows (preview) ===
SELECT BRNCH, SYSTM, MODUL, EXTNS, DESCR, WDATE, STATS FROM SEC_MODULE_S m
 WHERE (BRNCH, SYSTM, MODUL) IN (SELECT BRNCH, SYSTM, MODUL FROM SEC_MODULE_S GROUP BY BRNCH, SYSTM, MODUL HAVING COUNT(*) > 1)
 ORDER BY BRNCH, SYSTM, MODUL, WDATE;

DELETE FROM SEC_MODULE_S
 WHERE ROWID IN (
   SELECT rid FROM (
     SELECT ROWID rid, ROW_NUMBER() OVER (PARTITION BY BRNCH, SYSTM, MODUL ORDER BY WDATE DESC NULLS LAST, ROWID DESC) rn
       FROM SEC_MODULE_S)
   WHERE rn > 1);

-- ---------------------------------------------------------------------
-- 3. SEC_USERPERM: the 72 duplicate permissions come from those same
--    duplicated modules (each user got the right twice).
--    Keep ONE row per user+module, carrying the HIGHEST rights of the pair
--    (so nobody loses access), then delete the extra row.
-- ---------------------------------------------------------------------
PROMPT === 3. duplicate permission pairs whose rights differ (these will be merged) ===
SELECT BRNCH, UNIT_ID, USRID, SYSTM, MODUL,
       MIN(INSRT)||'/'||MAX(INSRT) insrt, MIN(QUERY)||'/'||MAX(QUERY) query, MIN(UPDAT)||'/'||MAX(UPDAT) updat,
       MIN(DELET)||'/'||MAX(DELET) delet, MIN(PRINT)||'/'||MAX(PRINT) print, MIN(STATS)||'/'||MAX(STATS) stats
  FROM SEC_USERPERM
 GROUP BY BRNCH, UNIT_ID, USRID, SYSTM, MODUL
HAVING COUNT(*) > 1
   AND (COUNT(DISTINCT INSRT) > 1 OR COUNT(DISTINCT QUERY) > 1 OR COUNT(DISTINCT UPDAT) > 1
        OR COUNT(DISTINCT DELET) > 1 OR COUNT(DISTINCT PRINT) > 1 OR COUNT(DISTINCT STATS) > 1);

UPDATE SEC_USERPERM u
   SET (INSRT, QUERY, UPDAT, DELET, PRINT) =
       (SELECT MAX(INSRT), MAX(QUERY), MAX(UPDAT), MAX(DELET), MAX(PRINT)
          FROM SEC_USERPERM d
         WHERE d.BRNCH = u.BRNCH AND d.UNIT_ID = u.UNIT_ID AND d.USRID = u.USRID
           AND d.SYSTM = u.SYSTM AND d.MODUL = u.MODUL)
 WHERE (BRNCH, UNIT_ID, USRID, SYSTM, MODUL) IN
       (SELECT BRNCH, UNIT_ID, USRID, SYSTM, MODUL FROM SEC_USERPERM
         GROUP BY BRNCH, UNIT_ID, USRID, SYSTM, MODUL HAVING COUNT(*) > 1);

DELETE FROM SEC_USERPERM
 WHERE ROWID IN (
   SELECT rid FROM (
     SELECT ROWID rid, ROW_NUMBER() OVER (PARTITION BY BRNCH, UNIT_ID, USRID, SYSTM, MODUL ORDER BY PDATE DESC NULLS LAST, ROWID DESC) rn
       FROM SEC_USERPERM)
   WHERE rn > 1);

-- ---------------------------------------------------------------------
-- 4. TRANSPORTER_DESC: 'ROSHAN SHANWARI' exists twice in ISB with two codes.
--    DOs/DCs refer to the CODE, so do not delete either row - just make the
--    second name distinct by adding its code.
-- ---------------------------------------------------------------------
PROMPT === 4. duplicate transporter (preview) ===
SELECT BRNCH, TRANSP_CODE, TRANSP_NAME, PHONE, ADDRESS FROM TRANSPORTER_DESC
 WHERE BRNCH = 2 AND TRANSP_NAME = 'ROSHAN SHANWARI';

UPDATE TRANSPORTER_DESC t
   SET TRANSP_NAME = SUBSTR(TRANSP_NAME || ' (' || TRANSP_CODE || ')', 1, 4000)
 WHERE BRNCH = 2 AND TRANSP_NAME = 'ROSHAN SHANWARI'
   AND TRANSP_CODE <> (SELECT MIN(TRANSP_CODE) FROM TRANSPORTER_DESC
                        WHERE BRNCH = 2 AND TRANSP_NAME = 'ROSHAN SHANWARI');

-- ---------------------------------------------------------------------
-- 6. Re-check (all should be 0 except FK_PERMIT_ADJ_CITY_58, which is the
--    September-only window and goes away with the full load).
-- ---------------------------------------------------------------------
PROMPT === 6. re-check ===
SELECT 'UK_SEC_MODULE_S_N1' chk, COUNT(*) problems FROM (SELECT 1 FROM SEC_MODULE_S GROUP BY BRNCH, SYSTM, MODUL HAVING COUNT(*) > 1)
UNION ALL
SELECT 'UK_SEC_USERPERM_N1', COUNT(*) FROM (SELECT 1 FROM SEC_USERPERM GROUP BY BRNCH, UNIT_ID, USRID, SYSTM, MODUL HAVING COUNT(*) > 1)
UNION ALL
SELECT 'UK_TRANSPORTER_DESC_N2', COUNT(*) FROM (SELECT 1 FROM TRANSPORTER_DESC WHERE TRANSP_NAME IS NOT NULL GROUP BY BRNCH, TRANSP_NAME HAVING COUNT(*) > 1)
UNION ALL
SELECT 'FK_PRODUCT_TYPE_11', COUNT(*) FROM PRODUCT_TYPE c
 WHERE c.GRP_ID_FK IS NOT NULL AND NOT EXISTS (SELECT 1 FROM GROUP_MST p WHERE p.BRNCH = c.BRNCH AND p.GRP_ID = c.GRP_ID_FK);

PROMPT === If everything looks right type COMMIT; otherwise ROLLBACK; ===
