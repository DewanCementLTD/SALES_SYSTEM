# UI mockups (SALES_UI.pdf) — how they are used

`SALES_UI.pdf` (8 screens: Customer Registration, SRF, Order Confirmation, BRV, Permit, Dispatch/DC,
Plant Monitoring dashboard, Sales & Dispatch dashboard) sets the **look and layout**. Where a mockup
contradicts `BUSINESS_RULES.md`, the rules win (decision 19 Nov 2026). Navigation follows PRD §3 exactly.

Design tokens taken from pages 1–7 (`apps/web/src/app/globals.css`): navy sidebar `#0c2744`, teal primary
`#0e6a76`, orange call-to-action `#f26b1d`, light canvas `#f2f5f9`, white cards, right-side status panels,
icon tile + large title page header, status pills (green/amber/red).

| Screen (page) | Taken from the mockup | Built to the rules instead |
|---|---|---|
| Customer (1) | Tab card, Approval/Status + Customer Summary panels, area grid, toggles, customer-type segmented control | Tabs per PRD 4.2; code per BR-CUS-03 (preview); Approve only for a checker ≠ maker (BR-CUS-02); areas from GEO_HIERARCHY |
| SRF (2) | Layout, tons↔bags, Local/Export, schedule grid, summary panel | Validity = SRF date + `CONTRACT_VALID_MONTHS` [3] (BR-SRF-07), not 14 days; main action "Submit" creates the draft OC (BR-SRF-05) |
| OC (3) | Header, pricing block, BRV link grid, balance cards, schedule, action panel | State-machine stepper DRAFT→REVIEWED→APPROVED→CONFIRMED; "Generate DO" = Confirm with BR-OC-06 balance check; override badges |
| BRV (4) | Entry, cheque detail, verification panel + timeline, knock-off grid, cancel panel | Methods PHONE/BANK_PORTAL/STATEMENT/OTHER entered manually (no auto-match, out of scope); maker ≠ verifier; knock-off informational (BR-BRV-07) |
| Permit (5) | City grid, balance panel, adjustment grid, action bar | No Valid-To / 14-day block (BR-PMT-04); rates from the rate sheet |
| DC (6) | Customer/Transport/Product cards, DO lines, barcode, summary + validation panel | DC references DO/permit (not BRV); adds gate/weighing card (tare, gross, net, planned, OVER/UNDER, tolerance); invoices automatic after gross OK (BR-INV-01) |
| Dashboards (7, 8) | Page 8 KPI row + Alerts & To-Dos → Home; page 7 → Plant dashboard | Built in P5 from posted data; no "Shift" filter until shifts are defined |
