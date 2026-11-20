> Exported 19 Nov 2026 from the business requirements spec (Claude Doc). Screenshots are not included. Where this conflicts with docs/BRD.md decision log (19 Nov 2026) or docs/BUSINESS_RULES.md, those win (e.g. DO/permit now have NO expiry; DC is issued at gate-in).

# Sales Module – Requirements Specification

Nov 18, 2026 · @Furqan

## 1. Overview

The Sales module replaces today's mix of legacy Oracle Forms screens and manual steps for Dewan Cement Limited with one web system covering the full cycle: SRF → OC → payment verification → DO, or a direct permit, → dispatch → invoice and ledgers.

| Item | Decision |
| --- | --- |
| Company | Dewan Cement Limited only (a Yousuf Dewan Companies entity, Pakistan) |
| Plants | Karachi (.1) and Hattar, KP (.2); rates may differ by plant |
| Branches | Karachi (head office) and Islamabad unit (Hattar plant); each branch has its own customers, products, prices and users (section 15) |
| Stack | Next.js frontend + FastAPI backend on Oracle |
| Database | Existing Oracle SD\_ schema is the starting point; ERD to follow this document |
| Current state | Legacy Oracle Forms + manual work (e.g. cancellation by hand, bank verification by phone) |

**Phasing**

1. Phase 1: Masters (products, DO types, geography, customers, price codes, banks)
2. Phase 2: Order cycle (SRF, OC, BRV, OC confirmation, Permit, DO, cancellation)
3. Phase 3: Dispatch (DC), invoice, DO-based and DC-based ledgers
4. Phase 4: Reports (the 13 reports in section 10.2, with email and WhatsApp sharing)
5. Later: FBR Digital Invoicing, sales return / credit note

## 2. Master data

Every transaction depends on six masters: products, DO types, quantity types, customer codes, geography and price codes.

### 2.1 Products and DO types

The DO type combines the product with the location: Karachi Commercial or Outstation. Institutions use the DO type of their location. DOs are not issued for DBC and AHAN, so they need no DO type.

| Product | Name | Karachi DO type | Outstation DO type |
| --- | --- | --- | --- |
| OPC | Ordinary Portland Cement | OK | OS |
| SRC | Sulphate Resistant Cement | SK | SS |
| LPC | Lion Portland Cement | — | LS |
| BPC | Burraq Portland Cement | — | BS |
| PPC | Premium Portland Cement | — | PS |
| DPC | Black Diamond Portland Cement | — | DS |
| DBC | Dewan Block Cement | No DO issued | No DO issued |
| AHAN | Ahan | No DO issued | No DO issued |

Reference rate: OPC 24,690 per ton (tax-inclusive list rate, not MRP). SRC is usually about 400 per ton above other types.

### 2.2 Quantity types and delivery

- Quantity types: **Bags** (50 kg; 20 bags = 1 ton) and **Bulker**. Rates differ between the two.
- Mode of delivery: Truck only.
- Karachi prices are ex-factory and the customer arranges transport. The Islamabad unit quotes delivered booking prices that include area freight (section 15.8). Freight and TR No fields are kept (optional) for the rare case the company arranges it.

### 2.3 Customer code prefixes

Legacy Karachi codes start with the prefixes below. In the new system the customer code is generated from zone, territory, city/area and channel codes for both branches (section 15.2).

| Prefix | Customer category | Example |
| --- | --- | --- |
| 199 | Karachi | 199-319 Sky Enterprises |
| 499 | Outstation | 499-343 Aslam Bros |
| 699 | Balochistan | 699-68 (dispatch report, zone BCH) |
| 8xx | Institution dealer | — |
| 9xx | Direct / Institution | 912-355, 919-128 |

### 2.4 Geography

Geography is a three-level hierarchy, used for permits, pricing and reports: **Zone → Territory → Area/City**. Example from a permit: Zone 22 SINDH → Territory 103 Upper Sindh → Area 519 Nawabshah. Prices vary by region (e.g. Lower Sindh, Upper Sindh).

Report zones seen today: BCH (Balochistan), INST (Institution), KHI (Karachi), SINDH.

### 2.5 Plants

| Plant | Suffix in document numbers | Example |
| --- | --- | --- |
| Karachi | .1 | Permit 2027746.1 |
| Islamabad unit (Hattar plant, KP) | .2 | — |

Rates, stock and dispatch are tracked per plant. Each branch keeps its own zones, customers, products and pricing (section 15), so every master carries the branch.

### 2.6 Price code

A price code holds the agreed rate for one customer, product and region. Pricing is customer-specific.

- Structure: **Customer short name + Product + Suffix**
  - Outstation DO type: suffix = region (e.g. TCPOPTHR)
  - Karachi (local): suffix = sequence (e.g. SKYOP2, ALMOPC17)
- Each price code must store: plant, quantity type (bag/bulker), tax-inclusive customer rate, retail price, effective date.
- The retail price is needed because sales tax is calculated on retail price, not on the customer rate (section 9).
- Retail price can be lower than the government MRP but never higher.

## 3. End-to-end process flow

There are two routes to dispatch. A **DO** goes SRF → OC → BRV and bank verification → OC confirmation → DO. A **permit** skips SRF and OC: it is raised directly, checked against the customer's ledger balance, and higher quantities need CFO approval. After dispatch, the invoice is made and the ledger is updated at the same time.

&#91;embedded content: Sales order flow · SRF to ledgers, 2 decisions\]

On the DO route, if the verified balance does not cover the OC, sales collects the shortfall (then the balance is checked again) or cancels the order. Earlier descriptions (DO → OC → SRF) are retired.

## 4. Customer registration

A customer must be registered and approved before any SRF can be raised against them. Only authorised users in the sales team can approve a customer.

&#91;image: Current customer information screen (SD\_CUSTINFO)\]

### 4.1 Information tab

| Field | Requirement |
| --- | --- |
| Group, Registered name | Group the customer belongs to; legal name |
| Customer code | Prefix by category (section 2.3) + sequence |
| Zone code, Channel code | Geography and sales channel |
| Group code, Master code | Parent / master customer for grouped accounts |
| Address, Phone, Mobile, Fax, E-mail | Contact details |
| Area docs (grid) | Areas/cities the customer is allowed to book for |
| Cross reference | Link to an equivalent code in another system |
| Flags | Closed, Misc. customer, Tax deduction, Transporter (Y/N) |
| Credit limit | Set per customer (see section 6) |

Customer types to support: dealer, distributor, direct/retail, institution, government.

### 4.2 Sales tax tab

&#91;image: Current sales tax tab\]

| Group | Fields |
| --- | --- |
| Sales tax | Type (Registered / Un-registered / Exempt / Consumer), Status (Active / In-active), STRN |
| Income tax | Type (Registered / Un-registered / Exempt / Consumer), Status (Filer / Non-filer), NTN, CNIC, Jurisdiction, Register no. |

These values drive tax on the invoice: withholding rate depends on filer status, and further tax may apply to unregistered buyers.

### 4.3 Security tab

The Security tab records the security deposits a customer has placed with the company.

&#91;image: Customer Security tab (Karachi)\]

| Field | Requirement |
| --- | --- |
| Description | What the deposit is for (free text) |
| Amount | Deposit amount |
| Total Security Deposit | Sum of all lines; shown in report R7 column S.D |

Design: SD\_CUSTOMER\_SECURITY (customer\_id, line\_no, description, amount), one row per deposit line.

## 5. Sales Request Form (SRF)

The SRF is the first document of every order. The sales/marketing team creates it to record what the customer wants: product, quantity, schedule and terms.

&#91;image: Current SRF screen (SD\_SALESREQ)\]

| Field | Requirement |
| --- | --- |
| SRF #, SRF date, Zone | Auto number; date; customer's zone |
| Product, Bag | Cement type and bag type |
| Customer | Must be an approved, active customer |
| P.I. No., Form-E, L.C No. | Export references (only when Local/Export = Export) |
| Quantity | Tonnes and Bags (20 bags = 1 ton), converted both ways |
| Mode of delivery | Bags / Bulker |
| Mode of transport | Code (e.g. 003); Truck |
| Local / Export | Local or Export |
| Term of sale | Advance (default) |
| Bag colour | Selection |
| Special instructions | Free text (e.g. P.P. bag, Registered) |
| Schedule grid | Sr No, schedule date, quantity; total must equal SRF quantity |
| S.Tax type, S.Tax Reg #, CNIC, NTN | Defaulted from customer master, editable |
| D/O to be handed over to | Person who collects the DO |

Actions on the SRF: Print Contract Review Form (section 5.1) and Order Confirm, which creates the OC from the SRF.

### 5.1 Contract Review Form (a print of the SRF)

The Contract Review Form is **not a separate screen or table**. It is a printed contract generated from the SRF (document DCL/MKT/FM/003), mainly for institution and direct customers.

&#91;image: Contract Review Form, page top\]

&#91;image: Contract Review Form, clauses and signatures\]

| Print section | Source |
| --- | --- |
| Document control: Doc #, issue date, revision #, revision date, page | Print setting per branch (DCL/MKT/FM/003, issued 10-04-2018) |
| SRF #, SRF date | SD\_SRF |
| Parties: "Dewan Cement Limited and {customer code} {name}" | SD\_SRF + SD\_CUSTOMER |
| Effective from / till | SRF date to SRF date + 3 months (e.g. 22-OCT-26 to 22-JAN-27); validity months is a setting |
| Customer detail: name, contact no, email, postal address | SD\_CUSTOMER |
| Quantity, delivery mode, product specification | SD\_SRF (qty in tons, mode of transport, product name) |
| Delivery time, payment method, contract validity, packing, escalation | Standard clause texts, stored per branch and editable by admin; validity date filled in |
| Legal requirements, remarks/comments | Optional free text on the SRF |
| Prepared by | User who created the SRF |
| Approved by | Approver of the SRF (blank until approved) |

Design: no SD\_CONTRACT\_REVIEW table. The SRF gets contract\_valid\_to, legal\_requirements and cr\_remarks; clause texts live in a new SD\_PRINT\_TEXT table (branch, document, section, text, order). The print can be emailed or shared like any report (section 10.4).

## 6. Order Confirmation (OC) and payment (BRV)

An OC is confirmed only when the customer's available balance is greater than or equal to the OC value, and that balance has been verified with the bank.

### 6.1 Order Confirmation

&#91;image: Current OC screen (SD\_OCCONFIRM)\]

The sales/marketing team creates the OC from the SRF. Sales and Finance then review it.

| Area | Fields / rules |
| --- | --- |
| Header | Order #, SRF #, date, quantity (M.Ton), product, customer, special instructions, name of person |
| Pricing | Order date, price code, retail price, trade discount, trade dis. price, add sales tax, add CED/FED, consumer price, less expenses, less discount, net price, total net value |
| Payment link | Document type (BRV), grid of BRV #, date, amount, description; total |
| Balance | Get Balance button; DO balance; today's collection by cash / by cheque |
| Schedule | Schedule Wizard: Sr no, schedule date, quantity, total quantity |
| Status | Approved / Not approved, Cancelled, Tax applicable |
| Actions | Approve OC, Cancel OC, DO generation, Duplicate OC, Print |

### 6.2 Customer balance

Customers normally pay in advance. A customer can also keep a credit balance on account and order against it later. Both cases work the same way: the order draws on the customer's available balance. Both branches also grant credit limits by credit type (section 15.5), so unused approved credit counts toward the balance.

- Available balance = verified receipts − value of confirmed open OCs/DOs/permits − invoiced value + cancellations returned + unused approved credit (current limit − availed).
- **Rule:** an OC can be confirmed only if available balance ≥ OC value. The check happens at OC confirmation, not at DO creation.
- Each customer also has a credit limit on the master. Permits use the same ledger balance but do not go through an OC (section 7).

### 6.3 Bank Receipt Voucher (BRV)

&#91;image: Current BRV screen (SD\_BRV\_NEW)\]

Sales and Finance record each customer payment as a BRV.

| Field | Requirement |
| --- | --- |
| BRV no, date, Advance flag | Auto number; advance receipt when not tied to an invoice |
| Customer code, registered name, account # | Paying customer |
| Instrument | Cash / Cheque / Online transfer (IBFT, RAAST, Easypaisa seen in ledger) |
| Cheque detail, Chq #, Bank code, Deposit bank code | Instrument details |
| Cheque date, Clearing date, Cheque status | Pending / Cleared / Bounced |
| Location, Amount, Sales tax, Tax, Freight | Freight optional (rare) |
| Fund account, Transporter, Remarks | Posting account; optional transporter |
| Invoice detail grid | Invoice #, date, DC no, qty, invoice amount (knock-off) |
| Cancel detail | Send cancel request, cancel status, cancel amount |
| Supervised by | Verifying user |

**Bank verification:** today Finance confirms each receipt with the bank by phone. The system must record who verified, when, and how. Only a verified BRV counts toward available balance.

### 6.4 OC approval sequence

1. Marketing/sales creates SRF and OC.
2. Sales/Finance reviews the OC: approve, reject or edit.
3. Sales/Finance creates the BRV for the customer's payment.
4. Finance verifies the BRV with the bank.
5. System checks available balance ≥ OC value.
6. OC is confirmed and DOs are generated from its schedule.

### 6.5 Price increase after OC

Rates can change after an OC is placed. If the new rate raises the order value above the customer's balance:

- **OC and DO:** the system recalculates the open order at the new rate, shows the shortfall, and holds it (ON\_HOLD) until the sales team collects the difference or cancels the DO.
- A DO issued within its 14-day rate lock keeps its rate (section 11).
- **Permit:** re-pricing is handled manually by the user. The system does not re-price permits.

## 7. Permit (City Wise Permit)

