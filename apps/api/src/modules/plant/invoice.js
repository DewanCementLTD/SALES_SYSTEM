// Invoice finalisation (BUSINESS_RULES BR-INV-01/03, BR-TAX, BR-LED; TASKS P3-06). After the gross
// is OK (or the variance override is approved) every DC line gets its invoice in ONE transaction:
// invoice number from DOC_SEQUENCE INV (gap-free, consecutive for the DC), tax from the shared
// calculator on the invoice quantity (INVOICE_QTY_BASIS: allocated net weight or planned bags),
// DO dispatched quantity, DC ledger (Dr sale proceeds, Dr WHT), DO-ledger dispatch memo, legacy
// DC columns, outbox FBR_SUBMIT. All inputs are read and checked before the first write, so a
// missing master (rate, product period, WHT rate) leaves the gate pass at GROSS_DONE with the
// problem shown, and finalisation can be retried.
//
// Defaults to confirm (gate report): invoice rate per ton = the DO rate (DO_RATE, the rate the
// DO ledger was debited with); WHT rate = TAX_RATE general section '-' for the customer's filer
// status.
import { businessDate, dec, fiscalYearOf, invoiceQtyTon, invoiceTax, narration } from '@dcl/shared';
import { AppError, Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { getDo } from '../do/service.js';
import * as ledger from '../ledger/service.js';
import { nextNumber } from '../numbering/service.js';
import { enqueue } from '../outbox/service.js';
import { effectivePeriod } from '../pricing/service.js';
import { SettingsReader } from '../settings/service.js';
import { effectiveRate } from '../tax/service.js';
import { getGatePass } from './gate.js';

const FINALISABLE = ['GROSS_DONE', 'OVERRIDDEN'];

/** Everything an invoice needs, checked; throws a 422 naming what is missing. */
async function prepare(tx, gp, today) {
  if (gp.route !== 'DO')
    throw Errors.invalidState('Invoices for permits come with the delivery-memo mapping');
  const basis = (await new SettingsReader(tx).get(gp.brnch, 'INVOICE_QTY_BASIS')) ?? 'NET_WEIGHT';
  const c = await tx.one(
    `SELECT CUSTOMER_NAME, CUSTOMER_ADDRESS1, CUSTOMER_ADDRESS2, NTN, SALES_TAX_NO, CNIC, SALES_TAX_TYPE,
            INCOM_TAX_STATS FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: gp.brnch, c: gp.customerCode },
  );
  if (!c) throw Errors.notFound(`Customer ${gp.customerCode}`);
  const filer = c.INCOM_TAX_STATS ?? 'N';
  const wht = await effectiveRate(tx, {
    brnch: gp.brnch,
    filerStatus: filer,
    section: '-',
    date: today,
  });
  if (!wht)
    throw Errors.rule(
      'BR-TAX-05',
      `No approved withholding tax rate for ${filer === 'F' ? 'filers' : filer === 'E' ? 'exempt buyers' : 'non-filers'} on ${today} (Masters › Tax rates)`,
    );
  const periods = new Map();
  const lines = [];
  for (const l of gp.lines) {
    const d = await getDo(tx, gp.brnch, l.doType, l.doNo, { forUpdate: true });
    if (d.rate === null)
      throw Errors.rule('BR-INV-01', `DO ${d.doNo} has no rate: it cannot be invoiced`);
    if (!periods.has(d.productCode))
      periods.set(d.productCode, await effectivePeriod(tx, gp.brnch, d.productCode, today));
    const per = periods.get(d.productCode);
    if (!per?.mrp || per.salesTaxPer === null)
      throw Errors.rule(
        'BR-TAX-10',
        `No product period with MRP and sales tax % for ${d.productCode} on ${today}`,
      );
    const qtyTon = invoiceQtyTon({
      basis,
      allocNetKg: l.allocNetKg ?? 0,
      plannedTon: l.plannedTon,
    });
    if (dec(qtyTon).lte(0)) throw Errors.rule('BR-INV-01', `DO ${d.doNo}: nothing to invoice`);
    const tax = invoiceTax({
      qtyTon,
      mrpPerTon: per.mrp,
      stPct: per.salesTaxPer,
      fedPerTon: per.fedPerTon,
      ratePerTon: d.rate,
      whtPct: wht.ratePct,
    });
    lines.push({ line: l, d, tax, basis, fedPerTon: per.fedPerTon });
  }
  return { customer: c, filer, wht, lines };
}

/**
 * Finalise the invoices of a weighed gate pass. Returns the invoices.
 * @param {{ usrid: string, now: Date, audit: object }} actor
 */
export async function finalise(tx, actor, gpId) {
  const lock = await tx.one('SELECT GP_ID FROM GATE_PASS WHERE GP_ID = :id FOR UPDATE', {
    id: gpId,
  });
  if (!lock) throw Errors.notFound(`Gate pass ${gpId}`);
  const gp = await getGatePass(tx, gpId);
  if (!FINALISABLE.includes(gp.status))
    throw Errors.invalidState(`Gate pass ${gp.gpId} is ${gp.status}: nothing to invoice`);
  const today = businessDate(actor.now);
  let p;
  try {
    p = await prepare(tx, gp, today);
  } catch (e) {
    e.beforeWrites = true; // nothing written yet: the caller may keep the weighing and show this
    throw e;
  }

  const year = fiscalYearOf(actor.now);
  const day = new Date(`${today}T00:00:00+05:00`);
  const invoices = [];
  for (const { line, d, tax, basis, fedPerTon } of p.lines) {
    const invoiceId = await tx.nextId('SEQ_SALES_INVOICE');
    const invoiceNo = Number(await nextNumber(tx, { brnch: gp.brnch, year, docType: 'INV' }));
    await tx.exec(
      `INSERT INTO SALES_INVOICE (INVOICE_ID, BRNCH, COMPC, INVOICE_YEAR, INVOICE_NO, INVOICE_DATE, STATUS,
         GP_ID, SRC_KIND, DC_TYPE, DC_NO, DO_NO, OC_NO, CUSTOMER_CODE, PRODUCT_CODE, PRICE_CODE, QTY_BASIS,
         QTY_TON, BAGS, RATE_INCL, RETAIL_VALUE_EXCL, FED_PER_TON, FED_AMT, RETAIL_VALUE, ST_PCT, ST_AMT,
         FURTHER_TAX_PCT, FURTHER_TAX_AMT, MARKET_VALUE, SALE_PROCEEDS, VALUE_EXCL, RATE_EXCL, WHT_PCT,
         WHT_AMT, TOTAL_COLLECTABLE, BUYER_NAME, BUYER_ADDRESS, BUYER_NTN, BUYER_STRN, BUYER_CNIC,
         BUYER_ST_TYPE, BUYER_FILER, DEST_AREA, VEHICLE_NO, CREATED_BY, CREATED_ON, ROW_VER)
       VALUES (:id, :b, 1, :y, :no, :d, 'FINAL', :gp, 'DC', :dct, :dc, :do, :oc, :c, :p, :pc, :basis,
         :q, :bags, :rate, :rexcl, :fedt, :fed, :rv, :stp, :st, 0, 0, :mv, :sp, :vx, :rx, :whp, :wh, :tot,
         :bn, :ba, :ntn, :strn, :cnic, :stt, :fil, :da, :veh, :u, :now, 1)`,
      {
        id: invoiceId,
        b: gp.brnch,
        y: year,
        no: invoiceNo,
        d: day,
        gp: gp.gpId,
        dct: gp.dcType,
        dc: gp.dcNo,
        do: d.doNo,
        oc: d.ocNo,
        c: gp.customerCode,
        p: d.productCode,
        pc: d.priceCode,
        basis,
        q: tax.qtyTon,
        bags: line.plannedBags,
        rate: tax.ratePerTon,
        rexcl: tax.retailExcl,
        fedt: fedPerTon,
        fed: tax.fed,
        rv: tax.retailValue,
        stp: tax.stPct,
        st: tax.salesTax,
        mv: tax.taxInclusiveValue,
        sp: tax.saleProceeds,
        vx: tax.valueExcl,
        rx: tax.rateExclPerTon,
        whp: tax.whtPct,
        wh: tax.wht,
        tot: tax.totalCollectable,
        bn: p.customer.CUSTOMER_NAME ?? null,
        ba:
          [p.customer.CUSTOMER_ADDRESS1, p.customer.CUSTOMER_ADDRESS2]
            .filter(Boolean)
            .join(', ')
            .slice(0, 250) || null,
        ntn: p.customer.NTN ?? null,
        strn: p.customer.SALES_TAX_NO ?? null,
        cnic: p.customer.CNIC ?? null,
        stt: p.customer.SALES_TAX_TYPE ?? null,
        fil: p.filer,
        da: gp.destArea,
        veh: gp.vehicleNo,
        u: actor.usrid,
        now: actor.now,
      },
    );
    await tx.exec(
      `UPDATE FH_DEL_CHALLAN_DETAIL SET INVOICE_ID = :inv, LINE_STATUS = 'INVOICED', VALUE = :v
        WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n AND DCD_SNO = :sr`,
      { inv: invoiceId, v: tax.saleProceeds, b: gp.brnch, t: gp.dcType, n: gp.dcNo, sr: line.srNo },
    );
    // BR-DO-04: dispatched quantity; DISPATCHED when nothing is left
    const dispatched = dec(d.dispatchedTon).plus(dec(tax.qtyTon));
    await tx.exec(
      `UPDATE DELIVERY_ORDER SET DISPATCHED_TON = :dt, DISPATCHED = :dr, DOC_STATUS = :st,
         ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
        WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n`,
      {
        dt: dispatched.toFixed(3),
        dr: dispatched.toDecimalPlaces(2).toNumber(),
        st: dispatched.gte(dec(d.qtyTon)) ? 'DISPATCHED' : 'PARTLY_DISPATCHED',
        u: actor.usrid,
        now: actor.now,
        b: gp.brnch,
        t: d.doType,
        n: d.doNo,
      },
    );
    // BR-LED: DC ledger Dr proceeds + Dr WHT; DO ledger memo of the dispatched quantity
    const base = {
      brnch: gp.brnch,
      customerCode: gp.customerCode,
      entryDate: today,
      docType: 'INV',
      docYear: year,
      docNo: String(invoiceNo),
      qtyTon: tax.qtyTon,
    };
    await ledger.post(tx, actor, [
      {
        ...base,
        ledgerType: 'DC',
        entryKind: 'SALE',
        narration: narration.invoice({
          dcNo: gp.dcNo,
          invoiceNo,
          qtyTon: tax.qtyTon,
          rate: tax.ratePerTon,
        }),
        debit: tax.saleProceeds,
      },
      ...(dec(tax.wht).gt(0)
        ? [
            {
              ...base,
              ledgerType: 'DC',
              entryKind: 'WHT',
              narration: narration.wht({ invoiceNo, section: null, ratePct: p.wht.ratePct }),
              debit: tax.wht,
            },
          ]
        : []),
      {
        ...base,
        ledgerType: 'DO',
        entryKind: 'MEMO',
        narration: narration.invoice({
          dcNo: gp.dcNo,
          invoiceNo,
          qtyTon: tax.qtyTon,
          rate: tax.ratePerTon,
        }),
      },
    ]);
    // BR-INV-02: FBR submission by the worker (P3-07)
    await enqueue(tx, {
      brnch: gp.brnch,
      eventType: 'FBR_SUBMIT',
      aggregateType: 'SALES_INVOICE',
      aggregateKey: String(invoiceId),
      channel: 'JOB',
      dedupKey: `FBR_SUBMIT|${invoiceId}`,
      payload: { invoiceId },
      now: actor.now,
    });
    invoices.push({ invoiceId, invoiceNo: String(invoiceNo), doNo: d.doNo, ...tax });
  }
  await tx.exec(
    `UPDATE FH_DELIVERY_CHALLAN SET INVOICE_NO = :inv, INVOICE_DATE = :d, DOC_STATUS = 'INVOICED',
       UPDATED_BY = :u, UPDATED_ON = :now
      WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n`,
    {
      inv: Number(invoices[0].invoiceNo),
      d: day,
      u: actor.usrid,
      now: actor.now,
      b: gp.brnch,
      t: gp.dcType,
      n: gp.dcNo,
    },
  );
  const n = await tx.exec(
    `UPDATE GATE_PASS SET STATUS = 'INVOICED', ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
      WHERE GP_ID = :id AND ROW_VER = :rv`,
    { u: actor.usrid, now: actor.now, id: gp.gpId, rv: gp.rowVer },
  );
  if (n !== 1) throw Errors.versionConflict();
  await recordAudit(tx, actor.audit, {
    entity: 'GATE_PASS',
    key: String(gp.gpId),
    action: 'INVOICE',
    brnch: gp.brnch,
    newValues: {
      invoices: invoices.map((i) => ({
        invoiceNo: i.invoiceNo,
        doNo: i.doNo,
        qtyTon: i.qtyTon,
        saleProceeds: i.saleProceeds,
      })),
    },
  });
  return invoices;
}

/**
 * Finalise right after the weighing (BR-INV-01). A missing master (checked before any write) does
 * not undo the weighing: the gate pass stays GROSS_DONE / OVERRIDDEN with `invoiceProblem`.
 */
export async function tryFinalise(tx, actor, gpId) {
  try {
    return { invoices: await finalise(tx, actor, gpId), invoiceProblem: null };
  } catch (e) {
    if (!e.beforeWrites || !(e instanceof AppError)) throw e;
    return {
      invoices: [],
      invoiceProblem: { code: e.code, detail: e.detail, ruleId: e.ruleId ?? null },
    };
  }
}

/** Invoices of a gate pass. */
export async function invoicesOf(tx, gpId) {
  const rows = await tx.many(
    `SELECT INVOICE_ID, INVOICE_NO, INVOICE_DATE, STATUS, DO_NO, QTY_TON, RATE_INCL, SALE_PROCEEDS, ST_AMT, VALUE_EXCL,
            FED_AMT, WHT_AMT, TOTAL_COLLECTABLE, FBR_INVOICE_NO
       FROM SALES_INVOICE WHERE GP_ID = :g ORDER BY INVOICE_NO`,
    { g: gpId },
  );
  return rows.map((r) => ({
    invoiceId: Number(r.INVOICE_ID),
    invoiceNo: String(r.INVOICE_NO),
    invoiceDate: businessDate(r.INVOICE_DATE),
    status: r.STATUS,
    doNo: r.DO_NO === null ? null : String(r.DO_NO),
    qtyTon: dec(r.QTY_TON).toFixed(3),
    ratePerTon: dec(r.RATE_INCL).toFixed(2),
    saleProceeds: dec(r.SALE_PROCEEDS).toFixed(2),
    salesTax: dec(r.ST_AMT).toFixed(2),
    valueExcl: dec(r.VALUE_EXCL).toFixed(2),
    fed: dec(r.FED_AMT).toFixed(2),
    wht: dec(r.WHT_AMT).toFixed(2),
    totalCollectable: dec(r.TOTAL_COLLECTABLE).toFixed(2),
    fbrInvoiceNo: r.FBR_INVOICE_NO ?? null,
  }));
}
