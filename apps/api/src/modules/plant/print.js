// DC details and print data (BUSINESS_RULES BR-DC-03, BR-EXIT-01, BR-QR-04; TASKS P3-11).
import { businessDate, dec } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { SettingsReader } from '../settings/service.js';
import { printTexts } from '../texts/service.js';
import { getGatePass } from './gate.js';
import { invoicesOf } from './invoice.js';

/**
 * PUT /plant/gate-passes/{gpId}/dc (dc.update, BR-DC-03): bag supplier and type, container and
 * seal (exports), remarks — before the invoices are made.
 */
export async function updateDc(tx, actor, gpId, body) {
  const lock = await tx.one('SELECT GP_ID FROM GATE_PASS WHERE GP_ID = :id FOR UPDATE', {
    id: gpId,
  });
  if (!lock) throw Errors.notFound(`Gate pass ${gpId}`);
  const gp = await getGatePass(tx, gpId);
  if (!gp.dcNo) throw Errors.invalidState('This gate pass has no DC');
  if (!['IN', 'TARE_DONE', 'GROSS_DONE', 'VARIANCE_BLOCKED', 'OVERRIDDEN'].includes(gp.status))
    throw Errors.invalidState(`Gate pass ${gp.gpId} is ${gp.status}: the DC can no longer change`);
  if (body.bagsId !== undefined && body.bagsId !== null) {
    const bag = await tx.one(
      `SELECT BAG_CD FROM BAG WHERE BRNCH = :b AND BAG_CD = :c AND NVL(ACTIVE, 'Y') = 'Y'`,
      { b: gp.brnch, c: body.bagsId },
    );
    if (!bag) throw Errors.validation(`Bag type ${body.bagsId} is not in the list`);
  }
  await tx.exec(
    `UPDATE FH_DELIVERY_CHALLAN SET BAG_SUPPLIER = :sup, BAGS_ID = :bag, CONTAINER_NO = :cont,
       SEAL_NO = :seal, NEW_REMARKS = :rem, ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
      WHERE BRNCH = :b AND DC_TYPE = :t AND DC_NO = :n`,
    {
      sup: body.bagSupplier ?? null,
      bag: body.bagsId ?? null,
      cont: body.containerNo ?? null,
      seal: body.sealNo ?? null,
      rem: body.remarks ?? null,
      u: actor.usrid,
      now: actor.now,
      b: gp.brnch,
      t: gp.dcType,
      n: gp.dcNo,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'FH_DELIVERY_CHALLAN',
    key: `${gp.brnch}|${gp.dcType}|${gp.dcNo}`,
    action: 'UPDATE',
    brnch: gp.brnch,
    newValues: body,
  });
  return dcDetails(tx, gp);
}

export async function dcDetails(tx, gp) {
  const r = await tx.one(
    `SELECT d.BAG_SUPPLIER, d.BAGS_ID, b.BAG_DESC, d.CONTAINER_NO, d.SEAL_NO, d.NEW_REMARKS, d.DC_DATE
       FROM FH_DELIVERY_CHALLAN d LEFT JOIN BAG b ON b.BRNCH = d.BRNCH AND b.BAG_CD = d.BAGS_ID
      WHERE d.BRNCH = :b AND d.DC_TYPE = :t AND d.DC_NO = :n`,
    { b: gp.brnch, t: gp.dcType, n: gp.dcNo },
  );
  return {
    bagSupplier: r?.BAG_SUPPLIER ?? null,
    bagsId: r?.BAGS_ID === null || r?.BAGS_ID === undefined ? null : Number(r.BAGS_ID),
    bagDesc: r?.BAG_DESC ?? null,
    containerNo: r?.CONTAINER_NO ?? null,
    sealNo: r?.SEAL_NO ?? null,
    remarks: r?.NEW_REMARKS ?? null,
    dcDate: r?.DC_DATE ? businessDate(r.DC_DATE) : null,
  };
}