A permit is made directly, without an SRF or OC. It is a quantity allocation for one customer and product, split by area/city and valid for a period. It is accepted only if the customer's ledger balance covers its value; a higher permit quantity needs approval from a higher authority such as the CFO.

&#91;image: Current City Wise Permit screen (SD\_PERMIT\_CITY)\]

| Area | Fields / rules |
| --- | --- |
| Header | Permit no (`sequence.plant`, e.g. 2027746.1 = Karachi), permit date, customer code, product, qty |
| Validity | Valid from, Valid to; system validity 14 days (section 11) |
| Approval | Ledger balance check on save; Approved flag; the user sends high-quantity permits to the CFO (manual decision, no system threshold) |
| Balances | DO balance, credit limit, total amount |
| City detail grid | Area code, area name, qty, city rate, net amount, dispatch qty, balance qty; totals |
| Booking adjustment grid | Sr no, qty, amount (via Adjust Qty) |
| Actions | Print, Adjust Qty |

**Rules**

- City rate comes from the price code for that customer, product and region.
- Dispatch qty per area cannot exceed the area's permit qty. Balance qty = qty − dispatch qty.
- Adjust Qty and Booking Adjustment are manual edits by the user. The system only records who changed what, when and why in the audit log.
- A permit can be cancelled at any time; its remaining value returns to the customer's balance.

### 7.1 Permit print

&#91;image: Printed permit: Zone, Territory, Area breakdown\]

The print shows permit no, date, valid to, customer, product, permit quantity and a grid of Zone → Territory → Area/City with quantity. The terms and conditions keep the 48-hour wording as per policy (section 11).

## 8. Delivery Order (DO)

The DO is the result of a confirmed OC. One OC can generate several DOs, one per schedule line, and each DO authorises the customer to lift cement from the plant.

&#91;image: Current DO print (customer copy)\]

| Field | Requirement |
| --- | --- |
| Delivery order # | Auto number per plant (e.g. 22702000001) |
| Customer code, name, address | From customer master |
| Price code, region | e.g. TCPOPTHR, Lower Sindh |
| Quantity type, Quantity, M.Tonnes | Bags 700 = 35.00 MT |
| Product code, DO type | e.g. OPC, OS (section 2.1) |
| Date of issue, Mode of delivery | Issue date; Truck |
| Special instructions | e.g. P.P. bag, Registered/Unregistered |
| Barcodes | DO number barcode for gate scanning |
| Prepared by | User who issued the DO |
| Terms and conditions | Printed text, 48-hour wording kept as per policy |

**Rules**

- Retail price on the DO can be lower than the government MRP but never above it.
- Rate is locked for 14 days from issue (system rule).
- Partial dispatch against a DO is allowed; over-dispatch is not.
- A DO can be cancelled at any time before full dispatch; the undispatched value returns to the customer's balance.

### 8.1 Cancellation today

&#91;image: A DO cancelled by hand\]

Today a DO is cancelled by writing "Cancelled" across the printed copy. The new system must cancel through a status change with reason, user and date, reverse the balance automatically, and print a CANCELLED watermark on any reprint.

## 9. Dispatch and invoice

Each lifting against a DO or permit creates a Delivery Challan (DC). One DC can carry several DOs, and **each DO on the DC gets its own invoice**. Saving the DC creates those invoices and updates the customer ledger in the same step, so both always match the dispatched quantity. Sales tax is calculated on the retail price, not on the customer rate.

### 9.1 Dispatch (DC)

One Delivery Challan (DC) can lift against **several DOs** for the same customer in one vehicle. The sample DC below covers 4 DOs, 38.5 MT (770 bags).

&#91;image: Current Delivery Challan print\]

