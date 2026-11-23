-- =====================================================================
--  migrations/015_DO_ADJUST.sql  (TASKS P2-06, BR-DO-06)
--  DO quantity adjustment advice: DO_ADJUSTMENT.ADJUST_REASON keeps the reason of the advice
--  (the legacy table has none; CANCEL_REASON is for cancelling the advice itself). Index for
--  "pending advice of this DO". Advice numbers come from DOC_SEQUENCE DOA (BR-NUM).
--  Oracle 11g compatible.
-- =====================================================================

ALTER TABLE DO_ADJUSTMENT ADD (ADJUST_REASON VARCHAR2(500));
CREATE INDEX IX_DO_ADJ_DO ON DO_ADJUSTMENT (BRNCH, DO_NO, DOC_STATUS);
