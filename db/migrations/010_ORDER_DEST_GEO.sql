-- =====================================================================
--  migrations/010_ORDER_DEST_GEO.sql  (TASKS P2-01/P2-02, BR-OC-01, BR-PRC-02)
--  The trade price of an order is for customer + product + destination city, so the SRF and the
--  OC carry the destination GEO_HIERARCHY node. Legacy Hattar SRFs hold the city as AREA_CODE
--  (= AREA.AREA_DOC, LEGACY_MAP entity AREA); legacy OCs take it from their SRF.
--  Oracle 11g compatible. Re-runnable (already-exists errors ignored, updates only fill empty values).
-- =====================================================================

ALTER TABLE SALES_REQUEST_MASTER ADD (DEST_GEO_CODE VARCHAR2(50));
ALTER TABLE ORDER_CONFIRM ADD (DEST_GEO_CODE VARCHAR2(50));
UPDATE SALES_REQUEST_MASTER s SET DEST_GEO_CODE = (SELECT MAX(m.NEW_CODE) FROM LEGACY_MAP m WHERE m.BRNCH = s.BRNCH AND m.ENTITY = 'AREA' AND m.LEGACY_CODE = TO_CHAR(s.AREA_CODE)) WHERE s.BRNCH = 2 AND s.DEST_GEO_CODE IS NULL AND s.AREA_CODE IS NOT NULL;
UPDATE ORDER_CONFIRM o SET DEST_GEO_CODE = (SELECT MAX(s.DEST_GEO_CODE) FROM SALES_REQUEST_MASTER s WHERE s.BRNCH = o.BRNCH AND s.SRF_NO = o.SRF_NO) WHERE o.DEST_GEO_CODE IS NULL;
CREATE INDEX IX_SRF_CUST ON SALES_REQUEST_MASTER (BRNCH, CUSTOMER_CODE, SRF_DATE);
CREATE INDEX IX_OC_CUST ON ORDER_CONFIRM (BRNCH, CUSTOMER_CODE, ORDER_DATE);