| Area | Fields |
| --- | --- |
| Header | DC No (175002), Document No = BRV No (591930), date, page, plant address |
| Customer | M/S name and address, destination code and city (95 Larkana) |
| Transport | Vehicle No, Bilty No (transporter's consignment note) |
| Product | DC type (= DO type, e.g. LS), brand description (Lion Brand Sind), packing type (Bags / Bulker) |
| Bags | Bag supplier and bag brand (e.g. Paper Bags Pakland, Lion Blue) |
| Export | Container No, Seal No (blank for local) |
| DO lines | S#, DO #, M/Ton, Bags; totals |
| Other | Remarks, barcode, supervisor signature, DC stamp |

**Rules**

- A DC has a header and lines; each line points to one DO (or a permit area) with its tons and bags.
- One invoice is made per DC line, i.e. one invoice per DO. A DC with 4 DOs produces 4 invoices.
- All DOs on one DC must belong to the same customer, DC type and destination.
- Line qty cannot exceed that DO's undispatched balance; partial lifting of a DO is allowed.
- 20 bags = 1 ton is checked on every line.
- Dispatch % against each DO/permit is tracked for reports.
- DC numbers are per plant. TR No and freight stay optional.

### 9.2 Invoice

&#91;image: Current invoice, top half\]

&#91;image: Current invoice, computation\]

Title: Commercial / Excise / Sales Tax Invoice. Header carries company STRN and NTN, buyer name, code, address, NTN, STRN, CNIC, destination code and name, invoice no and date, DC no, vehicle no, TR no and product name.

### 9.3 Tax computation (worked example from invoice 8445)

Prices are tax-inclusive. The invoice works backwards from the inclusive rate.

**Part A: taxes on retail price**

| Line | Amount (PKR) |
| --- | --- |
| Tax exclusive value | 757,898.31 |
| Federal excise duty | 140,000.00 |
| Retail price (code SKYOP2) | 897,898.31 |
| Sales tax @ 18% on retail price | 161,621.60 |
| Tax inclusive value (market price) | 1,059,519.91 |

**Part B: customer invoice**

| Line | Amount (PKR) |
| --- | --- |
| Qty in tons | 35.00 |
| Rate per ton (excl. FED and ST) | 15,682.24 |
| Value exclusive | 548,878.40 |
| Federal excise duty (4,000/ton) | 140,000.00 |
| Sales tax @ 18% on retail price | 161,621.60 |
| Sale proceeds (incl. FED and ST) | 850,500.00 |
| Withholding tax 0.1% | 850.50 |
| **Total collectable** | **851,350.50** |

Formulas:

- Sales tax = 18% × retail price (Part A), not 18% × customer value.
- Value exclusive = sale proceeds − FED − sales tax.
- Withholding tax = rate × sale proceeds; rate depends on filer/non-filer status.
- **Retention** = net value ÷ quantity (net realisation per ton). It is a reporting figure, not a deduction.

Incentive slabs are kept in the system (section 15.12). Incentives and subsidies reach the customer as credit notes (section 15.7), which post to the customer ledger.

### 9.4 Later phase

- FBR Digital Invoicing submission.
- Sales return and credit note.

## 10. Ledgers and reports

Two customer ledgers are needed: a DO-based ledger (balance against orders issued) and a DC-based ledger (balance against goods dispatched).

### 10.1 Customer ledgers

&#91;image: Current Customer Ledger (DO based), report CLDOB\]

| Ledger | Debit | Credit |
| --- | --- | --- |
| DO-based | DO / permit value issued | Receipts (BRV), cancellations returned |
| DC-based | Invoice value of goods dispatched | Receipts (BRV), returns |

Columns: Srl #, doc date, doc no, narration (e.g. BRV no + instrument + bank), debit, credit, running amount; opening and closing balance per customer; date range filter.

**Resolved 19 Oct:** the running amount = previous + debit − credit. A positive amount is a debit balance (receivable); a negative amount is an advance, shown in brackets (reports R1 and R7).

### 10.2 Reports for phase 1

The business has confirmed **12 reports** as the required set (report pack "All Reports", 117 pages, run on 19 Oct 2026), plus the DC-based ledger (R13) added on 21 Oct. Every report can also be emailed or shared on WhatsApp (section 10.4). Each report below shows its first page, its filters and layout, where every column comes from, and what the design needs to support it. All reports run per branch, and can be merged across branches where marked "Merge".

| # | Report | ID | Run for | Grouped by |
| --- | --- | --- | --- | --- |
| R1 | Customer Ledger (DO Based) | CLDOB | Date range, customer | Customer |
| R2 | Sales Tax Summary (MRP Base) | — | Date range | Product type → product |
| R3 | Product wise Invoice Summary | — | Date range | Product type → product |
| R4 | BRV Bank Wise | — | Date range | Receipt type → date × bank |
| R5 | Credit Note | — | Date range | Date |
| R6 | Accumulated Debtors Summary | — | Date range | GL account line |
| R7 | List of Advances & Receivables | — | As-on date | Customer group |
| R8 | Bank Receipts | — | Date range, customer range | Date |
| R9 | Customer Wise Sales Summary (Dispatches) | CWSS | Date range, customer range | Customer → product |
| R10 | Outstanding D.O | — | As-on date | Customer → DO |
| R11 | Permit Vs Dispatch | — | Date range | Customer → permit → dispatch |
| R12 | Sales Analysis (daily MIS) | — | Date range, branch or merge | Seven blocks |
| R13 | Customer Ledger (DC Based) | CLDCB | Date range, customer | Customer |

### R1 Customer Ledger (DO Based) — CLDOB

&#91;image: R1 Customer Ledger (DO Based)\]

| Column | Source / rule |
| --- | --- |
| Opening balance as on from-date | Sum of SD\_CUSTOMER\_LEDGER (ledger\_type DO) before the from-date |
| Srl #, Doc Date, Doc No | Ledger line; Doc No = BRV / DO / permit / credit note number |
| Narration | Built from the source: "BRV # … Cheque # …" from SD\_BRV instrument reference |
| Debit, Credit | DO / permit value = debit; receipts and credit notes = credit |
| Amount (running) | Previous amount + debit − credit |
| Closing balance | Total debit, total credit, last amount |

This report settles the sign convention: the running amount is a **debit balance**; receipts are credits and reduce it. In R7 the same balance shows as Receivable when positive and as Advance (in brackets) when negative.

### R2 Sales Tax Summary (MRP Base)

&#91;image: R2 Sales Tax Summary (MRP Base)\]

| Column | Source / rule |
| --- | --- |
| Product type | BULK or LOCAL (new pack type on the product) |
| Product code | OPCB, SRCB (bulk); DPC, PPC, SRC, OPC, AHAN, DBC, BPC, LPC (local) |
| Qty | Invoiced tons |
| Value Ex-F.E.D | Retail (MRP-based) value excluding FED and sales tax |
| F.E.D | 4,000 per ton × qty |
| Value Inc F.E.D | Value Ex-F.E.D + F.E.D |
| Sales Tax Amt | 18% of Value Inc F.E.D |
| Total | Value Inc F.E.D + Sales Tax |
| M.R.P | Product MRP per ton (30,272 local; 23,703 OPCB; 24,900 SRCB) |
| Per-ton summary | F.E.D ÷ qty and Sales Tax ÷ qty per product |

Source: SD\_INVOICE (retail\_price, fed\_amt, st\_amt), SD\_PRODUCT, SD\_PRODUCT\_PERIOD.

### R3 Product wise Invoice Summary

&#91;image: R3 Product wise Invoice Summary\]

Same layout as R2, but values are what the customer is invoiced: Value Ex-F.E.D = customer value excluding taxes; F.E.D and Sales Tax are the same as R2; Total = sale proceeds. Example OPC: 409,348,949 + 104,902,200 + 121,103,296 = 635,354,445. The grand total (1,257,440,892) must equal R6 "Sale during the period" and R9 total.

### R4 BRV Bank Wise

&#91;image: R4 BRV Bank Wise\]

| Part | Layout / source |
| --- | --- |
| Block 1 | Rows: receipt type (Online, Under clearance) → deposit date; columns: one per bank short code (ABL, BAF, BIPL, MBL, NBP, SONB, UBL) + total |
| Block 2 | Rows: bank; columns: Online, Under clearance, Total |
| Source | SD\_BRV (amount, deposit bank, cheque status), SD\_BANK.short\_code |

Under clearance = cheque not yet cleared; Online = transfers, cash deposits and cleared cheques.

### R5 Credit Note

&#91;image: R5 Credit Note\]

| Column | Source / rule |
| --- | --- |
| Date, Advice No | SD\_CREDIT\_NOTE note\_date, advice\_no (e.g. 22700071) |
| Customer code, name | SD\_CUSTOMER |
| Particular | Free text, e.g. "Incentive on collection 1–4 Oct qty 2,166.11 @ 700", "Bal trf Ghulam Husain (699-70) to M. Awais (699-68)", "Cr due to rate increase (6 Oct) adj qty 81.7 @ 24,090" |
| Amount | Credit amount |
| Day total, total | Sum by date and overall |

Three uses appear: incentive, **balance transfer between customers** (credit one, debit the other) and rate-increase credit. So a note needs a debit/credit side and an optional transfer customer.

### R6 Accumulated Debtors Summary

&#91;image: R6 Accumulated Debtors Summary\]

| Line | GL account | Source |
| --- | --- | --- |
| Opening balance | — | Ledger balance before from-date |
| Sale – cement local | 6101010000 | Invoices, local |
| Sale – cement export | 6102010000 | Invoices, export |
| Sale – clinker | 6101010001 | Invoices, clinker |
| Debit adjustment | 2301011801 | Debit notes |
| Cheque return | 2901120000 | Bounced BRVs |
| 0.1% withholding tax | 2407060014 | Invoice WHT |
| Cash collection | 2901110000 | BRV, cash |
| Cheque collection | 2901120000 | BRV, cheque / online |
| Incentive | 6401010000 | Credit notes, incentive |
| Freight subsidies | 6501010001 | Credit notes, freight subsidy |
| Tax credit allowed | 2407060004 | Tax withheld by customers |
| Credit adjustment (sales tax withheld) | 2301011801 | Tax withheld |
| Credit adjustment | 2301011801 | Other credit notes |
| Closing balance | — | Opening + debits − credits |

Check from the sample: −1,323,636,775 + 1,257,440,892 + 16,224,706 + 800,000 − 66,000 − 823,638,340 − 19,112,326 = **−891,987,843**. A new table SD\_GL\_ACCOUNT\_MAP holds the account code per transaction type.

### R7 List of Advances & Receivables

&#91;image: R7 List of Advances & Receivables\]

| Column | Source / rule |
| --- | --- |
| Groups | Dealer, Direct/Inst, Dealer Institution, Distributor (from the channel's report group) |
| Code, customer name | SD\_CUSTOMER |
| Receivable | Ledger balance as on date when positive |
| Advance | Ledger balance when negative, shown in brackets |
| S.D | Security deposit (customer credit type E) |
| Net | Receivable + advance + S.D |
| Footer | Group totals; overall; Distributor; non-movement balance local and export; Net receivable / (payable) |

Sorted by largest advance first within each group, receivables after.

### R8 Bank Receipts

&#91;image: R8 Bank Receipts\]

| Column | Source / rule |
| --- | --- |
| Date, Receipt No | SD\_BRV brv\_date, brv\_no (e.g. 2026100764) |
| Customer code, name | SD\_CUSTOMER |
| Bank, Account No | SD\_BANK, deposit account |
| Cheque No | Instrument reference text (e.g. "O.L. IBFT- 14/10/26- …") |
| Instrument | Code + name: N Online transfer, E Deposit in company bank A/C, O Online cheque deposit |
| Amount | BRV amount; date total; grand total |

Karachi instrument codes (N, E, O) differ from Islamabad (A–J), so SD\_INSTRUMENT is kept per branch.

### R9 Customer Wise Sales Summary (Dispatches) — CWSS

&#91;image: R9 Customer Wise Sales Summary\]

| Column | Source / rule |
| --- | --- |
| Customer code, name | SD\_CUSTOMER |
| Product | Product of each invoice line |
| Quantity M.Ton | Sum of invoiced tons |
| Amount | Sum of invoice totals (sale proceeds) |
| Avg. price per ton | Amount ÷ quantity |
| Sub total, total | Per customer and overall |

### R10 Outstanding D.O

&#91;image: R10 Outstanding D.O\]

| Column | Source / rule |
| --- | --- |
| Customer code, name | SD\_CUSTOMER |
| D.O #, D.O date | SD\_DO do\_no, issue\_date |
| Qty | qty\_ton − dispatched\_ton (open DOs only) |
| Value | Open qty × DO rate |
| Total | Sum (sample: 15,020.50 tons, 360,607,650) |

### R11 Permit Vs Dispatch

&#91;image: R11 Permit Vs Dispatch\]

| Side | Columns and source |
| --- | --- |
| Booking | Customer, Permit # (e.g. 2027471.1), date, product, city, qty, rate, amount — SD\_PERMIT, SD\_PERMIT\_AREA |
| Dispatch | Date, Bilty #, DM # (DC number), qty, dispatch city, rate — SD\_DC, SD\_DC\_LINE |
| Totals | Dispatched qty per permit and per customer; overall booking qty, amount and dispatched qty |

Bilty # is captured on every dispatch, and dispatch is tracked per permit area.

### R12 Sales Analysis (daily MIS, "Merge")

&#91;image: R12 Sales Analysis\]

| Block | Columns | Source |
| --- | --- | --- |
| Booking | Customer group, qty type, qty, value | Permits and DOs issued |
| Collection | Group: Cash, Cheque, Export amount, Cheque return, Overall | SD\_BRV by instrument and status |
| Dispatch | Bulk / Local: qty, value, average, % | Invoices |
| Sales tax, FED & retention | Qty, value, sales tax, FED, subsidy, commission, incentive, avg export expense, net value, retention | Invoices + credit notes + config |
| Receivables | Group: movement Dr, Cr, balance, % | Ledger |
| Advances | Group balances | Ledger |
| Income tax & sales tax withheld | Opening, amount, received, outstanding, closing | New SD\_TAX\_WITHHELD |

Net value = value − sales tax − FED − subsidy − commission − incentive − export expense; **retention = net value ÷ qty** (local: 5,708,471 ÷ 362 = 15,769). Export expense is a setting: USD 7.5 per ton at a rate of 105.2.

### R13 Customer Ledger (DC Based) — CLDCB (added 21 Oct)

Not in the report pack, but requested by the business. Same layout as R1; the difference is what counts as a debit: goods actually dispatched, not orders issued.

| Column | Source / rule |
| --- | --- |
| Opening balance as on from-date | Sum of SD\_CUSTOMER\_LEDGER (ledger\_type DC) before the from-date |
| Srl #, Doc Date, Doc No | Ledger line; Doc No = invoice / BRV / credit note number |
| Narration | "DC # … Invoice # … qty … @ rate" for dispatches; "BRV # … Cheque # …" for receipts |
| Debit | Invoice value of each DC line (one invoice per DO) |
| Credit | Receipts (BRV), credit notes, cheque returns reversed as debit |
| Amount (running) | Previous amount + debit − credit (debit balance positive) |
| Closing balance | Total debit, total credit, last amount |

Filters: branch, date range, customer (one or all). Source: SD\_CUSTOMER\_LEDGER, SD\_DC, SD\_DC\_LINE, SD\_INVOICE, SD\_BRV, SD\_CREDIT\_NOTE.

### 10.3 What the reports add to the design

| Need | Change |
| --- | --- |
| Customer groups (Dealer, Direct/Inst, Dealer Institution, Distributor, Export) | report\_group on SD\_CHANNEL |
| Bulk vs local products (OPCB, SRCB) | pack\_type on SD\_PRODUCT; add OPCB and SRCB to the Karachi list |
| Bank columns | short\_code on SD\_BANK |
| Instrument codes per branch | branch\_id on SD\_INSTRUMENT |
| Balance transfers and debit adjustments | dr\_cr side and transfer customer on SD\_CREDIT\_NOTE |
| GL account per transaction type | New SD\_GL\_ACCOUNT\_MAP |
| Tax withheld by customers | New SD\_TAX\_WITHHELD |
| Export expense per ton and exchange rate | SD\_CONFIG |
| Ledger sign convention | Resolved: debit balance positive (R1, R7) |

The other reports drafted earlier are not in the required set and are dropped from Phase 1. The DC-based ledger is kept as R13 at the business's request.

### 10.4 Sharing reports by email and WhatsApp

Any report or document can be sent straight from the screen where it was run. A typical case: a customer asks for his balance, the user runs R1 or R13 for that customer and presses **Email** or **WhatsApp**. Sharing is partly automated: the system prepares the PDF and the message, and the user confirms the send.

**What can be shared**

| Type | Items |
| --- | --- |
| Customer reports (sent to the customer) | R1 and R13 ledgers (account statement), R8 receipts, R9 sales summary, R10 outstanding DOs, R11 permit vs dispatch — run for one customer |
| Customer documents | Invoice, DO, permit, DC, BRV receipt, credit note |
| Management reports (sent to staff) | R2–R7, R12, and the above when run for all customers |

**Buttons on every report and document screen:** Download PDF · Download Excel · Email · WhatsApp. The buttons work only after the report has been run, and they always send exactly what is on screen (same filters).

**Email (sent by the system)**

1. User presses Email. A dialog opens with To filled from the customer master (email 1, email 2), editable, plus CC and BCC.
2. Subject and body come from an English template, e.g. "Dewan Cement Limited – Account Statement – {customer} – {from} to {to}". The user can edit them.
3. The PDF is attached automatically (file name like `Ledger_499-248_2026-10-01_2026-10-19.pdf`).
4. The email is sent from **the logged-in user's own mail account**, so the customer sees the user's name and replies reach the user. Each user sets up his mail account once in his profile (email address, mail server, password or app password, stored encrypted); the backend sends through it.
5. A copy goes to the user's Sent folder where the mail server allows it. The result (sent / failed) is shown and logged.

**WhatsApp (partly automated, uses the user's own WhatsApp on the laptop)**

1. User presses WhatsApp. The system builds the PDF and an English message from the template (customer name, period, closing balance) with a secure 7-day download link to the PDF.
2. WhatsApp opens on the laptop (desktop app, or web.whatsapp.com if the app is not installed) **directly in that customer's chat**, with the message and report link already typed in.
3. The user checks it and presses **Send**. Nothing is sent without this click.
4. The number comes from the customer's WhatsApp number (or mobile), converted to 92XXXXXXXXXX; the user can change it in a small box before WhatsApp opens.
5. **Share PDF** (second button): where the user wants the PDF itself as a file, the Windows share panel opens with the PDF attached; the user picks WhatsApp and the contact.

Why the report goes as a link in step 2: with a personal WhatsApp account, WhatsApp only lets another program open a chat with a number and fill in text; it does not let it attach a file. Two ways exist to put the PDF itself in the customer's chat, both outside Phase 1:

| Option | How it works | Trade-off |
| --- | --- | --- |
| WhatsApp Business Platform (Cloud API) | The system sends the PDF to the customer's number from a company WhatsApp number when the user presses Send in our screen | Needs a verified Meta business account, approved message templates and a charge per conversation; messages come from the company number, not the user's |
| WhatsApp Web automation (browser extension) | An extension attaches the PDF in the opened chat; the user presses Send | Unofficial: breaks when WhatsApp changes, and can get the number blocked. Not recommended |

**Rules**

| Rule | Detail |
| --- | --- |
| Permission | New "Share" right per screen (beside Insert, Query, Update, Delete, Print) |
| Branch | A user can share only reports of branches he is allowed to open |
| Download links | Random token, expire after 7 days (setting), PDF only, no login needed to open |
| Log | Every email and WhatsApp share is logged: report, filters, recipient, channel, user, time, link expiry, status |
| Customer contacts | Customer master gets email 1, email 2 and WhatsApp number fields, validated on save |
| Templates | One email and one WhatsApp template per report and branch, in English, editable by admin |
| Letterhead | PDFs carry the branch name, report run date/time and "system generated" note, as today |

**Confirmed on 21 Oct**

- Emails go from each user's own mail account.
- Messages and templates are in English.
- WhatsApp download links expire after 7 days.
- Pressing WhatsApp opens the customer's chat with the report ready; the user presses Send.

Later option (not Phase 1): send statements to many customers at once (e.g. all dealers in a zone at month end).

## 11. Business rules and roles

### 11.1 Rules

| # | Rule |
| --- | --- |
| R1 | DO flow: SRF → OC → DO → DC. Permit flow: Permit → DC. After DC, one invoice per DO and the ledger update happen together. |
| R2 | OC is confirmed only after bank-verified BRV and available balance ≥ OC value (DO route). |
| R3 | A permit is raised directly (no SRF/OC) and accepted only if the customer's ledger balance covers it. |
| R4 | Higher permit quantities need CFO (higher authority) approval. The user decides when to send a permit; there is no system threshold. |
| R5 | DO and permit validity in the system: 14 days. Printed terms keep the 48-hour wording (policy). Both values are configurable. |
| R6 | Rate on an issued DO is fixed for 14 days. |
| R7 | If a price increase pushes the order value above balance, sales either collects the difference or cancels the DO. Permits are re-priced manually. Incentives and subsidies are posted as credit notes. |
| R8 | DOs and permits can be cancelled at any time; undispatched value returns to the customer's balance (no bank refund). |
| R9 | Partial dispatch allowed; over-dispatch blocked. |
| R10 | Retail price may be below the government MRP, never above. |
| R11 | All prices are ex-factory and tax-inclusive. Freight is the customer's cost; freight and TR No fields stay optional. |
| R12 | Rates vary by plant, region, product, quantity type and customer (price code). |
| R13 | Document numbers carry the plant suffix (.1 Karachi, .2 Hattar). |
| R14 | Every cancel, approval, rate change and qty adjustment is logged with user, date and reason. |

### 11.2 Roles

| Role | Can do |
| --- | --- |
| Marketing / Sales | Create SRF and OC |
| Sales / Finance | Review, approve, reject OC; create BRV; issue DO; raise permits directly |
| Finance | Verify BRV with bank; confirm OC |
| Authorised sales user | Approve new customers |
| CFO | Approve higher permit quantities |
| Dispatch (plant) | Create DC against DO/permit |

## 12. Open items and next steps

One question remains open. It does not block the ERD; it only fills a dashed slot.

- [x] Resolved 19 Oct from the report pack: debit balance positive (receivable), advance negative (section 10.1)
- [x] Resolved 22 Oct: Contract Review Form is a print of the SRF, not a separate form (section 5.1)
- [x] Resolved 21 Oct: DC No is the delivery challan number; Document No is the BRV number (payment document) behind the dispatch (confirmed 22 Oct). SD\_DC keeps dc\_no and brv\_id
- [x] Gate pass, weighbridge and driver: answered from the Karachi DB. They are captured today in FH\_DC\_DOCUMENT (token, truck, gross/tare weight and time, shift, gate in/out, transporter), so SD\_GATE\_PASS is needed for both branches.
- [ ] 18 Nov: the gate and weighbridge tables in the legacy sales DBs (FH\_DC\_DOCUMENT and the DC/DM tables) stop in 2024, so current dispatch data lives in another database. Which application and DB? (sections 16 and 18.3)

**Decided on 16 Oct 2026 (Islamabad unit screens)**

| Question | Decision |
| --- | --- |
| Customer code | Generated from Zone code → Territory code → City/Area code → Channel code |
| Category Type (Clean, Transitory, Cash deposit, Cheque) | Category of a BRV receipt collection |
| Credit limits | Karachi gets the same credit functionality as Islamabad |
| Targets and monthly incentive | Both kept in the system |
| Credit notes | Recorded in the system and posted to the ledger |
| Number suffix | .1 = Karachi, .2 = Islamabad |
| Geography | One structure for both branches: Zone → Territory → Area/City (Islamabad shape) |

**Decided on 15 Oct 2026**

| Question | Decision |
| --- | --- |
| DO types for DBC and AHAN | Not needed; DOs are not issued for these |
| Re-pricing permits after a price increase | Manual, by the user |
| Incentives and subsidies on the invoice | Superseded 16 Oct: incentive slabs kept in the system; amounts posted as credit notes |
| Invoice per DC or per DO | One invoice per DO (per DC line) |
| CFO threshold for permits | Manual: the user decides when to send for approval |
| Permit Adjust Qty / Booking Adjustment | Manual edits, logged in the audit log |
| Hattar zones, price codes, DO types | Updated 16 Oct: each branch has its own data, products and pricing (section 15) |
| Full report list | Replaced 19 Oct by the 12 reports in the business report pack (section 10.2) |

**Next steps**

1. Business team reviews this document and answers the open items.
2. Review the draft ERD and class diagram (sections 13 and 14) and fill the dashed slots as answers arrive.
3. Status lifecycle per document (Draft → Approved → Confirmed → Closed / Cancelled).
4. FastAPI endpoints and Next.js screens for Phase 1.

## 13. Data model (as built)

The unified database is 01\_DCL\_SALES\_TABLES.sql: 174 tables in 13 modules, with the legacy Karachi table and column names and BRNCH (1 Karachi, 2 Islamabad) on every table. Script 03 adds 85 foreign keys and 63 unique keys on top of the primary keys in 01; every key starts with BRNCH. The October SD\_ design is kept as Appendix A for reference only.

&#91;embedded content: Data model as built · core tables and their links\]

Solid arrows are foreign keys from script 03; dashed arrows are links held only by a column (13.3). The other 160 tables and their keys are listed in section 14.

### 13.1 Modules

| Module | Tables | Core tables |
| --- | --- | --- |
| System and setup | 16 | COMPANY, SALES\_YEAR, DOC\_SEQUENCE, PRINT\_TEXT, GL\_MAP |
| Users and audit | 11 | SEC\_USERNAME, SEC\_MODULE\_S, SEC\_USERPERM, U\_AUDIT |
| Geography | 11 | ZONE\_DESC → TERRITORY → AREA; Karachi MASTER\_AREA → DISTRICT → CITY |
| Products and tax | 12 | GROUP\_MST → PRODUCT\_TYPE, PRODUCT\_DESC\_T, DELIVERY\_ORDER\_TYPE, BAG |
| Pricing and discounts | 18 | TRADE\_PRICE (DO clients), AREA\_RATES\_M → \_P → \_D (permit clients) |
| Customers | 14 | CUSTOMER\_INFO, CUSTOMER\_AREA, CHANNEL\_DESC, BLOCK\_CUSTOMER |
| Credit and security | 13 | CREDIT\_LIMITS, CUSTOMER\_CREDIT\_APP, CSECURITY\_DEPOSIT |
| Banks and receipts (BRV) | 12 | CASH\_CHEQUE\_RECEIPTS, ORDER\_CONFIRM\_BRV, BANK\_DESC, INSTRUMENT\_TYPE |
| Orders: SRF and OC | 9 | SALES\_REQUEST\_MASTER/DETAIL, ORDER\_CONFIRM/DETAIL |
| DO and permit | 10 | DELIVERY\_ORDER, PERMIT\_MST\_CITY → PERMIT\_DTL\_CITY → PERMIT\_ADJ\_CITY |
| Dispatch: DC and DM | 15 | FH\_DELIVERY\_CHALLAN → FH\_DEL\_CHALLAN\_DETAIL, FH\_DELIVERY\_MEMO, FH\_DC\_DOCUMENT |
| Ledger, notes, tax and accounts | 16 | OPENING\_BALANCES, CREDIT\_NOTE/DETAIL, TAX/DETAIL, VOCH\_POST |
| Targets, incentives and retail | 17 | TARGET\_MST → TARGET\_CUST, INCENTIVE, TARGET\_PERC\_MST/DTL |

### 13.2 Document chain

| Step | Header table | Lines table | Key (after BRNCH) | Foreign keys to |
| --- | --- | --- | --- | --- |
| SRF | SALES\_REQUEST\_MASTER | SALES\_REQUEST\_DETAIL | SRF\_NO | CUSTOMER\_INFO, BAG, BAGS\_COLOR |
| OC | ORDER\_CONFIRM | ORDER\_CONFIRM\_DETAIL | ORDER\_NO | SALES\_REQUEST\_MASTER, CUSTOMER\_INFO, TRADE\_PRICE |
| BRV | CASH\_CHEQUE\_RECEIPTS | ORDER\_CONFIRM\_BRV (BRV ↔ OC) | RECEIPT\_NO, CASH\_CHEQ\_CD | CUSTOMER\_INFO, BANK\_DESC, COMPANY\_BANK, INSTRUMENT\_TYPE, CATEGORY\_TYPE |
| DO | DELIVERY\_ORDER | – | DO\_TYPE, DEL\_ORDER\_NO | ORDER\_CONFIRM, DELIVERY\_ORDER\_TYPE, CUSTOMER\_INFO |
| Permit | PERMIT\_MST\_CITY | PERMIT\_DTL\_CITY (areas), PERMIT\_ADJ\_CITY | PERMIT\_NO | CUSTOMER\_INFO |
| Gate and weighbridge | FH\_DC\_DOCUMENT | – | COMP\_NO | – |
| DC (DO route) | FH\_DELIVERY\_CHALLAN | FH\_DEL\_CHALLAN\_DETAIL | DC\_TYPE, DC\_NO | CUSTOMER\_INFO, BAG |
| DM (permit route) | FH\_DELIVERY\_MEMO | – | DM\_NO | BAG |
| Credit / debit note | CREDIT\_NOTE | CREDIT\_NOTE\_DETAIL | SRL\_NO, DB\_CR\_CD, NOTE\_TYPE | CUSTOMER\_INFO |
| Order cancel | ORDER\_CANCEL\_MASTER | ORDER\_CANCEL\_DETAIL | OC\_ADVISE\_NO | CUSTOMER\_INFO |
| BRV cancel | RECEIPT\_CANCEL\_MASTER | RECEIPT\_CANCEL\_DETAIL | CANCEL\_NO | CUSTOMER\_INFO |

### 13.3 Links held by columns, not by keys

These links exist as columns but have no foreign key, because legacy rows break them (for example, DCs that point to DOs outside the loaded data). The application must check them on every new entry.

| From | Column(s) | To |
| --- | --- | --- |
| FH\_DEL\_CHALLAN\_DETAIL | DO\_NO, OC\_NO | DELIVERY\_ORDER, ORDER\_CONFIRM |
| FH\_DELIVERY\_MEMO | PERMIT\_NO, LNKNO | PERMIT\_MST\_CITY, PERMIT\_DTL\_CITY |
| ORDER\_CONFIRM\_BRV | RECEIPT\_NO, CASH\_CHEQ\_CD | CASH\_CHEQUE\_RECEIPTS |
| FH\_DELIVERY\_CHALLAN, FH\_DELIVERY\_MEMO | COMP\_NO, TOKEN\_NO | FH\_DC\_DOCUMENT (gate and weighbridge) |
| FH\_DELIVERY\_CHALLAN, FH\_DELIVERY\_MEMO | TRANSP\_CODE | TRANSPORTER\_DESC |
| All documents | PRODUCT\_CODE, AREA\_CODE | PRODUCT\_DESC\_T, AREA |

**No separate invoice or ledger table.** The invoice is stored on the DC and DM rows (INVOICE\_NO, INVOICE\_DATE and the price columns). The customer ledger is built from OPENING\_BALANCES plus BRVs, DOs, permits, DCs, DMs, credit notes and cancellations, as the reports in section 10 do today.

### 13.4 New-system tables

Seven tables have no legacy source and start empty: DOC\_SEQUENCE (numbering with the .1 / .2 suffix), LEGACY\_MAP (old code → new code), PRINT\_TEXT (print clauses), MSG\_TEMPLATE, USER\_MAIL\_ACCOUNT and SHARE\_LOG (report sharing, section 10.4) and GL\_MAP (finance posting).

### 13.5 October SD\_ design → built tables

| October design (Appendix A) | Built table(s) |
| --- | --- |
| SD\_PLANT / SD\_BRANCH | COMPANY, UNIT\_MST + BRNCH on every table |
| SD\_ZONE, SD\_TERRITORY, SD\_AREA | ZONE\_DESC, TERRITORY, AREA |
| SD\_PRICE\_REGION | REGION, REGION\_DETAIL |
| SD\_CHANNEL / SD\_CUSTOMER\_CATEGORY | CHANNEL\_DESC |
| SD\_CUSTOMER, SD\_CUSTOMER\_TAX | CUSTOMER\_INFO (tax columns on the same row) |
| SD\_CUSTOMER\_AREA | CUSTOMER\_AREA |
| SD\_CUSTOMER\_SECURITY | SECURITY\_DEPOSIT, CSECURITY\_DEPOSIT |
| SD\_PRODUCT, SD\_PRODUCT\_PERIOD | PRODUCT\_DESC\_T (per period), PRODUCT\_TYPE, GROUP\_MST |
| SD\_DO\_TYPE | DELIVERY\_ORDER\_TYPE |
| SD\_PRICE\_CODE, SD\_PRICE\_RATE | TRADE\_PRICE (DO clients); AREA\_RATES\_M/P/D (permit clients) |
| SD\_TAX\_RATE | SALES\_TAX, SALES\_TAX\_FED, CED\_SETUP |
| SD\_BANK | BANK\_DESC, COMPANY\_BANK |
| SD\_USER, SD\_MODULE, SD\_USER\_PERMISSION, SD\_USER\_ROLE | SEC\_USERNAME, SEC\_MODULE\_S, SEC\_USERPERM |
| SD\_CONFIG | DAYS\_LOCK, BLOCK\_DO\_DATE, SALES\_YEAR |
| SD\_AUDIT\_LOG | U\_AUDIT, LOG\_CUSTOMER\_INFO |
| SD\_SRF, SD\_SRF\_SCHEDULE | SALES\_REQUEST\_MASTER, SALES\_REQUEST\_DETAIL |
| SD\_OC, SD\_OC\_SCHEDULE | ORDER\_CONFIRM, ORDER\_CONFIRM\_DETAIL |
| SD\_OC\_REPRICE | OC\_PRICE\_DTL, SD\_OCA\_MST/DTL |
| SD\_BRV, SD\_OC\_BRV | CASH\_CHEQUE\_RECEIPTS, ORDER\_CONFIRM\_BRV |
| SD\_DO | DELIVERY\_ORDER, DO\_ADJUSTMENT |
| SD\_PERMIT, SD\_PERMIT\_AREA | PERMIT\_MST\_CITY, PERMIT\_DTL\_CITY |
| SD\_DC, SD\_DC\_LINE | FH\_DELIVERY\_CHALLAN, FH\_DEL\_CHALLAN\_DETAIL; FH\_DELIVERY\_MEMO for permits |
| SD\_INVOICE | Invoice columns on FH\_DELIVERY\_CHALLAN / FH\_DELIVERY\_MEMO |
| SD\_CUSTOMER\_LEDGER | Built by query (13.3) |
| SD\_DOC\_CANCELLATION | ORDER\_CANCEL\_MASTER/DETAIL, RECEIPT\_CANCEL\_MASTER/DETAIL, CANCEL\_FLAG on DCs |
| SD\_GATE\_PASS | FH\_DC\_DOCUMENT |
| SD\_TARGET, SD\_FISCAL\_YEAR | TARGET\_MST, TARGET\_CUST, TARGET\_CUST\_AREA; SALES\_YEAR |
| SD\_PRINT\_TEXT | PRINT\_TEXT |
| SD\_SALES\_RETURN, SD\_FBR\_SUBMISSION | Not built yet (phase 2) |

## 14. Table guide

All 174 tables of 01\_DCL\_SALES\_TABLES.sql, by module. Every table also has BRNCH (1 Karachi, 2 Islamabad) and COMPC; the key column leaves BRNCH out because every key starts with it. Source: Both = loaded from Karachi and Islamabad, KHI or ISB = one branch only, New = no legacy source.

### 14.1 System and setup (16 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| COMPANY | Company/branch header: name, address, STRN, NTN | COMP\_CODE (unique) | 18 | Both |
| UNIT\_MST | Units (plants) of the company | UNIT\_ID (unique) | 9 | Both |
| SALES\_YEAR | Fiscal years with start/end dates | YEAR | 12 | Both |
| DAYS\_LOCK | Days locked for back-dated entry | – | 3 | KHI |
| BLOCK\_DO\_DATE | Dates on which DOs may not be issued | FROM\_DATE (unique) | 4 | KHI |
| DOC\_SEQUENCE | New: next document number per branch, year and document type | YEAR, DOC\_TYPE | 6 | New |
| LEGACY\_MAP | New: old code → new code per entity (migration trace) | ENTITY, LEGACY\_CODE | 7 | New |
| PRINT\_TEXT | New: standard clause texts on prints (e.g. Contract Review Form) | TEXT\_CODE, SR\_NO | 8 | New |
| MSG\_TEMPLATE | New: email/WhatsApp message templates for report sharing | TEMPLATE\_CODE, CHANNEL | 7 | New |
| USER\_MAIL\_ACCOUNT | New: sender mail account per user | USRID | 10 | New |
| SHARE\_LOG | New: log of every report shared by email/WhatsApp | ID | 14 | New |
| GL\_MAP | New: GL account per document type and entry (finance posting) | DOC\_TYPE, ENTRY\_CODE | 7 | New |
| EXCHANGE\_RATE\_MAST | Exchange rate sheet header (export) | SERNO | 7 | KHI |
| EXCHANGE\_RATE\_DTL | Exchange rate lines per currency | – | 10 | KHI |
| AGGING\_GROUP | Ageing buckets for debtor reports | – | 7 | KHI |
| AGGING\_RULE | Rules that place balances in ageing buckets | SNO (unique) | 9 | KHI |

### 14.2 Users and audit (11 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| SEC\_USERNAME | Users: login, level, expiry, lock rules | USRID | 23 | Both |
| SEC\_USERCMPN | Branches a user may open | USRID, UNIT\_ID (unique) | 4 | Both |
| SEC\_MODULE\_S | Screens/reports (modules) of the system | SYSTM, MODUL (unique) | 16 | Both |
| SEC\_MAINMENU | Menu tree (self-referencing) | SERNO | 12 | Both |
| SEC\_USERPERM | Rights per user and module: insert, query, update, delete, print | UNIT\_ID, USRID, SYSTM, MODUL (unique) | 16 | Both |
| SEC\_USERMENU | Menu entries per user | USRID, SERNO (unique) | 11 | Both |
| SEC\_USER\_FAV | User favourite screens | USRID, MODLE (unique) | 4 | Both |
| SEC\_LHISTORY | Login history | – (unique key dropped by 04) | 11 | Both |
| SEC\_MOD\_ACES | Screen access log | – | 6 | Both |
| U\_AUDIT | Audit trail of changes | – | 8 | Both |
| LOG\_CUSTOMER\_INFO | History of customer record changes (ISB) | – | 52 | ISB |

### 14.3 Geography (11 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| ZONE\_DESC | Zones (top level) | ZONE\_CODE | 4 | Both |
| TERRITORY | Territories under a zone (ISB shape, used by both) | ZONE\_CODE, TERRITORY\_CODE | 5 | ISB |
| AREA | Areas/cities under a territory | ZONE\_CODE, TERRITORY\_CODE, AREA\_DOC (unique) | 8 | Both |
| MASTER\_AREA | Karachi master areas (legacy shape) | M\_AREA\_CD | 4 | KHI |
| DISTRICT | Karachi districts under an area | AREA\_CD, DIST\_CD | 6 | KHI |
| CITY | Karachi cities under a district | AREA\_CD, DIST\_CD, CITY\_CD | 8 | KHI |
| DISTRICT\_DTL | District details used in rates and reports | DIST\_CD, EFDATE, AREA\_CD (unique) | 19 | Both |
| REGION | Price regions | REGION | 4 | Both |
| REGION\_DETAIL | Areas in a price region | REGION, CUSTOMER\_FROM, CUSTOMER\_TO (unique) | 5 | Both |
| NEW\_REGION | Karachi revised regions | – | 6 | KHI |
| REG\_DESC | Region descriptions | CODE | 6 | KHI |

### 14.4 Products and tax (12 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| GROUP\_MST | Product groups (Bulk & Exempted, Clinker, Export, Local, Scrape, GGBFS) | GRP\_ID | 5 | KHI |
| PRODUCT\_TYPE | Product types under a group | PROD\_ID (unique) | 7 | Both |
| GROUP\_PRODUCT | Product grouping for reports | GROUP\_PRODUCT\_ID | 6 | KHI |
| PRODUCT\_DESC\_T | Products per branch and period: MRP, retail, FED, sales tax | PRODUCT\_CODE, PERIOD# | 18 | Both |
| PRODUCT\_DESC\_DTL | Product detail lines | PDD\_ID | 8 | KHI |
| PROD\_BRAND | Product brand names | BRAND (unique) | 5 | KHI |
| BAG | Bag types | BAG\_CD (unique) | 6 | Both |
| BAGS\_COLOR | Bag colours | COLOR | 4 | KHI |
| DELIVERY\_ORDER\_TYPE | DO types (product + local/outstation) | DO\_CODE | 9 | Both |
| SALES\_TAX | Sales tax rates | – | 7 | Both |
| SALES\_TAX\_FED | FED rates | WDATE (unique) | 6 | KHI |
| CED\_SETUP | CED setup | S\_NO (unique) | 7 | KHI |

### 14.5 Pricing and discounts (18 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| TRADE\_PRICE | Trade price per customer, city and product (DO clients) | AREA\_CODE | 24 | Both |
| AREA\_RATES\_M | Daily city rate sheet header (permit clients) | SERNO | 5 | Both |
| AREA\_RATES\_P | Products on a rate sheet | P\_LNKNO | 5 | Both |
| AREA\_RATES\_D | City-wise rates on a rate sheet | LNKNO | 19 | Both |
| AREA\_RATES\_DIST | District-wise rates (KHI) | – | 18 | KHI |
| REGION\_PRICE\_LIST | Price list per region | – | 10 | KHI |
| PRICE\_OPENING | Opening price per customer, area and product | SERNO, CUSTOMER\_CODE, EFDATE, AREA, DISTRICT, PRODUCT\_CODE | 30 | KHI |
| PRICE\_SLAB\_PERIOD | Price slab periods | P\_CODE | 6 | KHI |
| PRICE\_SLAB | Price slabs | – | 8 | KHI |
| PRICE\_SLAB\_OC | Slab applied on an OC | P\_CODE, OC\_NUMBER (unique) | 4 | KHI |
| OC\_PRICE\_DTL | Price breakdown of an OC (ISB) | – | 15 | ISB |
| ZONE\_CITY\_FRIEGHT\_M | Freight sheet header | SERNO (unique) | 6 | ISB |
| ZONE\_CITY\_FRIEGHT\_D | Freight per city | SERNO, AREA\_DOC (unique) | 6 | ISB |
| RATE\_UPDATE\_HISTORY | History of rate changes (ISB) | – | 5 | ISB |
| DISCOUNT\_TYPE | Discount types | DISCOUNT\_CODE | 4 | Both |
| DISCOUNT2 | Discounts per customer/product | – | 13 | Both |
| DISCOUNT\_APP\_MASTER | Discount approval header | DISCOUNT\_NO | 18 | Both |
| DISCOUNT\_APP\_DETAIL | Discount approval lines | TR\_NO | 5 | Both |

### 14.6 Customers (14 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| CUSTOMER\_INFO | Customer master: code, name, contacts, zone, channel, tax profile, status | CUSTOMER\_CODE | 57 | Both |
| CUSTOMER\_MASTER | Master (parent) customer grouping branches of one dealer | MCODE | 6 | KHI |
| CUSTOMER\_GROUP | Customer groups | GROUP\_ID (unique) | 5 | Both |
| CUST\_GRP\_MST | Customer group header (KHI) | – | 25 | KHI |
| CUST\_GRP\_DTL | Customers in a group (KHI) | – | 13 | KHI |
| CUSTOMERS\_DCL | DCL customer list (KHI) | CUSTOMER\_ID | 23 | KHI |
| CUSTOMER\_AREA | Areas a customer serves | CUST\_ID, ZONE\_CODE, TERRITORY\_CODE, AREA\_DOC (unique) | 6 | Both |
| CUSTOMER\_BANK\_ACC | Customer bank accounts | BANK\_CODE, ACCOUNT\_NO | 8 | Both |
| CATEGORY\_TYPE | BRV category: Clean, Transitory, Cash deposit, Cheque | CAT\_CODE | 4 | Both |
| CHANNEL\_DESC | Channels: dealer, direct, distributor, export… | CHANNEL\_CODE | 6 | Both |
| BLOCK\_CUSTOMER | Block/unblock history per customer | – (unique key dropped by 04: history) | 5 | KHI |
| BLOCK\_CUSTOMER\_GROUP | Block reasons/groups | G\_CODE | 5 | KHI |
| BLOCK\_ADV\_DEBTS | Blocked advances and debts | CUSTOMER\_CODE, TYPE (unique) | 5 | KHI |
| RESPONSIBLE\_PERSON | Responsible sales person | RESPER (unique) | 4 | KHI |

### 14.7 Credit and security (13 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| CREDIT\_TYPE | Credit types A–J (clean, transitory, billing…) | – | 5 | Both |
| CREDIT\_LIMITS | Limits per customer and credit type | CUSTOMER\_CODE | 23 | Both |
| CREDIT\_LIMITS\_F | Credit limit approval document | SERNO | 10 | Both |
| CREDIT\_APP\_MASTER | Credit approval header | – | 7 | Both |
| CREDIT\_APP\_DETAIL | Credit approval lines | – | 7 | Both |
| CREDIT\_APP\_MASTER1 | Credit approval header (KHI, second form) | – | 15 | KHI |
| CREDIT\_APP\_DETAIL1 | Credit approval lines (KHI, second form) | – | 10 | KHI |
| CUSTOMER\_CREDIT\_APP | Customer approval request (credit, tax limit, cash) | SERNO | 16 | Both |
| LOG\_CUSTOMER\_CREDIT\_APP | History of approval requests (ISB) | – | 20 | ISB |
| CREDIT\_MONITOR | Credit monitoring entries (ISB) | – | 7 | ISB |
| SECURITY\_DEPOSIT | Security deposit lines per customer | – | 5 | Both |
| CSECURITY\_DEPOSIT | Customer security deposit receipts | RECEIPT\_NO, DR\_CR (unique) | 17 | Both |
| TSECURITY\_DEPOSIT | Transporter security deposits (ISB) | RECEIPT\_NO, DR\_CR | 17 | ISB |

### 14.8 Banks and receipts (BRV) (12 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| BANK\_DESC | Banks | BANK\_CODE | 6 | Both |
| COMPANY\_BANK | Company deposit accounts | – | 10 | Both |
| INSTRUMENT\_TYPE | Mode of payment: DD, TT, cheque, pay order… | INST\_CODE | 4 | Both |
| CASH\_CHEQUE\_RECEIPTS | BRV: every customer payment with instrument and status | RECEIPT\_NO, CASH\_CHEQ\_CD (unique) | 54 | Both |
| ORDER\_CONFIRM\_BRV | Link BRV ↔ OC with amount applied | SERNO | 10 | KHI |
| BRV\_DTL | BRV detail lines (KHI) | DTLNO | 10 | KHI |
| BANK\_DEPOSIT | Bank deposit slips | DEPOSIT\_DATE (unique) | 5 | Both |
| BANK\_DEPOSIT1 | Bank deposit detail (KHI) | – | 17 | KHI |
| RECEIPT\_CANCEL\_MASTER | BRV cancellation header | CANCEL\_NO (unique) | 16 | Both |
| RECEIPT\_CANCEL\_DETAIL | BRV cancellation lines | CANCEL\_NO, SRL\_NO (unique) | 8 | Both |
| RECEIPT\_CANCEL | BRV cancellation (single form) | CANCEL\_NO | 15 | Both |
| BRV\_CANCEL\_DTL | Cancelled BRV copy (KHI) | – | 55 | KHI |

### 14.9 Orders: SRF and OC (9 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| SALES\_REQUEST\_MASTER | SRF header: customer, product, quantity, terms | SRF\_NO | 42 | Both |
| SALES\_REQUEST\_DETAIL | SRF schedule lines | SRF\_NO, SR\_NO | 9 | Both |
| ORDER\_CONFIRM | OC header: price breakdown, net value, approval | ORDER\_NO | 63 | Both |
| ORDER\_CONFIRM\_DETAIL | OC schedule lines (one per DO) | ORDER\_NO, SR\_NO | 10 | Both |
| ORDER\_CANCEL\_MASTER | Order cancellation advice header | OC\_ADVISE\_NO | 19 | Both |
| ORDER\_CANCEL\_DETAIL | Order cancellation lines | OC\_ADVISE\_NO, SR\_NO | 15 | Both |
| ORDER\_CANCELLATION | Order cancellation (single form) | OC\_ADVISE\_NO | 15 | Both |
| SD\_OCA\_MST | OC adjustment header (KHI) | SERNO | 7 | KHI |
| SD\_OCA\_DTL | OC adjustment lines (KHI) | LNKNO | 10 | KHI |

### 14.10 DO and permit (10 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| DELIVERY\_ORDER | DO: one per OC line, DO type, quantity, dispatched quantity | DO\_TYPE, DEL\_ORDER\_NO | 29 | Both |
| DO\_ADJUSTMENT | DO quantity/rate adjustment advice | ADVICE\_YR, ADVICE\_NO | 23 | Both |
| GODOWN\_DO | Godown DO header (KHI) | DO\_NO (unique) | 14 | KHI |
| GODOWN\_DO\_DTL | Godown DO lines (KHI) | DO\_NO, SR\_NO | 11 | KHI |
| PERMIT\_MST\_CITY | City-wise permit header: customer, validity, total | PERMIT\_NO | 14 | Both |
| PERMIT\_DTL\_CITY | Permit areas: quantity, rate, balance | LNKNO | 10 | Both |
| PERMIT\_ADJ\_CITY | Permit quantity adjustments | SERNO | 11 | Both |
| PERMIT\_MST | Permit header (ISB, older form) | PERMIT\_NO | 10 | ISB |
| PERMIT\_DTL | Permit lines (ISB, older form) | PERMIT\_NO, CUSTOMER\_CODE (unique) | 5 | ISB |
| APCAMA\_QUOTA | APCMA quota per period | QOUTA\_DATE (unique) | 6 | Both |

### 14.11 Dispatch: DC and DM (15 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| FH\_DELIVERY\_CHALLAN | DC header (KHI, to Nov 2024) | DC\_TYPE, DC\_NO (unique) | 47 | KHI |
| FH\_DEL\_CHALLAN\_DETAIL | DC lines: DO, tons, bags (KHI) | DC\_TYPE, DC\_NO, DO\_NO (unique) | 38 | KHI |
| FH\_DELIVERY\_MEMO | Delivery memo for permits (KHI) | DM\_NO (unique) | 72 | KHI |
| FH\_DC\_DOCUMENT | Gate/weighbridge: token, truck, tare/gross, gate in/out (KHI) | – | 23 | KHI |
| DELIVERY\_CHALLAN\_OLD | Older DC header (KHI to 2012, ISB to 2015) | DC\_TYPE, DC\_NO (unique) | 34 | Both |
| DEL\_CHALLAN\_DETAIL\_OLD | Older DC lines | DC\_TYPE, DC\_NO, DO\_NO (unique) | 26 | Both |
| DELIVERY\_MEMO\_OLD | Older delivery memo (ISB to 2015) | DM\_NO (unique) | 46 | ISB |
| DC\_AKNOW | DC acknowledgement header (ISB) | DA\_NO | 11 | ISB |
| DC\_AKNOW\_DET | DC acknowledgement lines (ISB) | DA\_NO, SRL\_NO (unique) | 9 | ISB |
| ACK\_MST | Acknowledgement master (KHI) | ACK\_NO (unique) | 6 | KHI |
| DC\_COUPON | DC coupons (KHI) | DC\_TYPE, DC\_NO, COUPON\_NO (unique) | 7 | KHI |
| MODE\_OF\_TRANSPORT | Truck, ship, wagon | MODE\_CODE (unique) | 4 | Both |
| TRANSPORTER\_DESC | Transporters | TRANSP\_CODE (unique) | 9 | Both |
| DUMMY\_INV\_MST | Manual invoice header (KHI) | SERNO | 10 | KHI |
| DUMMY\_INV\_DTL | Manual invoice lines (KHI) | – | 11 | KHI |

### 14.12 Ledger, notes, tax and accounts (16 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| OPENING\_BALANCES | Opening balance per customer and year | CUSTOMER\_CODE, OPEN\_DATE (unique) | 18 | Both |
| CUSTOMER\_OPEN\_BALANCE | Customer opening balance (single figure) | – | 6 | Both |
| CREDIT\_NOTE\_TYPE | Credit note types 001–010 | CODE (unique) | 4 | Both |
| CREDIT\_NOTE | Credit/debit note header | SRL\_NO, DB\_CR\_CD, NOTE\_TYPE | 33 | Both |
| CREDIT\_NOTE\_DETAIL | Credit note lines | SRL\_NO, DB\_CR\_CD, NOTE\_TYPE, SR\_NO (unique) | 11 | Both |
| DEBIT\_CREDIT\_NOTE | Debit/credit note (single form) | SR\_NO | 15 | Both |
| DC\_ADJ\_1 | DC ledger adjustment 1 (KHI) | SERNO | 5 | KHI |
| DC\_ADJ\_2 | DC ledger adjustment 2 (KHI) | DOCNO | 12 | KHI |
| DC\_ADJ\_3 | DC ledger adjustment 3 (KHI) | DOCNO | 12 | KHI |
| DC\_LADGER\_ADJ | DC ledger adjustments (KHI) | – | 11 | KHI |
| TAX | Withholding tax deduction header | SRL\_NO | 15 | Both |
| TAX\_DETAIL | Withholding tax lines | SRL\_NO, RECEIPT\_TYPE, RECEIPT\_NO (unique) | 6 | Both |
| TAX\_CERTIFICATE | Tax certificate header (KHI) | SERNO | 5 | KHI |
| TAX\_CERTIFICATE\_DTL | Tax certificate lines (KHI) | LNKNO | 9 | KHI |
| VOCH\_POST | Voucher posted to finance (KHI) | – | 11 | KHI |
| VOCH\_DTL | Voucher lines (KHI) | – | 14 | KHI |

### 14.13 Targets, incentives and retail (17 tables)

| Table | Holds | Key | Cols | Source |
| --- | --- | --- | --- | --- |
| TARGET\_MST | Monthly target header | SERNO | 11 | Both |
| TARGET\_CUST | Target per customer | TRG\_NO, SERNO (unique) | 9 | Both |
| TARGET\_CUST\_AREA | Target per customer and area | TRG\_NO, LNKNO (unique) | 11 | Both |
| TARGET\_DTL\_CTY | Target per city (KHI) | DOCNO | 8 | KHI |
| TARGET\_PERC\_MST | Monthly incentive header (ISB) | PERC\_ID (unique) | 6 | ISB |
| TARGET\_PERC\_DTL | Incentive slabs: target % → amount (ISB) | – | 12 | ISB |
| INCENTIVE | Incentive scheme header | SRL\_NO | 20 | Both |
| INCENTIVE\_PRODUCT | Products in a scheme | SRL\_NO, PRODUCT\_CODE (unique) | 5 | Both |
| INCENTIVE\_DETAIL | Incentive per customer | SRL\_NO, SR\_NO (unique) | 11 | Both |
| D\_CATEGORY | Dealer/retailer categories (KHI) | CAT\_ID (unique) | 6 | KHI |
| D\_DEALER\_MASTER | Dealers in retail scheme (KHI) | D\_CODE | 11 | KHI |
| D\_RETAILER\_MASTER | Retailers (KHI) | R\_CODE | 7 | KHI |
| D\_INSENTIVE\_MASTER | Retailer incentive (KHI) | – | 11 | KHI |
| RETAILER\_INFO | Retailer details (KHI) | RET\_CODE (unique) | 9 | KHI |
| RET\_PAY\_MAS | Retailer payment header (KHI) | RECEIPT\_NO | 10 | KHI |
| RET\_PAY\_DET | Retailer payment lines (KHI) | – | 6 | KHI |
| MARKETING | Marketing visit/activity log (KHI) | – | 8 | KHI |

## 15. Islamabad unit (Hattar) system

The Islamabad unit runs its own copy of the sales system, with its own customers, products, rates and users. So the new system must treat the **branch** as a dimension on every master and document: each branch keeps different information, products and pricing. This section records what its 28 screens show (folder "Sales Flow", 16 Oct 2026).

### 15.1 Login, branch and fiscal year

&#91;image: Login: user, password, unit and fiscal year\]

&#91;image: Main menu and Pending Booking list\]

- At login the user picks the **unit** (branch, e.g. ISLAMABAD) and the **fiscal year** (e.g. 2026-2027). All screens then show only that branch and year.
- The home screen lists **Pending Bookings**: permit no, date, customer code, customer name, qty, with a Get Date action.
- Menu groups: Adjustment, Receipts, Approvals, Setup, Reports.

### 15.2 Geography and customer code

&#91;image: Zone, Territory and Area/City setup (SD\_AREA\_N)\]

- Hierarchy: **Zone → Territory → Area/City**. Examples: Zone 10 AJK → Territory 01 AJK → cities 2144 Bagh, 2146 Kotli, 2148 Mirpur (AJK).
- Islamabad zones include 1 Peshawar, 2 Rawalpindi, 3 Lahore, 4 Multan, 5 Karachi, 6 Afghanistan, 7 U.A.E, 8 India, 9 East Africa, 10 AJK, 11 Central Zone, 12 Hazara.
- Each customer is placed in one zone, territory and area, and also has a list of **customer areas** (the cities it serves).
- **The customer code is generated from Zone code → Territory code → City/Area code → Channel code.**
- Both branches will use this Islamabad structure. The legacy Karachi report "Area Detail Information" (area.pdf) used a different shape, to be migrated: 17 areas (SD-1 to SD-4, BCH-1 to BCH-3, KHI-1 to KHI-5, Export, Punjab, South Region FWO, AJK) → 57 districts → 486 cities.

### 15.3 Customer

&#91;image: Customer information (Islamabad)\]

&#91;image: Customer sales tax tab (Islamabad)\]

Same four tabs as Karachi (Information, Sales Tax, Credit Limits, Group/Link), plus:

| Field | Requirement |
| --- | --- |
| Channel code | From the channel master (15.4) |
| Card open date, card status, card closed date | Account opening and closing |
| Credit limit, Misc. customer | As in Karachi |
| Tax payer flag, Register no | On the sales tax tab |

### 15.4 Channels

&#91;image: Channel Information (SD\_CHANNELDESC)\]

The channel master holds the type of trade for each customer.

| Code | Channel |
| --- | --- |
| 001 | Dealer |
| 002 | Direct |
| 003 | Distributor |
| 004 | Export |
| 005 | Government / Institute |
| 006 | Dealer (Tax Free Zone) |
| 007 | Dealer Bond |
| 008 | Bond (Tax Free Zone) |
| 009 | Bond (Institute Sale) |

### 15.5 Credit limits and approvals

The Islamabad unit gives customers credit, controlled by credit type and approved by management. Karachi will get the same functionality.

&#91;image: Credit Limits tab: initial, current and availed per credit type\]

&#91;image: Customer Approval Request (SD\_CUST\_CREDIT)\]

&#91;image: Credit Limit approval document (SD\_CRLMT)\]

&#91;image: Credit Type master\]

| Credit type | Description |
| --- | --- |
| A | Clean |
| B | Transitory |
| C | Billing credit |
| D | Against advances |
| E | Security deposit |
| F | Against incentive |
| G | Tax deduction |
| H | Against bounced cheques |
| I | Buffer limit |
| J | Bank float |

- Each customer has an **initial limit, current limit and amount availed** per credit type.
- A **Customer Approval Request** has approval type (Credit, Tax Limit, Cash), tax type (Yearly, Monthly), limit, effective date, balance, status, approved date and approver.
- A **Credit Limit** document records the last approved amount, O.C balance, the new approval amount and a remark (e.g. "approved by DGM"), and can be printed.

### 15.6 Payments

&#91;image: Instrument Type = mode of payment (SD\_INSTRUMENT)\]

&#91;image: Category Types (SD\_CATEGORY)\]

&#91;image: Customer Bank Information\]

| Code | Instrument (mode of payment) |
| --- | --- |
| A | Demand draft |
| B | T.T |
| C | Cheque |
| D | Travellers cheque |
| E | Pay order |
| F | Deposit in company bank A/C |
| G | M.T |
| H | TFR |
| I | Uni remote transfer |
| J | Internal transfer |

- **Category types**: A Clean, B Transitory, C Cash deposit, D Cheque. Each BRV receipt collection is tagged with one of these categories.
- **Bank master**: bank code, bank name, bank type (e.g. LOC).

### 15.7 Credit notes

&#91;image: Credit Note Type\]

Credit note types: 001 Adjustments, 002 Subsidies, 003 Purchases, 004 Sales return, 005 Revision of rate, 006 Freight, 007 Commission, 008 Incentive, 009 Withholding 236H, 010 Target incentive. Credit notes are recorded in the system and post to the customer ledger; incentives and subsidies reach the customer this way.

### 15.8 Transport and freight

&#91;image: Mode of Transport\]

&#91;image: Transporter Info\]

&#91;image: Freight rate per area (SD\_FRGHT)\]

- Mode of transport: 001 Truck, 002 Ship, 003 Wagon.
- Transporter master: code, name, two address lines, phone, fax, email.
- **Freight sheet**: serial, date, status (Approved); one line per city with zone, last freight rate, new freight and freight %. Unlike Karachi, Islamabad prices include freight.

### 15.9 Products by branch and period

&#91;image: Product Info (Islamabad)\]

The Islamabad unit has its own product list: OPB, OPA, OPSE, DTB (Dewan Tile Bond), OPSB, CLK (Clinker), OPCP, OPCS and OPS. Each product row has avg rate, FED, MRP, retail price, company price, sales tax amount and %, product type (B, L, C, X, E), period number, date from/to and status. Products and their tax values are kept per branch and per period.

### 15.10 Daily zone/city rates (permit clients)

&#91;image: Zone / City Rates (SD\_CITY\_RT)\]

Rates for permit customers are updated **daily** as a rate sheet (serial, date, status Pending → Approved). The sheet covers the selected products (e.g. OPS, OPCP, DTB), and MRP can be updated for all lines at once.

| Column | Rule |
| --- | --- |
| Booking price | Delivered price to the city |
| Freight (LFR = last freight rate) | From the freight sheet |
| Net booking | Booking price − freight |
| Ex-factory | Net booking − rebate |
| Net retention | Ex-factory − tax 236 − FED − sales tax |

Example, Bagh (zone 10 AJK): 29,670 − 3,070 freight = 26,600 net booking = 26,600 ex-factory; 26,600 − 0 − 4,000 FED − 4,617.763 sales tax = **17,982 net retention per ton**.

### 15.11 Trade price (DO clients)

&#91;image: Trade Price (SD\_TRADE\_DISC)\]

DO customers get a trade price per customer, city and product, under a code such as AAKHTOPS01. The screen reads retail price, sales tax, MRP and CED from the product master; **company price = MRP − sales tax − CED** (12,100 − 1,758.12 − 1,500 = 8,841.88). Fields: date, customer, description, area, product, invoice price, target, trade discount, active/de-active.

### 15.12 Targets and monthly incentive

&#91;image: Target Info (SD\_TARGET\_F)\]

&#91;image: Monthly Incentive (SD\_TERGT\_PER)\]

- **Target**: number, date, month (YYYYMM), total qty, value, working days, status; lines per customer (qty, addition qty, special qty) and per area. Needed for the Target vs Dispatch report.
- **Monthly incentive**: number, date, month; slabs of target % → amount for normal, addition and special incentive. Kept in the system; the incentive amount is posted as a credit note (types 008 Incentive, 010 Target incentive).

### 15.13 Users and permissions

&#91;image: User Information\]

&#91;image: Permissions Granted to User\]

- **User**: ID, name, designation, user level, password, expiry date, status, lock after, wrong login count, allowed time window, allowed computers, password life, and the branches (companies) the user can open.
- **Permissions**: one row per screen (module) with Insert, Query, Update, Delete and Print rights, plus Copy All Permission, Permission of All Reports and Copy From User.

### 15.14 What changes in the design

| Change | Where |
| --- | --- |
| SD\_PLANT becomes SD\_BRANCH; branch\_id on every master and document | ERD part 1 and 3 |
| Login chooses branch + fiscal year (SD\_FISCAL\_YEAR) | ERD part 3 |
| Channel master (SD\_CHANNEL) linked to customer | ERD part 3 |
| Customer code generated from zone + territory + area + serial | Section 15.2 |
| Credit types, customer credit limits and credit approvals | ERD part 3 |
| Instrument (mode of payment) and payment category masters | ERD part 3 |
| Credit note types and credit notes | ERD part 3 |
| Transporter, mode of transport, freight sheet per city | ERD part 3 |
| Products and their tax values kept per branch and period | SD\_PRODUCT\_PERIOD |
| Daily city rate sheet with approval (permit clients) | SD\_CITY\_RATE\_SHEET, SD\_CITY\_RATE |
| Trade price per customer, city, product (DO clients) | SD\_TRADE\_PRICE |
| Targets per month, customer and area | SD\_TARGET and lines |
| Users, branches, screen permissions (I/Q/U/D/P) | SD\_USER, SD\_MODULE, SD\_USER\_PERMISSION |

## 16. Plant dispatch (Workflow V2)

Workflow V2 (Nov 2026) adds the plant side: a DO or permit issued at head office is lifted at the Karachi or Hattar plant through gate, bilty, weighbridge and exit, and the dispatch details then go to FBR. Section 3 covers the head-office part up to the DO or permit.

&#91;image: Cement Sales & Dispatch, Workflow V2: dealer and payment, head office authorization, Karachi/Hattar plant\]

Workflow V2 process map (Nov 2026): 01 Dealer & payment, 02 Head office authorization (DO or permit), 03 Karachi/Hattar plant gate, dispatch and clearance.

**Head office (recap)**

- DO route: SRF → OC → BRV → OC confirmation → DO.
- Permit route: BRV → permit, directly.
- No BRV, or an OC not confirmed: the order stays pending.
- The dealer receives the DO or permit and sends a transporter.

**At the plant**

1. Transporter or driver arrives at the main gate.
2. Gate verification: driver CNIC, name, mobile number and vehicle number.
3. Driver presents the DO or permit.
4. No DO or permit available: a temporary token is issued against the dealer's bilty. This step is still to be agreed with the business.
5. DCL bilty is made.
6. Delivery Challan (DO route) or Delivery Memo (permit route) is made; one DC can carry several DOs (section 9.1).
7. Tare weight (empty truck) on the weighbridge.
8. Loading, then gross weight; net = gross − tare.
9. Exit gate clearance.
10. Dispatch details forwarded to FBR (Digital Invoicing, phase 2).

| Step | Data captured | Table (section 14) |
| --- | --- | --- |
| Gate in | CNIC, driver name, mobile, vehicle no, time | FH\_DC\_DOCUMENT (driver CNIC, name and mobile to be added) |
| Token | Token type and no, truck no, reporting time | FH\_DC\_DOCUMENT |
| Bilty | Bilty no, transporter | FH\_DELIVERY\_MEMO (BILTY, TRANSP\_CODE); FH\_DELIVERY\_CHALLAN has TRANSP\_CODE but no bilty column yet; TRANSPORTER\_DESC |
| DC / DM | DC or DM no, DO or permit area per line, tons, bags, bag type | FH\_DELIVERY\_CHALLAN + FH\_DEL\_CHALLAN\_DETAIL; FH\_DELIVERY\_MEMO |
| Weighbridge | Tare weight, time and shift; gross weight, time and shift | FH\_DC\_DOCUMENT (TARE\_WT, GROSS\_WT) |
| Exit | Gate-out flag | FH\_DC\_DOCUMENT (OUT\_GATE) |
| FBR | FBR invoice no, status | Not built yet (phase 2) |

Today these steps are not in the legacy sales databases: the DC and DM tables there stop in 2024 (Karachi) and 2015 (Islamabad), so current challans are most likely written by a separate dispatch or weighbridge application whose database is still to be identified (section 18.3).

## 17. Unified database

The new system runs on one Oracle 11g schema that holds both branches: legacy Karachi table and column names, with BRNCH 1 = Karachi and BRNCH 2 = Islamabad on every row. Both legacy databases (about 5 GB together) load into it without losing a column or a row.

### 17.1 Legacy sources

| Unit | Legacy DB | Tables | Imported as schema | Size on test server |
| --- | --- | --- | --- | --- |
| Karachi | SALES@LOCALSDB | 245 | SCLKHI | 2,688 MB |
| Islamabad / Hattar | SCLSALES@ISB.WORLD | 123 | SCLISB | 606 MB |

Many legacy tables are backups or one-off copies (e.g. DELIVERY\_CHALLAN\_BK, DEL\_CHALLAN\_DETAIL\_06092007, SD\_IMRANSB, SAQUIB). They are not carried into the new schema.

### 17.2 Design rules of the unified schema

| Rule | Detail |
| --- | --- |
| Names | Karachi table and column names are kept, so existing reports and know-how carry over |
| Branch | BRNCH (1 Karachi, 2 Islamabad) and COMPC on every table; every key starts with BRNCH, so the same document number can exist in both branches |
| No surrogate IDs | No identity or ID columns; legacy keys are kept as they are (11g has no identity columns) |
| Lossless | Every source column has a target column; Islamabad-only columns are added to the Karachi table |
| Merged columns | Where the two DBs name the same field differently, the load takes NVL(Karachi name, Islamabad name); a conflict check returned 0 rows |
| History tables | FH\_\* tables (Karachi history) are kept separate from \*\_OLD tables |
| Error capture | Every load uses DBMS\_ERRLOG (ERR$\_\<table>), so a bad row is logged, not lost |
| Keys after load | Primary, unique and foreign keys are added after the data, ENABLE NOVALIDATE: old rows stay, every new row is checked |

**Columns merged during the load**

| Target table | Karachi column | Islamabad column |
| --- | --- | --- |
| Area tables | AREA\_CD | AREA\_CODE |
| Area tables | AREA\_NAME | AREA\_DESC |
| TARGET\_MST | SERNO | TRG\_NO |
| TARGET\_MST | REMRK | DESCR |
| SALES\_REQUEST (SRF) | TRANSPORTER\_2 | TRANSPORTER |
| SALES\_REQUEST (SRF) | BAG\_CD | BAGTYP |
| CASH\_CHEQUE\_RECEIPTS | CANCEL\_STATS | STATUS |

### 17.3 Scripts and run order

All scripts are in D:\\SALES SYSTEM and run in SQL\*Plus as the target schema owner (SALES\_NEW on the test server). Each stops at once if run as the wrong user.

| # | Script | What it does |
| --- | --- | --- |
| 01 | 01\_DCL\_SALES\_TABLES.sql | Creates the 174 unified tables (no keys yet) |
| 02 | 02\_DCL\_SALES\_LOAD\_DATA.sql | Full load: 251 inserts (140 masters + 111 transactions) from SCLKHI and SCLISB, then a reconciliation (source rows vs target rows vs error rows) |
| 02 (window) | 02\_LOAD\_TRANSACTIONS\_ONLY.sql | Clears and reloads only the 75 transaction tables for a date window (FROM\_DT, TO\_DT); masters untouched. Detail tables follow their header's date |
| 03 | 03\_DCL\_SALES\_KEYS\_AFTER\_LOAD.sql | Adds primary, unique and foreign keys and lists every key with problem rows |
| 04 | 04\_CLEANUP\_DUPLICATES.sql | Fixes the problems 03 found (section 18.4); shows a preview and waits for COMMIT |
| Check | FIND\_ACTIVE\_TABLES.sql | Lists the legacy tables that still receive data (latest date per table); read-only on the legacy schemas |

Pass rule: in every reconciliation DIFF = 0 and ERR\_ROWS = 0.

## 18. Migration test run (18 Nov 2026)

The test load into SALES\_NEW passed: all masters in full plus transactions from 1 Sep to 1 Oct 2026, every reconciliation row DIFF = 0 and ERR\_ROWS = 0. Delivery challans and memos could not be loaded because they are not in the legacy sales databases.

### 18.1 What was loaded

Masters were loaded in full; transactions for the window 01-09-2026 to 01-10-2026, because the legacy copies end on 1 Oct 2026 (last DO date in both branches).

| Table | Karachi rows | Islamabad rows |
| --- | --- | --- |
| AREA\_RATES\_D (master) | 87,018 | 239,451 |
| OPENING\_BALANCES (master) | 26,204 | 5,748 |
| TRADE\_PRICE (master) | 21,618 | 5,827 |
| CUSTOMER\_INFO (master) | 4,746 | 1,469 |
| SEC\_USERNAME (master) | 36 | 24 |
| ORDER\_CONFIRM\_DETAIL | 3,006 | 694 |
| DELIVERY\_ORDER | 2,846 | 694 |
| CASH\_CHEQUE\_RECEIPTS (BRV) | 1,360 | 1,131 |
| SALES\_REQUEST\_DETAIL | 358 | 44 |
| SALES\_REQUEST\_MASTER (SRF) | 274 | 44 |
| ORDER\_CONFIRM (OC) | 249 | 44 |
| PERMIT\_MST\_CITY | 184 | 784 |
| CREDIT\_NOTE | 17 | 92 |
| ORDER\_CANCEL\_MASTER | 15 | 1 |
| RECEIPT\_CANCEL\_MASTER | 7 | 7 |

One Karachi SRF can have several schedule lines, so SALES\_REQUEST\_DETAIL has more rows than SALES\_REQUEST\_MASTER.

### 18.2 Fixes made to the load

| Problem | Fix |
| --- | --- |
| SRF\_DATE is empty on every SALES\_REQUEST\_DETAIL row, so a date filter skipped them all | Detail rows now follow their header (SRF\_NO) into the window |
| Recon used old error-table names for DC tables | Recon rebuilt from the insert statements; 0 missing objects |
| SYS dictionary views broken on the test server (ALL\_TAB\_COLUMNS) | Checks built from the known table structures instead of the dictionary |

### 18.3 Findings in the legacy data

**Delivery challans and memos are not in the sales DBs.** Every DC/DM table stops years ago, while DOs run to 1 Oct 2026:

| Table | Rows | Last date |
| --- | --- | --- |
| KHI FH\_DELIVERY\_CHALLAN | – | 28-11-2024 |
| KHI FH\_DELIVERY\_MEMO | 77,331 | 28-11-2024 |
| ISB INV\_FH | 117,261 | 26-01-2023 |
| KHI DELIVERY\_CHALLAN\_OLD | – | 30-11-2012 |
| ISB DELIVERY\_CHALLAN\_OLD | – | 15-09-2015 |
| ISB DELIVERY\_MEMO\_OLD | 186,217 | 15-09-2015 |
| KHI DELIVERY\_CHALLAN\_NEW, KHI/ISB TRANSACTION | 0 | – |

FIND\_ACTIVE\_TABLES confirmed it: no DC, DM, gate or weighbridge table received data after 1 Sep 2026. The dispatch application in use at the plants writes elsewhere.

**Impossible dates.** Some rows carry years such as 2109, 3001, 7998, 8178, 9198 and 9503 (in CASH\_CHEQUE\_RECEIPTS, DELIVERY\_ORDER, ORDER\_CONFIRM\_DETAIL, SALES\_REQUEST\_DETAIL, CREDIT\_LIMITS\_F and TAX). They load as they are, but reports that filter on these columns will be wrong. The new screens must reject dates more than a year ahead.

**Islamabad has no GROUP\_MST.** ISB product types point to group IDs 1–5 that exist only in Karachi; the Karachi groups were copied for BRNCH 2.

### 18.4 Key check (script 03) and cleanup (script 04)

| Constraint | Problem rows | Cause | Action taken |
| --- | --- | --- | --- |
| UK\_BLOCK\_CUSTOMER\_N1 | 4,300 | BLOCK\_CUSTOMER is a history of block/unblock, not one row per customer | Unique key dropped; current status = latest row |
| FK\_PERMIT\_ADJ\_CITY\_58 | 114 | September adjustments point to permits issued before September | None; clears with the full load |
| UK\_SEC\_USERPERM\_N1 | 72 | Same right granted twice, caused by duplicated modules | Kept one row per user and module (all pairs were identical) |
| FK\_PRODUCT\_TYPE\_11 | 7 | No GROUP\_MST in Islamabad | Karachi groups 1–6 copied to BRNCH 2; ISB product G (Exempted GGBFS) moved to group 6 |
| UK\_SEC\_MODULE\_S\_N1 | 6 | Modules defined twice: SD\_ACUDEBTSUM, SD\_BANK\_DEPOSIT, SD\_KASHIF, SD\_OST\_KP3 (KHI); SD\_CRLMT, SD\_PERMIT\_DM (ISB) | Latest definition kept |
| UK\_TRANSPORTER\_DESC\_N2 | 1 | ROSHAN SHANWARI entered twice in ISB with two codes | Second name suffixed with its code; no row deleted |
| UK\_SEC\_LHISTORY\_N1 | 1 | Duplicate serial in the login log | Unique key dropped |

After script 04 every check is 0 except FK\_PERMIT\_ADJ\_CITY\_58.

## 19. Server risks and go-live checklist

The test server (Oracle XE 11.2.0.2) proved the scripts but cannot carry production: XE caps user data at 11 GB, and its SYS dictionary was damaged during testing. Production needs a clean Oracle 11g (or later) install with only the new schema.

### 19.1 Risks found on the test server

| Risk | Effect | Action |
| --- | --- | --- |
| XE 11 GB user-data limit (ORA-12953) | SCLKHI, SCLISB and earlier test schemas (SALES\_SYSTEM, SALES\_DB) share the 11 GB, so a full load hit the limit | Production on Standard/Enterprise Edition, or drop old test schemas before a full load on XE |
| SYS dictionary damaged: 6 SYS tables dropped, 416 SYS objects invalid | DROP, DBMS\_OUTPUT, export (exp) and dictionary views such as ALL\_TAB\_COLUMNS fail with ORA-00604 / ORA-04063 | Reinstall XE, or move SALES\_NEW to a fresh database; do not run production on this instance |
| Scripts run as SYS | A cleanup run as SYSDBA dropped SYS tables | Every script now checks USER first and stops if it is not the target schema |
| Default tablespace SYSTEM | SYSTEM filled up (ORA-01653) | Target schema on its own tablespace (SALES\_DATA, autoextend); UNDO on autoextend |

### 19.2 Go-live checklist

- [ ] Identify the plant dispatch / weighbridge database that holds current DCs and DMs, export it and map it to FH\_DELIVERY\_CHALLAN, FH\_DEL\_CHALLAN\_DETAIL, FH\_DELIVERY\_MEMO and SD\_GATE\_PASS
- [ ] Fresh Oracle install for production (not the damaged XE)
- [ ] Fresh export of SCLKHI and SCLISB on cut-over day, so data runs to the go-live date and not 1 Oct 2026
- [ ] Run 01 → 02 full load → 03 → 04; every reconciliation row DIFF = 0 and ERR\_ROWS = 0
- [ ] Clean the impossible future dates, or agree with Finance how reports treat them
- [ ] Business confirms: ISB product G (Exempted GGBFS) under group 6; ORD\_BY order for product groups
- [ ] Agree the temporary-token rule at the gate (dealer bilty without DO or permit)
- [ ] Freeze legacy Forms entry at cut-over so no document is entered in both systems

## Appendix A. October logical design (SD\_ model, superseded by section 13)

The draft model has 18 master tables and 15 transaction tables. A further 6 dashed slots cover tables whose rules are still open or planned for phase 2. It is a fresh design for the new system; legacy SD\_ tables will be mapped onto it during migration.

&#91;embedded content: ERD part 1 · master tables\]

Geography runs Zone → Territory → Area. A customer can book for many areas through SD\_CUSTOMER\_AREA. Every rate lives in SD\_PRICE\_RATE with an effective date, so a price change never overwrites history.

&#91;embedded content: ERD part 2 · transaction tables and future slots\]

A DC line points to exactly one DO or one permit area, which lets one DC carry several DOs. Each DC line has its own invoice (1 : 1), and saving a DC writes all its invoices and ledger rows in one database transaction.

&#91;embedded content: ERD part 3 · branch-specific masters from the Islamabad (Hattar) system\]

Part 3 comes from the Islamabad unit screens (section 15). SD\_BRANCH replaces SD\_PLANT, and branch\_id is added to customers, geography, products, prices and all documents, because each branch keeps its own data.

### A.1 Key design decisions

| Decision | Why |
| --- | --- |
| Rates stored in SD\_PRICE\_RATE with effective dates | Re-pricing an OC and the 14-day rate lock both need the old and new rate |
| SD\_OC\_BRV link table | One OC can be paid by several BRVs, and one BRV can cover several OCs |
| SD\_DC\_LINE references a DO or a permit area | One vehicle lifts several DOs (sample DC: 4 DOs, 38.5 MT), and each DO gets its own invoice |
| Two ledger types in one table (DO / DC) | The DO-based and DC-based ledgers share structure; source\_type + source\_id point to the document |
| SD\_DOC\_CANCELLATION and SD\_AUDIT\_LOG | Cancel, approve, edit and qty adjustment always keep user, date and reason |
| Validity and thresholds in SD\_CONFIG | 14 days in the system, 48 hours on print; CFO approval stays a manual decision |
| Plant FK on every document | Numbering, rates and stock differ between Karachi (.1) and Hattar (.2) |

### A.2 Status values

| Document | Status values |
| --- | --- |
| Customer | DRAFT, APPROVED, INACTIVE, CLOSED |
| SRF | DRAFT, SUBMITTED, CONVERTED, CANCELLED |
| OC | DRAFT, REVIEWED, CONFIRMED, ON\_HOLD (shortfall), CLOSED, CANCELLED |
| BRV | ENTERED, VERIFIED, BOUNCED, CANCELLED |
| Permit | DRAFT, PENDING\_CFO, APPROVED, PARTLY\_DISPATCHED, CLOSED, EXPIRED, CANCELLED |
| DO | ISSUED, PARTLY\_DISPATCHED, DISPATCHED, EXPIRED, CANCELLED |
| DC | SAVED (invoices + ledger posted), CANCELLED |

### A.3 Slots waiting for answers

| Slot | Waiting on |
| --- | --- |
| SD\_GATE\_PASS | Gate pass, driver and weighbridge: captured (KHI FH\_DC\_DOCUMENT); add SD\_GATE\_PASS |
| SD\_SALES\_RETURN | Phase 2 |
| SD\_FBR\_SUBMISSION | Phase 2 |
| SD\_BAG\_SUPPLIER | Whether bag supplier/brand needs a master list |

Removed or settled: SD\_PERMIT\_ADJUSTMENT (manual edits, audit log), DO type rows for DBC and AHAN (no DOs issued), SD\_CONTRACT\_REVIEW (22 Oct: a print of the SRF, clauses in SD\_PRINT\_TEXT). SD\_CUSTOMER\_SECURITY is now a real table (22 Oct: security tab defined).

### A.4 Table guide

Each table below has one job. A table is kept separate when its data repeats (one-to-many), changes over time, or is shared by several documents.

**Masters: organisation and geography**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_PLANT | Holds the two plants: Karachi (.1) and Hattar (.2), with address, STRN and NTN | Every document, rate and number depends on the plant. Storing it once lets the suffix, invoice header and plant-wise reports come from one place |
| SD\_ZONE | Top level of geography (e.g. 22 SINDH) | Reports group dispatch and collection by zone (BCH, INST, KHI, SINDH) |
| SD\_TERRITORY | Middle level under a zone (e.g. 103 Upper Sindh) | Permits print Zone → Territory → Area; a separate level keeps that hierarchy without repeating names |
| SD\_AREA | City/area under a territory (e.g. 519 Nawabshah, 95 Larkana) | Permits are split by area, DCs carry a destination area, and each area belongs to a price region |
| SD\_PRICE\_REGION | Pricing region (e.g. THR, Lower Sindh) | Outstation prices change by region, not by single city. Several areas share one region and one rate |

**Masters: customers**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_CUSTOMER\_CATEGORY | Customer channels and their code prefixes (199 Karachi, 499 Outstation, 699 Balochistan, 8xx, 9xx) | Replaced by SD\_CHANNEL (ERD part 3): the channel is part of the generated customer code and drives reports |
| SD\_CUSTOMER | One row per customer: code, name, contacts, zone, category, master customer, credit limit, status and approval | Central record used by every document. The self-link (master\_customer\_id) groups branches of one dealer. Status and approval enforce that only approved customers can trade |
| SD\_CUSTOMER\_TAX | Sales tax and income tax profile: registration type, STRN, NTN, CNIC, filer status | Split from SD\_CUSTOMER because it is a separate tab, changes on its own (filer status changes yearly), and the tax calculator reads only this |
| SD\_CUSTOMER\_AREA | Which areas a customer may book or deliver to | A customer serves many areas and an area has many customers (many-to-many), so it needs a link table |

**Masters: products and pricing**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_PRODUCT | Cement types: OPC, SRC, LPC, BPC, PPC, DPC, DBC, AHAN, with brand description | Products are fixed values used on every document and print |
| SD\_DO\_TYPE | DO type codes (OK, OS, LS, SK, SS…) linked to product and location | The DO type is product + Karachi/Outstation. DBC and AHAN have no DO type because DOs are not issued for them |
| SD\_PRICE\_CODE | The agreed price key for one customer + product + plant + region (outstation) or sequence (Karachi), e.g. TCPOPTHR, SKYOP2 | Pricing is customer-specific. The code is the identity of the deal; the actual rates hang under it |
| SD\_PRICE\_RATE | Rates under a price code with effective from/to: inclusive rate, retail price, FED per ton | Rates change over time. Keeping history lets the 14-day rate lock and OC re-pricing compare old and new rates, and old invoices stay correct |
| SD\_TAX\_RATE | Sales tax %, FED per ton and withholding % (by filer status) with effective dates | Government rates change by budget. A table means a rate change is a new row, not a code release |
| SD\_BANK | Banks and deposit/fund accounts | BRVs record the paying bank and the company's deposit account; ledger narration shows the bank |

**Masters: system**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_USER\_ROLE | Which user holds which role: Sales, Finance, CFO, authorised customer approver, dispatch | Approvals depend on role (CFO for higher permits, authorised user for customers) |
| SD\_CONFIG | Settings: DO validity 14 days, print text "48 hours" | These values differ between system rule and print, and may change by policy. Settings avoid code changes |
| SD\_AUDIT\_LOG | Who approved, edited, cancelled or adjusted which document, when and why | Today cancellation is written by hand on paper. The new system must prove every change |

**DO route**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_SRF | Sales Request Form: what the customer wants (product, qty, terms, export refs, instructions) | First document of the DO route, created by marketing/sales before any price or payment |
| SD\_SRF\_SCHEDULE | Date-wise quantity lines of the SRF | One SRF can be lifted on several dates; schedule lines repeat, so they need their own table |
| SD\_OC | Order Confirmation: price breakdown, net value, approval and confirmation | Holds the commercial terms. It links to the exact SD\_PRICE\_RATE used, so the price on the OC never changes silently |
| SD\_OC\_SCHEDULE | Confirmed date-wise quantities of the OC | Each schedule line becomes one DO. It is copied from the SRF schedule but can be changed by Sales/Finance |
| SD\_BRV | Bank Receipt Voucher: each customer payment with instrument, cheque status and bank verification | Payment is the gate for OC confirmation. Verification fields (who, when, how) replace today's phone check with a record |
| SD\_OC\_BRV | Link between OCs and the BRVs that pay them, with amount applied | One OC can be paid by several receipts, and one receipt can fund several OCs (many-to-many) |
| SD\_OC\_REPRICE | Record of a rate increase on an open OC: old rate, new rate, shortfall, action (collect or cancel) | The rule "collect extra or cancel" needs a trail of what changed and what sales decided |
| SD\_DO | Delivery Order: one per OC schedule line, with DO type, qty, rate lock date and dispatched qty | The DO authorises lifting. dispatched\_ton tracks partial dispatch and blocks over-dispatch |

**Permit route**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_PERMIT | Direct permit: customer, product, validity, total qty and value, CFO approval | Permits skip SRF/OC, so the permit carries its own approval and balance check |
| SD\_PERMIT\_AREA | Area-wise split of the permit: qty, city rate, amount, dispatched and balance | Each area has its own rate and quantity, and dispatch is tracked per area |

**Dispatch and accounts**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_DC | Delivery Challan header: vehicle, bilty, destination, packing, bag brand, container/seal for export | One DC = one vehicle trip. Saving it triggers the invoice and ledger posting |
| SD\_DC\_LINE | Lines of a DC: each points to one DO or one permit area, with tons and bags | The sample DC lifts 4 DOs in one vehicle. Lines allow that, and the check "exactly one source" stops a line from pointing to both |
| SD\_INVOICE | Sales tax invoice for one DC line, i.e. one DO: value, FED, ST on retail price, WHT, total collectable, retention per ton | Invoice figures are stored, not recalculated later, so a later tax-rate change does not alter old invoices |
| SD\_CUSTOMER\_LEDGER | All debit/credit entries per customer, typed DO-based or DC-based | Both ledgers have the same columns. source\_type + source\_id point to the BRV, DO, permit, invoice or cancellation behind each line |
| SD\_DOC\_CANCELLATION | Every cancelled OC, DO or permit with reason, user and amount returned to balance | Replaces the hand-written "Cancelled". The returned amount feeds the ledger |

**Slots (dashed)**

| Table | Planned purpose | Why it is only a slot |
| --- | --- | --- |
| SD\_GATE\_PASS | Gate in/out, driver, weighbridge weights for a DC | Not known whether these are captured |
| SD\_SALES\_RETURN | Sales return and credit note against an invoice/DC | Phase 2 |
| SD\_FBR\_SUBMISSION | FBR Digital Invoicing submission status and FBR invoice number | Phase 2 |
| SD\_BAG\_SUPPLIER | Master list of bag suppliers/brands (e.g. Paper Bags Pakland, Lion Blue) | Today it is free text on the DC; a master is needed only if reports use it |

**Added 22 Oct**

| Table | Purpose | Why it is designed this way |
| --- | --- | --- |
| SD\_CUSTOMER\_SECURITY | Security deposit lines per customer: description, amount | The security tab is a grid; the total feeds the S.D column of report R7 |
| SD\_PRINT\_TEXT | Standard clause texts for printed documents (e.g. Contract Review Form: delivery time, payment, validity, packing, escalation) per branch | Clauses change by policy; keeping them as data avoids code changes and keeps each branch's wording |

## Appendix B. Class diagram (backend services)

The backend (FastAPI) models seven documents on one SalesDocument base class, so numbering, status, approval, cancellation and audit are written once. Business rules live in services, not in screens.

&#91;embedded content: Class diagram · documents, parts, masters, services and future slots\]

| Service | Rule it enforces |
| --- | --- |
| BalanceService | OC confirmation and permit issue only when ledger balance covers the value |
| PricingService | Rate by price code and date; re-pricing shows the shortfall; retail price never above MRP |
| TaxCalculator | ST 18% on retail price, FED per ton, WHT by filer status |
| DispatchService | Saving a DC posts one invoice per DO line and the ledger in one transaction; blocks over-dispatch |
| ApprovalService | OC approval, CFO approval when the user sends a permit, customer approval by authorised users |
| NumberingService | Per-plant numbers with the .1 / .2 suffix |
| LedgerService | DO-based and DC-based ledger entries and balances |

Dashed classes match the dashed ERD slots in Appendix A.3 and will be filled in as those questions are answered.
