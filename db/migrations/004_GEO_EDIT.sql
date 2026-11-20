-- =====================================================================
--  migrations/004_GEO_EDIT.sql  (TASKS P1-02)
--  GEO_HIERARCHY is maintained in the new system (Masters -> Geography): optimistic locking and
--  who/when. New nodes get SOURCE_TABLE = 'APP' and LEGACY_CODE = '-' (no legacy code).
--  Oracle 11g compatible. Re-running gives ORA-01430 (column already exists) and changes nothing.
-- =====================================================================

ALTER TABLE GEO_HIERARCHY ADD (ROW_VER NUMBER DEFAULT 1 NOT NULL, UPDATED_BY VARCHAR2(30), UPDATED_ON DATE);
