-- =====================================================================
--  migrations/017_TRUCK_EXITED_TEMPLATES.sql  (TASKS P3-08, BR-EXIT-03, BR-NTF-01)
--  Company-level dealer message templates for a truck leaving the plant. Admins edit them in
--  Admin › Message templates. Placeholders in {BRACES}. Re-runnable.
-- =====================================================================

INSERT INTO MSG_TEMPLATE (TEMPLATE_CODE, CHANNEL, SUBJECT, BODY, ACTIVE, BRNCH, COMPC) SELECT 'TRUCK_EXITED', 'SMS', NULL, 'DCL: truck {VEHICLE_NO} left the plant with {QTY} t {PRODUCT} (DC {DC_NO}, invoice {INVOICES}).', 'Y', NULL, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM MSG_TEMPLATE WHERE TEMPLATE_CODE = 'TRUCK_EXITED' AND CHANNEL = 'SMS' AND BRNCH IS NULL);
INSERT INTO MSG_TEMPLATE (TEMPLATE_CODE, CHANNEL, SUBJECT, BODY, ACTIVE, BRNCH, COMPC) SELECT 'TRUCK_EXITED', 'WA', NULL, 'Dear {CUSTOMER_NAME}, truck {VEHICLE_NO} has left the Dewan Cement plant with {QTY} t {PRODUCT} (DC {DC_NO}, invoice {INVOICES}).', 'Y', NULL, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM MSG_TEMPLATE WHERE TEMPLATE_CODE = 'TRUCK_EXITED' AND CHANNEL = 'WA' AND BRNCH IS NULL);
INSERT INTO MSG_TEMPLATE (TEMPLATE_CODE, CHANNEL, SUBJECT, BODY, ACTIVE, BRNCH, COMPC) SELECT 'TRUCK_EXITED', 'EMAIL', 'Truck {VEHICLE_NO} dispatched: DC {DC_NO}', 'Dear {CUSTOMER_NAME},' || CHR(10) || CHR(10) || 'Truck {VEHICLE_NO} has left the plant with {QTY} t {PRODUCT} on delivery challan {DC_NO} (invoice {INVOICES}).' || CHR(10) || CHR(10) || 'Regards,' || CHR(10) || 'Dewan Cement Limited', 'Y', NULL, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM MSG_TEMPLATE WHERE TEMPLATE_CODE = 'TRUCK_EXITED' AND CHANNEL = 'EMAIL' AND BRNCH IS NULL);
