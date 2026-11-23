// Delivery orders (BUSINESS_RULES §9 BR-DO, §10 BR-QR; TASKS P2-06). DOs are created only by OC
// confirmation (BR-DO-01). Cancel releases the undispatched value in the DO ledger (BR-DO-05,
// approval rule DO_CANCEL when active); hold/release (BR-DO-07); print with signed QR + barcode,
// CANCELLED watermark (BR-DO-03). Legacy rows: CANCEL_CODE 'Y' = cancelled.
import {
  businessDate,
  checkTransition,
  dec,
  fiscalYearOf,
  narration,
  roundMoney,
} from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import * as ledger from '../ledger/service.js';
import { enqueue } from '../outbox/service.js';

const ENTITY = 'DELIVERY_ORDER';
const iso = (d) => (d ? businessDate(d) : null);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
const toDate = (s) => new Date(`${s}T00:00:00+05:00`);
export const keyOf = (brnch, doType, doNo) => `${brnch}|${doType}|${doNo}`;
const parseKey = (k) => {
  const [b, t, n] = String(k).split('|');
  return { brnch: Number(b), doType: t, doNo: n };
};

export const DO_STATUS_SQL = `NVL(d.DOC_STATUS, CASE WHEN d.CANCEL_CODE = 'Y' THEN 'CANCELLED'
  WHEN NVL(d.DISPATCHED, 0) >= NVL(d.DO_QUANTITY, 0) AND NVL(d.DO_QUANTITY, 0) > 0 THEN 'DISPATCHED'
  WHEN NVL(d.DISPATCHED, 0) > 0 THEN 'PARTLY_DISPATCHED' ELSE 'ISSUED' END)`;
const DISPATCHED_SQL = 'NVL(d.DISPATCHED_TON, NVL(d.DISPATCHED, 0))';

const COLS = `d.BRNCH, d.DO_TYPE, TO_CHAR(d.DEL_ORDER_NO) AS DO_NO, TO_CHAR(d.ORDER_NO) AS ORDER_NO,
  TO_CHAR(d.SRF_NO) AS SRF_NO, d.SR_NO, d.YEAR, d.ORDER_DATE, d.SCHED_DATE, d.CUSTOMER_CODE,
  c.CUSTOMER_NAME, c.CUSTOMER_ADDRESS1, c.CUSTOMER_ADDRESS2, c.MOBILE_NO, d.DO_QUANTITY, d.QTY_TYPE,
  d.NO_OF_BAGS, ${DISPATCHED_SQL} AS DISPATCHED, d.DO_RATE, d.DO_VALUE, d.PRICE_CODE,
  NVL(d.PRODUCT_CODE, t.PRODUCT_CODE) AS PRODUCT_CODE, t.DO_DESC, d.DEST_GEO_CODE,
  NVL(g.CITY_NAME, g.AREA_NAME) AS DEST_NAME, d.RATE_LOCK_UNTIL, d.QR_VER, d.HOLD_REASON,
  d.HOLD_SHORTFALL, ${DO_STATUS_SQL} AS STATUS, d.ROW_VER, NVL(d.CREATED_BY, d.ENTER_BY) AS CREATED_BY,
  NVL(d.CREATED_ON, d.ENTER_DATE) AS CREATED_ON, d.CANCEL_REASON, d.CANCELLED_BY, d.CANCELLED_ON,
  d.SENT_TO_DEALER_ON, o.REMARKS AS OC_REMARKS`;
const FROM = `DELIVERY_ORDER d
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = d.BRNCH AND c.CUSTOMER_CODE = d.CUSTOMER_CODE
  LEFT JOIN DELIVERY_ORDER_TYPE t ON t.BRNCH = d.BRNCH AND t.DO_CODE = d.DO_TYPE
  LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = d.BRNCH AND g.GEO_CODE = d.DEST_GEO_CODE
  LEFT JOIN ORDER_CONFIRM o ON o.BRNCH = d.BRNCH AND o.ORDER_NO = d.ORDER_NO`;

