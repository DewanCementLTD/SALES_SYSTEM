-- =====================================================================
--  migrations/019_NOTE_TYPE_SETTINGS.sql  (TASKS P4-01, BR-NOTE-01, OPEN-Q5)
--  Credit note type codes differ per branch in CREDIT_NOTE_TYPE: Hattar follows BR-NOTE-01
--  (004 = SALES RETURN), Karachi has its own list (004 = COMMISSION, 006 = SALES RETURN).
--  Company default NOTE_TYPE_SALES_RETURN = 004 (pnpm db:seed); Karachi override = 006.
--  To confirm with Finance (codes per branch or one list). Re-runnable.
-- =====================================================================

INSERT INTO APP_SETTING (BRNCH, SETTING_KEY, SETTING_VALUE, VALUE_TYPE, DESCR, UPDATED_BY, UPDATED_ON) SELECT 1, 'NOTE_TYPE_SALES_RETURN', '006', 'STRING', 'Credit note type of a sales return (Karachi code list)', 'migration', SYSDATE FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM APP_SETTING WHERE BRNCH = 1 AND SETTING_KEY = 'NOTE_TYPE_SALES_RETURN');