/** DC + gate pass print (QR = gate pass for the exit scan, BR-EXIT-01). */
export async function dcPrintData(tx, gpId) {
  const gp = await getGatePass(tx, gpId);
  if (!gp.dcNo) throw Errors.invalidState('This gate pass has no DC');
  const lines = [];
  for (const l of gp.lines) {
    const d = await tx.one(
      `SELECT NVL(d.PRODUCT_CODE, t.PRODUCT_CODE) AS PRODUCT_CODE, t.DO_DESC
         FROM DELIVERY_ORDER d LEFT JOIN DELIVERY_ORDER_TYPE t ON t.BRNCH = d.BRNCH AND t.DO_CODE = d.DO_TYPE
        WHERE d.BRNCH = :b AND d.DO_TYPE = :t AND d.DEL_ORDER_NO = :n`,
      { b: gp.brnch, t: l.doType, n: l.doNo },
    );
    lines.push({
      ...l,
      productCode: d?.PRODUCT_CODE ?? null,
      doTypeName: d?.DO_DESC ?? null,
      tons: l.allocNetKg !== null ? dec(l.allocNetKg).dividedBy(1000).toFixed(3) : l.plannedTon,
    });
  }
  const c = await tx.one(
    `SELECT CUSTOMER_NAME, CUSTOMER_ADDRESS1, CUSTOMER_ADDRESS2 FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: gp.brnch, c: gp.customerCode },
  );
  const city = gp.destArea
    ? await tx.one(
        `SELECT MIN(CITY_NAME) AS N FROM GEO_HIERARCHY WHERE BRNCH = :b AND LEGACY_CODE = :c`,
        { b: gp.brnch, c: gp.destArea },
      )
    : null;
  return {
    brnch: gp.brnch,
    gatePass: gp,
    lines,
    dc: await dcDetails(tx, gp),
    customer: {
      code: gp.customerCode,
      name: c?.CUSTOMER_NAME ?? gp.customerName,
      address: [c?.CUSTOMER_ADDRESS1, c?.CUSTOMER_ADDRESS2].filter(Boolean).join(', ') || null,
    },
    destination: gp.destArea ? `${gp.destArea} ${city?.N ?? ''}`.trim() : null,
    invoices: await invoicesOf(tx, gp.gpId),
    terms: await printTexts(tx, gp.brnch, 'DC_TERMS'),
  };
}

/** Commercial / Excise / Sales Tax Invoice print data (stored figures only, BR-TAX-08). */
export async function invoicePrintData(tx, invoiceId) {
  const i = await tx.one(
    `SELECT i.*, TO_CHAR(i.DO_NO) AS DO_NO_S FROM SALES_INVOICE i WHERE i.INVOICE_ID = :id`,
    { id: invoiceId },
  );
  if (!i) throw Errors.notFound('Invoice');
  const b = Number(i.BRNCH);
  const s = new SettingsReader(tx);
  const n = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
  return {
    brnch: b,
    seller: {
      name: (await s.get(b, 'FBR_SELLER_NAME')) || 'Dewan Cement Limited',
      ntn: await s.get(b, 'FBR_SELLER_NTN'),
      strn: await s.get(b, 'FBR_SELLER_STRN'),
      address: await s.get(b, 'FBR_SELLER_ADDRESS'),
    },
    invoice: {
      invoiceId: Number(i.INVOICE_ID),
      invoiceNo: String(i.INVOICE_NO),
      invoiceDate: businessDate(i.INVOICE_DATE),
      status: i.STATUS,
      dcType: i.DC_TYPE,
      dcNo: i.DC_NO === null ? null : String(i.DC_NO),
      doNo: i.DO_NO_S ?? null,
      vehicleNo: i.VEHICLE_NO,
      productCode: i.PRODUCT_CODE,
      priceCode: i.PRICE_CODE,
      destArea: i.DEST_AREA,
      buyer: {
        code: i.CUSTOMER_CODE,
        name: i.BUYER_NAME,
        address: i.BUYER_ADDRESS,
        ntn: i.BUYER_NTN,
        strn: i.BUYER_STRN,
        cnic: i.BUYER_CNIC,
      },
      qtyTon: dec(i.QTY_TON).toFixed(3),
      bags: i.BAGS === null ? null : Number(i.BAGS),
      ratePerTon: n(i.RATE_INCL),
      retailExcl: n(i.RETAIL_VALUE_EXCL),
      fed: n(i.FED_AMT),
      fedPerTon: n(i.FED_PER_TON),
      retailValue: n(i.RETAIL_VALUE),
      stPct: dec(i.ST_PCT).toString(),
      salesTax: n(i.ST_AMT),
      taxInclusiveValue: n(i.MARKET_VALUE),
      saleProceeds: n(i.SALE_PROCEEDS),
      valueExcl: n(i.VALUE_EXCL),
      rateExclPerTon: n(i.RATE_EXCL),
      whtPct: dec(i.WHT_PCT).toString(),
      wht: n(i.WHT_AMT),
      totalCollectable: n(i.TOTAL_COLLECTABLE),
      fbrInvoiceNo: i.FBR_INVOICE_NO ?? null,
      fbrQrData: i.FBR_QR_DATA ?? null,
    },
  };
}