function mapDo(r) {
  const qty = dec(r.DO_QUANTITY ?? 0);
  const disp = dec(r.DISPATCHED ?? 0);
  const left = qty.minus(disp);
  return {
    brnch: Number(r.BRNCH),
    doType: r.DO_TYPE,
    doTypeName: r.DO_DESC ?? null,
    doNo: r.DO_NO,
    ocNo: r.ORDER_NO ?? null,
    srfNo: r.SRF_NO ?? null,
    srNo: r.SR_NO === null ? null : Number(r.SR_NO),
    year: r.YEAR === null ? null : Number(r.YEAR),
    issueDate: iso(r.ORDER_DATE),
    schedDate: iso(r.SCHED_DATE),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    customerAddress: [r.CUSTOMER_ADDRESS1, r.CUSTOMER_ADDRESS2].filter(Boolean).join(', ') || null,
    customerMobile: r.MOBILE_NO ?? null,
    productCode: r.PRODUCT_CODE ?? null,
    qtyType: r.QTY_TYPE ?? null,
    bags: r.NO_OF_BAGS === null ? null : Number(r.NO_OF_BAGS),
    qtyTon: qty.toFixed(3),
    dispatchedTon: disp.toFixed(3),
    remainingTon: (left.isNegative() ? dec(0) : left).toFixed(3),
    rate: r.DO_RATE === null ? null : dec(r.DO_RATE).toFixed(2),
    value: n2(r.DO_VALUE),
    priceCode: r.PRICE_CODE ?? null,
    destGeoCode: r.DEST_GEO_CODE ?? null,
    destName: r.DEST_NAME ?? null,
    rateLockUntil: r.RATE_LOCK_UNTIL ?? null,
    qrVer: r.QR_VER === null ? null : Number(r.QR_VER),
    holdReason: r.HOLD_REASON ?? null,
    holdShortfall: n2(r.HOLD_SHORTFALL),
    status: r.STATUS,
    rowVer: Number(r.ROW_VER),
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    cancelReason: r.CANCEL_REASON ?? null,
    cancelledBy: r.CANCELLED_BY ?? null,
    cancelledOn: r.CANCELLED_ON ?? null,
    sentToDealerOn: r.SENT_TO_DEALER_ON ?? null,
    instructions: r.OC_REMARKS ?? null,
  };
}

/** @param {{ branches: number[], status?: string, customer?: string, oc?: string, from?: string, to?: string, outstanding?: boolean, q?: string, page?: number, pageSize?: number }} o */
export async function list(tx, o) {
  const bf = branchFilter('d.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.status) {
    where.push(`${DO_STATUS_SQL} = :st`);
    binds.st = o.status;
  }
  if (o.outstanding) where.push(`${DO_STATUS_SQL} IN ('ISSUED', 'PARTLY_DISPATCHED', 'ON_HOLD')`);
  if (o.customer) {
    where.push('d.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  if (o.oc) {
    where.push('d.ORDER_NO = :oc');
    binds.oc = o.oc;
  }
  if (o.from) {
    where.push('d.ORDER_DATE >= :df');
    binds.df = toDate(o.from);
  }
  if (o.to) {
    where.push('d.ORDER_DATE < :dt + 1');
    binds.dt = toDate(o.to);
  }
  if (o.q) {
    where.push(
      `(TO_CHAR(d.DEL_ORDER_NO) LIKE :q ESCAPE '\\' OR d.CUSTOMER_CODE LIKE :q ESCAPE '\\'
        OR UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\' OR TO_CHAR(d.ORDER_NO) LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ORDER BY d.ORDER_DATE DESC NULLS LAST, d.DEL_ORDER_NO DESC, d.BRNCH, d.DO_TYPE`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapDo) };
}

export async function getDo(tx, brnch, doType, doNo, { forUpdate = false } = {}) {
  const key = { b: brnch, t: doType, n: doNo };
  if (forUpdate) {
    const l = await tx.one(
      'SELECT DEL_ORDER_NO FROM DELIVERY_ORDER WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n FOR UPDATE',
      key,
    );
    if (!l) throw Errors.notFound(`DO ${doType} ${doNo}`);
  }
  const r = await tx.one(
    `SELECT ${COLS} FROM ${FROM} WHERE d.BRNCH = :b AND d.DO_TYPE = :t AND d.DEL_ORDER_NO = :n`,
    key,
  );
  if (!r) throw Errors.notFound(`DO ${doType} ${doNo}`);
  return mapDo(r);
}

const audit = (tx, actor, d, action, extra = {}) =>
  recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: keyOf(d.brnch, d.doType, d.doNo),
    action,
    brnch: d.brnch,
    ...extra,
  });

