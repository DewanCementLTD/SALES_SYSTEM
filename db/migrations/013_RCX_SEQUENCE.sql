-- =====================================================================
--  migrations/013_RCX_SEQUENCE.sql  (TASKS P2-08, BR-NUM-04)
--  Receipt cancellation advices (RECEIPT_CANCEL_MASTER.CANCEL_NO) are text 'YYYY-NNNN'
--  (e.g. 2027-0011). The seed started DOC_SEQUENCE RCX at 0, so new advices would repeat legacy
--  numbers: move each branch's counter to the highest legacy NNNN of that fiscal year.
--  Data fix only; re-runnable (GREATEST never lowers a counter).
-- =====================================================================

UPDATE DOC_SEQUENCE s SET LAST_NO = GREATEST(s.LAST_NO, (SELECT NVL(MAX(TO_NUMBER(SUBSTR(r.CANCEL_NO, 6))), 0) FROM RECEIPT_CANCEL_MASTER r WHERE r.BRNCH = s.BRNCH AND r.CANCEL_NO LIKE TO_CHAR(s.YEAR) || '-%' AND LENGTH(r.CANCEL_NO) = 9)) WHERE s.DOC_TYPE = 'RCX';
