// Draft OC builder (BR-SRF-05, BR-OC-01, TASKS P2-02): on SRF submit, one DRAFT OC is created in
// the same transaction with customer, product, quantity, schedule, tax profile, destination and
// the prices of the effective trade price (customer + product + destination city, on the order
// date). MASTER_PRICES keeps the master values so later edits are flagged as overrides (BR-OC-02).
import { businessDate, fiscalYearOf, masterPricesFrom, ocBreakdown } from '@dcl/shared';
import { recordAudit } from '../audit/service.js';
import { nextNumber } from '../numbering/service.js';
import { effectiveTradePrice } from '../pricing/service.js';

const toDate = (iso) => new Date(`${iso}T00:00:00+05:00`);

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ usrid: string, now: Date, audit: any }} actor
 * @param {ReturnType<typeof import('../srf/repo.js').mapSrf> & { schedule: { srNo: number, date: string, qtyTon: string }[] }} srf
 * @returns {Promise<{ ocNo: string, priced: boolean, priceCode: string|null, value: string }>}
 */
export async function createDraftOc(tx, actor, srf) {
  const orderDate = businessDate(actor.now);
  const tp = await effectiveTradePrice(tx, {
    brnch: srf.brnch,
    customerCode: srf.customerCode,
    productCode: srf.productCode,
    geoCode: srf.destGeoCode,
    date: orderDate,
  });
  const master = masterPricesFrom(tp);
  const b = ocBreakdown(master, srf.qtyTon);
  const year = fiscalYearOf(actor.now);
  const ocNo = await nextNumber(tx, { brnch: srf.brnch, year, docType: 'OC' });
  await tx.exec(
    `INSERT INTO ORDER_CONFIRM (ORDER_NO, SRF_NO, BRNCH, COMPC, YEAR, CUSTOMER_CODE, PRODUCT_CODE,
       ORDER_DATE, QUANTITY, AREA_CODE, DEST_GEO_CODE, RETAIL_PRICE, TRADE_DISC, GROSS_PRICE,
       SALES_TAX, CED, CONS_PRICE, EXPENSE, DISCOUNT, NET_BOOK_PRICE, TOT_NET, OC_VALUE, REMARKS,
       SALES_TAX_TYPE, PRICE_OVERRIDE, MASTER_PRICES, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON,
       ENTER_BY, ENTER_DATE)
     VALUES (:oc, :srf, :b, 1, :y, :cu, :pr, :od, :qty, :pc, :geo, :rp, :td, :tdp, :st, :fed, :cp,
       :ex, :di, :np, :tot, :tot, :rem, :stt, 'N', :mp, 'DRAFT', 1, :usr, :now, :usr10, :now)`,
    {
      oc: ocNo,
      srf: srf.srfNo,
      b: srf.brnch,
      y: year,
      cu: srf.customerCode,
      pr: srf.productCode,
      od: toDate(orderDate),
      qty: srf.qtyTon,
      pc: master?.priceCode ?? null,
      geo: srf.destGeoCode,
      rp: b.retailPrice,
      td: b.tradeDisc,
      tdp: b.tradeDiscPrice,
      st: b.salesTax,
      fed: b.fed,
      cp: b.consPrice,
      ex: b.expense,
      di: b.discount,
      np: b.netPrice,
      tot: b.value,
      rem: srf.specialInstructions ?? srf.remarks ?? null,
      stt: srf.taxProfile?.stType ?? null,
      mp: master ? JSON.stringify(master) : null,
      usr: actor.usrid,
      usr10: actor.usrid.slice(0, 10),
      now: actor.now,
    },
  );
  for (const l of srf.schedule) {
    await tx.exec(
      `INSERT INTO ORDER_CONFIRM_DETAIL (SR_NO, ORDER_NO, SCH_DATE, QUANTITY, ORDER_DATE, SRF_NO, COMPC, BRNCH)
       VALUES (:sr, :oc, :d, :q, :od, :srf, 1, :b)`,
      {
        sr: l.srNo,
        oc: ocNo,
        d: toDate(l.date),
        q: l.qtyTon,
        od: toDate(orderDate),
        srf: srf.srfNo,
        b: srf.brnch,
      },
    );
  }
  await recordAudit(tx, actor.audit, {
    entity: 'ORDER_CONFIRM',
    key: `${srf.brnch}|${ocNo}`,
    action: 'CREATE',
    brnch: srf.brnch,
    newValues: { fromSrf: srf.srfNo, priceCode: master?.priceCode ?? null, value: b.value },
  });
  return { ocNo, priced: !!master, priceCode: master?.priceCode ?? null, value: b.value };
}

/** OC status (legacy rows: CANCEL_CODE 'Y' = cancelled, APPROVED 'Y' = confirmed). */
export const OC_STATUS_SQL = `NVL(o.DOC_STATUS, CASE WHEN o.CANCEL_CODE = 'Y' THEN 'CANCELLED'
  WHEN o.APPROVED = 'Y' THEN 'CONFIRMED' ELSE 'DRAFT' END)`;

/** Cancel an OC row (status + reason + legacy CANCEL_CODE; never deleted). */
export async function cancelOcRow(tx, actor, { brnch, ocNo, reason }) {
  await tx.exec(
    `UPDATE ORDER_CONFIRM SET DOC_STATUS = 'CANCELLED', CANCEL_CODE = 'Y', CANCEL_REASON = :r,
       CANCELLED_BY = :usr, CANCELLED_ON = :now, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr,
       UPDATED_ON = :now
     WHERE BRNCH = :b AND ORDER_NO = :oc`,
    { b: brnch, oc: ocNo, r: reason, usr: actor.usrid, now: actor.now },
  );
  await recordAudit(tx, actor.audit, {
    entity: 'ORDER_CONFIRM',
    key: `${brnch}|${ocNo}`,
    action: 'CANCEL',
    brnch,
    reason,
  });
}