async function setStatus(tx, actor, d, status, sets = {}) {
  const cols = Object.keys(sets);
  const binds = {
    b: d.brnch,
    t: d.doType,
    n: d.doNo,
    rv: d.rowVer,
    st: status,
    usr: actor.usrid,
    now: actor.now,
  };
  cols.forEach((c, i) => {
    binds[`x${i}`] = sets[c];
  });
  const n = await tx.exec(
    `UPDATE DELIVERY_ORDER SET DOC_STATUS = :st, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr,
       UPDATED_ON = :now${cols.map((c, i) => `, ${c} = :x${i}`).join('')}
     WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n AND ROW_VER = :rv`,
    binds,
  );
  if (n !== 1) throw Errors.versionConflict();
}

function assertState(d, to) {
  const t = checkTransition('DO', d.status, to);
  if (!t.ok) throw Errors.invalidState(`DO ${d.doNo} is ${d.status}: ${t.detail}`);
}

/** BR-DO-05: cancel = status + reason; undispatched value back to the DO ledger (credit). */
async function applyCancel(tx, actor, d, reason) {
  assertState(d, 'CANCELLED');
  await setStatus(tx, actor, d, 'CANCELLED', {
    CANCEL_CODE: 'Y',
    CANCEL_REASON: reason.slice(0, 500),
    CANCELLED_BY: actor.usrid,
    CANCELLED_ON: actor.now,
    CANCEL_DATE: actor.now,
  });
  const rate =
    d.rate ?? (dec(d.qtyTon).gt(0) && d.value ? dec(d.value).dividedBy(d.qtyTon).toFixed(2) : '0');
  const released = roundMoney(dec(d.remainingTon).times(dec(rate))).toFixed(2);
  if (dec(released).gt(0)) {
    await ledger.post(tx, actor, [
      {
        brnch: d.brnch,
        customerCode: d.customerCode,
        ledgerType: 'DO',
        entryDate: businessDate(actor.now),
        docType: 'CXL',
        docYear: fiscalYearOf(actor.now),
        docNo: d.doNo,
        entryKind: 'RELEASE',
        narration: narration.cancel({ what: 'DO', no: d.doNo, qtyTon: d.remainingTon }),
        credit: released,
        qtyTon: d.remainingTon,
      },
    ]);
  }
  await audit(tx, actor, d, 'CANCEL', { reason, newValues: { released } });
  return released;
}

/** Cancel request: through the DO_CANCEL approval rule when one is active, else directly. */
export async function cancelDo(tx, actor, brnch, doType, doNo, rowVer, reason) {
  const d = await getDo(tx, brnch, doType, doNo, { forUpdate: true });
  if (d.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(d, 'CANCELLED');
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch,
      docType: 'DO_CANCEL',
      docKey: keyOf(brnch, doType, doNo),
      action: 'DO_CANCEL',
      snapshot: { reason, remainingTon: d.remainingTon, value: d.value },
      amount: d.value,
      qty: d.remainingTon,
      reason,
    },
  );
  if (res.required) {
    await audit(tx, actor, d, 'REQUEST_CANCEL', {
      reason,
      newValues: { requestId: res.requestId },
    });
    return { do: await getDo(tx, brnch, doType, doNo), requestId: res.requestId, released: null };
  }
  const released = await applyCancel(tx, actor, d, reason);
  return { do: await getDo(tx, brnch, doType, doNo), requestId: null, released };
}

