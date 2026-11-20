-- =====================================================================
--  migrations/008_TRADE_PRICE_GEO.sql  (TASKS P1-06, BR-PRC-02)
--  A trade price is for customer + product + city. New rows carry the GEO_HIERARCHY city
--  (GEO_CODE); legacy rows get it from LEGACY_MAP: Hattar TRADE_PRICE.AREA = AREA.AREA_DOC (entity
--  AREA), Karachi TRADE_PRICE.CITY_CD = CITY (entity CITY). Karachi rows priced only by the old
--  area/district codes (no CITY_CD) stay without GEO_CODE.
--  Oracle 11g compatible. Re-runnable (already-exists errors ignored, updates only fill empty values).
-- =====================================================================

ALTER TABLE TRADE_PRICE ADD (GEO_CODE VARCHAR2(50));
UPDATE TRADE_PRICE t SET GEO_CODE = (SELECT MAX(m.NEW_CODE) FROM LEGACY_MAP m WHERE m.BRNCH = 2 AND m.ENTITY = 'AREA' AND m.LEGACY_CODE = TO_CHAR(t.AREA)) WHERE t.BRNCH = 2 AND t.GEO_CODE IS NULL AND t.AREA IS NOT NULL;
UPDATE TRADE_PRICE t SET GEO_CODE = (SELECT MAX(m.NEW_CODE) FROM LEGACY_MAP m WHERE m.BRNCH = 1 AND m.ENTITY = 'CITY' AND m.LEGACY_CODE = TO_CHAR(t.CITY_CD)) WHERE t.BRNCH = 1 AND t.GEO_CODE IS NULL AND t.CITY_CD IS NOT NULL;
CREATE INDEX IX_TRADE_PRICE_KEY ON TRADE_PRICE (BRNCH, CUSTOMER_CODE, PRODUCT_CODE, GEO_CODE, EF_DATE);
