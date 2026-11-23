// Gate document checks (TASKS P3-03; BR-GATE-01, BR-QR-02/03, BR-OFF-02).
// - scan: signed QR → document card, refused with the reason when forged, from the other plant,
//   replaced by a newer print, on hold, cancelled or fully dispatched.
// - lookup: by number without a QR (gate.manual_lookup, reason required and audited, BR-AUD-02).
// - offline cache: open documents of the branch with what the tablet needs to check a QR offline;
//   each entry carries its expected QR signature, so the secret never leaves the server.
import { createHash } from 'node:crypto';
import { QR_REASONS, dec, gateCheck, qrSignature, verifyQr } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { DO_STATUS_SQL, getDo } from '../do/service.js';
import { PERMIT_STATUS_SQL, getPermit } from '../permits/service.js';

const qrDocNoOfDo = (d) => `${d.doType}-${d.doNo}`;

function doCard(d) {
  return {
    docType: 'DO',
    docNo: qrDocNoOfDo(d),
    brnch: d.brnch,
    ver: d.qrVer ?? 1,
    status: d.status,
    doType: d.doType,
    doNo: d.doNo,
    ocNo: d.ocNo,
    customerCode: d.customerCode,
    customerName: d.customerName,
    productCode: d.productCode,
    destName: d.destName,
    qtyType: d.qtyType,
    qtyTon: d.qtyTon,
    dispatchedTon: d.dispatchedTon,
    remainingTon: d.remainingTon,
    holdReason: d.holdReason,
    areas: [],
  };
}

function permitCard(p) {
  const areas = p.areas
    .filter((a) => a.status !== 'CANCELLED')
    .map((a) => ({
      lnkno: a.lnkno,
      areaDoc: a.areaDoc,
      areaName: a.areaName,
      qtyTon: a.qtyTon,
      remainingTon: a.balanceTon,
    }));
  return {
    docType: 'PMT',
    docNo: p.permitNo,
    brnch: p.brnch,
    ver: p.qrVer ?? 1,
    status: p.status,
    permitNo: p.permitNo,
    customerCode: p.customerCode,
    customerName: p.customerName,
    productCode: p.productCode,
    destName: areas.length === 1 ? areas[0].areaName : `${areas.length} areas`,
    qtyTon: p.qtyTon,
    remainingTon: areas.reduce((s, a) => s.plus(dec(a.remainingTon ?? 0)), dec(0)).toFixed(3),
    holdReason: null,
    areas,
  };
}

/** Card of a document named as in its QR (DO: `TYPE-NO`; permit: `NO.B`), or null. */
async function cardOf(tx, brnch, docType, docNo) {
  try {
    if (docType === 'DO') {
      const [t, n] = String(docNo).split('-');
      return doCard(await getDo(tx, brnch, t, n));
    }
    if (docType === 'PMT') return permitCard(await getPermit(tx, brnch, docNo));
  } catch (e) {
    if (e.code === 'not_found') return null;
    throw e;
  }
  return null;
}

const refuse = (reason, ruleId, extra = {}) =>
  Errors.rule(ruleId, QR_REASONS[reason], { reason, ...extra });

/** POST /plant/scan */
export async function scan(tx, { qrSecret, plantBrnch }, payload) {
  const v = await verifyQr(payload, qrSecret);
  if (!v.ok) throw refuse(v.reason, 'BR-QR-02');
  if (!['DO', 'PMT'].includes(v.doc.docType))
    throw Errors.validation(`A ${v.doc.docType} QR is not a loading document`);
  const card =
    v.doc.brnch === plantBrnch ? await cardOf(tx, v.doc.brnch, v.doc.docType, v.doc.docNo) : null;
  const res = gateCheck(v.doc, card, plantBrnch);
  if (!res.ok) throw refuse(res.reason, res.ruleId, card ? { card } : {});
  return card;
}

/** POST /plant/lookup: manual search by number (BR-GATE-01), audited with the reason. */
export async function lookup(tx, ctx, plantBrnch, { docType, docNo, reason }) {
  let items = [];
  if (docType === 'DO') {
    const no = String(docNo).replace(/^[A-Z0-9]+-/, '');
    const rows = await tx.many(
      'SELECT DO_TYPE FROM DELIVERY_ORDER WHERE BRNCH = :b AND DEL_ORDER_NO = :n',
      { b: plantBrnch, n: no },
    );
    for (const r of rows) items.push(doCard(await getDo(tx, plantBrnch, r.DO_TYPE, no)));
  } else {
    const card = await cardOf(tx, plantBrnch, 'PMT', docNo);
    items = card ? [card] : [];
  }
  await recordAudit(tx, ctx, {
    entity: docType === 'DO' ? 'DELIVERY_ORDER' : 'PERMIT_MST_CITY',
    key: `${plantBrnch}|${docNo}`,
    action: 'MANUAL_LOOKUP',
    brnch: plantBrnch,
    reason,
    newValues: { found: items.length },
  });
  return { items };
}