onApproved('DO_CANCEL', async (tx, req, ctx) => {
  const k = parseKey(req.docKey);
  const d = await getDo(tx, k.brnch, k.doType, k.doNo, { forUpdate: true });
  if (d.status === 'CANCELLED' || d.status === 'DISPATCHED') return;
  await applyCancel(tx, { usrid: ctx.usrid, now: ctx.now, audit: ctx }, d, req.reason);
});
onRejected('DO_CANCEL', async () => {});

/** BR-DO-07 / BR-PRC-08: hold (with shortfall) and release. */
export async function holdDo(tx, actor, brnch, doType, doNo, rowVer, { reason, shortfall }) {
  const d = await getDo(tx, brnch, doType, doNo, { forUpdate: true });
  if (d.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(d, 'ON_HOLD');
  await setStatus(tx, actor, d, 'ON_HOLD', {
    HOLD_REASON: reason,
    HOLD_SHORTFALL: shortfall ?? null,
  });
  await audit(tx, actor, d, 'HOLD', { reason, newValues: { shortfall: shortfall ?? null } });
  return getDo(tx, brnch, doType, doNo);
}

export async function releaseDo(tx, actor, brnch, doType, doNo, rowVer) {
  const d = await getDo(tx, brnch, doType, doNo, { forUpdate: true });
  if (d.rowVer !== rowVer) throw Errors.versionConflict();
  const to = dec(d.dispatchedTon).gt(0) ? 'PARTLY_DISPATCHED' : 'ISSUED';
  assertState(d, to);
  await setStatus(tx, actor, d, to, { HOLD_REASON: null, HOLD_SHORTFALL: null });
  await audit(tx, actor, d, 'RELEASE');
  return getDo(tx, brnch, doType, doNo);
}

/** Resend to the dealer: queued per channel; delivery by the notification processors (P2-09). */
export async function sendDo(tx, actor, brnch, doType, doNo, channels) {
  const d = await getDo(tx, brnch, doType, doNo);
  if (d.status === 'CANCELLED') throw Errors.invalidState('A cancelled DO is not sent');
  const ids = [];
  for (const ch of channels) {
    const r = await enqueue(tx, {
      brnch,
      eventType: 'DO_SEND',
      aggregateType: ENTITY,
      aggregateKey: keyOf(brnch, doType, doNo),
      channel: ch,
      recipient: d.customerMobile,
      dedupKey: `DO_SEND|${keyOf(brnch, doType, doNo)}|${ch}|${actor.now.getTime()}`,
      payload: { brnch, doType, doNo, customerCode: d.customerCode },
      now: actor.now,
    });
    ids.push(r.outboxId);
  }
  await tx.exec(
    `UPDATE DELIVERY_ORDER SET SENT_TO_DEALER_ON = :now WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n`,
    { now: actor.now, b: brnch, t: doType, n: doNo },
  );
  await audit(tx, actor, d, 'SEND', { newValues: { channels } });
  return { outboxIds: ids };
}

/** Print data (BR-DO-03): DO, terms from PRINT_TEXT (DO_TERMS), preparer. */
export async function printData(tx, brnch, doType, doNo) {
  const d = await getDo(tx, brnch, doType, doNo);
  const terms = await tx.many(
    `SELECT TEXT_BODY FROM PRINT_TEXT WHERE TEXT_CODE = 'DO_TERMS' AND NVL(ACTIVE, 'Y') = 'Y'
        AND BRNCH = (SELECT MAX(p.BRNCH) FROM PRINT_TEXT p WHERE p.TEXT_CODE = 'DO_TERMS' AND p.BRNCH IN (0, :b))
      ORDER BY SR_NO`,
    { b: brnch },
  );
  return { brnch, do: d, terms: terms.map((t) => t.TEXT_BODY) };
}