/**
 * GET /plant/offline-cache (BR-OFF-02): open new-system DOs and permits of the branch (legacy
 * prints carry no signed QR: manual lookup). ETag over the entries.
 */
export async function offlineCache(tx, { qrSecret, brnch, now, refreshMin }) {
  const dos = await tx.many(
    `SELECT d.DO_TYPE, TO_CHAR(d.DEL_ORDER_NO) AS DO_NO, NVL(d.QR_VER, 1) AS QR_VER,
            ${DO_STATUS_SQL} AS STATUS, d.CUSTOMER_CODE, c.CUSTOMER_NAME,
            NVL(d.PRODUCT_CODE, t.PRODUCT_CODE) AS PRODUCT_CODE, NVL(g.CITY_NAME, g.AREA_NAME) AS DEST_NAME,
            d.DO_QUANTITY, NVL(d.DISPATCHED_TON, 0) AS DISPATCHED, d.HOLD_REASON, d.QTY_TYPE
       FROM DELIVERY_ORDER d
       LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = d.BRNCH AND c.CUSTOMER_CODE = d.CUSTOMER_CODE
       LEFT JOIN DELIVERY_ORDER_TYPE t ON t.BRNCH = d.BRNCH AND t.DO_CODE = d.DO_TYPE
       LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = d.BRNCH AND g.GEO_CODE = d.DEST_GEO_CODE
      WHERE d.BRNCH = :b AND d.DOC_STATUS IN ('ISSUED', 'PARTLY_DISPATCHED', 'ON_HOLD')
      ORDER BY d.DEL_ORDER_NO`,
    { b: brnch },
  );
  const permits = await tx.many(
    `SELECT TO_CHAR(m.PERMIT_NO) AS PERMIT_NO, NVL(m.QR_VER, 1) AS QR_VER, ${PERMIT_STATUS_SQL} AS STATUS,
            m.CUSTOMER_CODE, c.CUSTOMER_NAME, m.PRODUCT_CODE, d.LNKNO, d.AREA_DOC, d.QTY,
            NVL(d.DISPATCHED_TON, 0) AS DISPATCHED
       FROM PERMIT_MST_CITY m
       JOIN PERMIT_DTL_CITY d ON d.BRNCH = m.BRNCH AND d.PERMIT_NO = m.PERMIT_NO
       LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = m.BRNCH AND c.CUSTOMER_CODE = m.CUSTOMER_CODE
      WHERE m.BRNCH = :b AND m.DOC_STATUS IN ('ISSUED', 'PARTLY_DISPATCHED')
        AND NVL(d.AREA_STATUS, 'OPEN') <> 'CANCELLED'
      ORDER BY m.PERMIT_NO, d.LNKNO`,
    { b: brnch },
  );
  const entries = [];
  for (const r of dos) {
    const docNo = `${r.DO_TYPE}-${r.DO_NO}`;
    const ver = Number(r.QR_VER);
    entries.push({
      docType: 'DO',
      docNo,
      ver,
      sig: await qrSignature({ docType: 'DO', brnch, docNo, ver }, qrSecret),
      status: r.STATUS,
      customerCode: r.CUSTOMER_CODE,
      customerName: r.CUSTOMER_NAME ?? null,
      productCode: r.PRODUCT_CODE ?? null,
      destName: r.DEST_NAME ?? null,
      qtyType: r.QTY_TYPE ?? null,
      remainingTon: dec(r.DO_QUANTITY ?? 0)
        .minus(dec(r.DISPATCHED))
        .toFixed(3),
      holdReason: r.HOLD_REASON ?? null,
      areas: [],
    });
  }
  const byPermit = new Map();
  for (const r of permits) {
    if (!byPermit.has(r.PERMIT_NO)) {
      const ver = Number(r.QR_VER);
      byPermit.set(r.PERMIT_NO, {
        docType: 'PMT',
        docNo: r.PERMIT_NO,
        ver,
        sig: await qrSignature({ docType: 'PMT', brnch, docNo: r.PERMIT_NO, ver }, qrSecret),
        status: r.STATUS,
        customerCode: r.CUSTOMER_CODE,
        customerName: r.CUSTOMER_NAME ?? null,
        productCode: r.PRODUCT_CODE ?? null,
        destName: null,
        qtyType: null,
        remainingTon: '0.000',
        holdReason: null,
        areas: [],
      });
    }
    const e = byPermit.get(r.PERMIT_NO);
    const left = dec(r.QTY ?? 0).minus(dec(r.DISPATCHED));
    e.areas.push({
      lnkno: Number(r.LNKNO),
      areaDoc: String(r.AREA_DOC),
      remainingTon: left.toFixed(3),
    });
    e.remainingTon = dec(e.remainingTon).plus(left).toFixed(3);
  }
  entries.push(...byPermit.values());
  const etag = createHash('sha256')
    .update(JSON.stringify(entries))
    .digest('base64url')
    .slice(0, 27);
  return { brnch, generatedAt: now, refreshMin, etag, entries };
}
