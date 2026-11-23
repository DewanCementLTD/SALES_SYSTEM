// OC commands (BUSINESS_RULES §4, TASKS P2-03). DRAFT → REVIEWED → APPROVED → CONFIRMED (creates
// the DOs, BR-OC-07) → CLOSED; reject returns to DRAFT; cancel (BR-OC-08). Edits while DRAFT or
// REVIEWED (BR-OC-02): a price that differs from the master value sets PRICE_OVERRIDE = 'Y' and
// needs an approved OC_PRICE_OVERRIDE before approval. Confirmation checks the available balance
// with the customer locked (BR-OC-06, BR-BAL-02); a shortfall needs an approved
// OC_BALANCE_OVERRIDE covering it. One transaction per command.
import {
  PRICE_OVERRIDE,
  businessDate,
  checkTransition,
  dec,
  fiscalYearOf,
  formatAmount,
  narration,
  ocBreakdown,
  overriddenFields,
  roundMoney,
  shortfall as shortfallOf,
  tonsToBags,
} from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { loadRequest, onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { writeOrderAdvice } from '../cancellations/service.js';
import * as balance from '../ledger/balance.js';
import * as ledger from '../ledger/service.js';
import { nextNumber } from '../numbering/service.js';
import { enqueue } from '../outbox/service.js';
import { SettingsReader } from '../settings/service.js';
import { cancelOcRow, createDraftOc } from './builder.js';
import * as repo from './repo.js';

const ENTITY = 'ORDER_CONFIRM';
const keyOf = (brnch, ocNo) => `${brnch}|${ocNo}`;
const parseKey = (k) => {
  const [b, n] = String(k).split('|');
  return { brnch: Number(b), ocNo: n };
};
const audit = (tx, actor, brnch, ocNo, action, extra = {}) =>
  recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: keyOf(brnch, ocNo),
    action,
    brnch,
    ...extra,
  });

/** OC with schedule, BRV links and DOs. */
export async function getOc(tx, brnch, ocNo, opts) {
  const oc = await repo.get(tx, brnch, ocNo, opts);
  if (!oc) throw Errors.notFound(`OC ${ocNo}`);
  return {
    ...oc,
    schedule: await repo.schedule(tx, brnch, ocNo),
    brvs: await repo.brvLinks(tx, brnch, ocNo),
    dos: await repo.dosOf(tx, brnch, ocNo),
  };
}

function assertState(oc, to) {
  const t = checkTransition('OC', oc.status, to);
  if (!t.ok) throw Errors.invalidState(`OC ${oc.ocNo} is ${oc.status}: ${t.detail}`);
}

async function load(tx, brnch, ocNo, rowVer) {
  const oc = await getOc(tx, brnch, ocNo, { forUpdate: true });
  if (rowVer !== undefined && oc.rowVer !== rowVer) throw Errors.versionConflict();
  return oc;
}

async function setStatus(tx, actor, oc, status, sets = {}) {
  const cols = Object.keys(sets);
  const binds = {
    b: oc.brnch,
    n: oc.ocNo,
    rv: oc.rowVer,
    st: status,
    usr: actor.usrid,
    now: actor.now,
  };
  cols.forEach((c, i) => {
    binds[`x${i}`] = sets[c];
  });
  const n = await tx.exec(
    `UPDATE ORDER_CONFIRM SET DOC_STATUS = :st, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr,
       UPDATED_ON = :now${cols.map((c, i) => `, ${c} = :x${i}`).join('')}
     WHERE BRNCH = :b AND ORDER_NO = :n AND ROW_VER = :rv`,
    binds,
  );
  if (n !== 1) throw Errors.versionConflict();
}

/** Price breakdown for proposed prices (no save). */
export function pricePreview(oc, prices, qtyTon) {
  const b = ocBreakdown(prices, qtyTon ?? oc.qtyTon);
  return { ...b, overridden: overriddenFields(oc.masterPrices, prices) };
}

/** BR-OC-02: edit quantity, schedule, prices, remarks while DRAFT or REVIEWED. */
export async function updateOc(tx, actor, brnch, ocNo, rowVer, body) {
  const oc = await load(tx, brnch, ocNo, rowVer);
  if (!['DRAFT', 'REVIEWED'].includes(oc.status))
    throw Errors.invalidState(`OC ${ocNo} is ${oc.status}; only DRAFT or REVIEWED can be edited`);
  const b = ocBreakdown(body.prices, body.qtyTon);
  const changed = overriddenFields(oc.masterPrices, body.prices);
  // an earlier approval stays valid only while the prices are unchanged
  const samePrices = Object.keys(body.prices).every((k) =>
    dec(body.prices[k]).eq(dec(oc.prices[k])),
  );
  const flag = !changed.length
    ? PRICE_OVERRIDE.NONE
    : oc.priceOverride === PRICE_OVERRIDE.APPROVED && samePrices
      ? PRICE_OVERRIDE.APPROVED
      : PRICE_OVERRIDE.PENDING;
  const n = await tx.exec(
    `UPDATE ORDER_CONFIRM SET QUANTITY = :qty, RETAIL_PRICE = :rp, TRADE_DISC = :td, GROSS_PRICE = :tdp,
       SALES_TAX = :st, CED = :fed, CONS_PRICE = :cp, EXPENSE = :ex, DISCOUNT = :di,
       NET_BOOK_PRICE = :np, TOT_NET = :tot, OC_VALUE = :tot, REMARKS = :rem, PRICE_OVERRIDE = :po,
       ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
     WHERE BRNCH = :b AND ORDER_NO = :n AND ROW_VER = :rv`,
    {
      b: brnch,
      n: ocNo,
      rv: rowVer,
      qty: body.qtyTon,
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
      rem: body.remarks ?? null,
      po: flag,
      usr: actor.usrid,
      now: actor.now,
    },
  );
  if (n !== 1) throw Errors.versionConflict();
  await repo.writeSchedule(tx, {
    brnch,
    ocNo,
    srfNo: oc.srfNo,
    orderDate: oc.orderDate,
    lines: body.schedule,
  });
  await audit(tx, actor, brnch, ocNo, 'UPDATE', {
    oldValues: { qtyTon: oc.qtyTon, prices: oc.prices, schedule: oc.schedule },
    newValues: { ...body, overridden: changed },
  });
  return getOc(tx, brnch, ocNo);
}

export async function reviewOc(tx, actor, brnch, ocNo, rowVer) {
  const oc = await load(tx, brnch, ocNo, rowVer);
  assertState(oc, 'REVIEWED');
  await setStatus(tx, actor, oc, 'REVIEWED', { REVIEWED_BY: actor.usrid });
  await audit(tx, actor, brnch, ocNo, 'REVIEW');
  return getOc(tx, brnch, ocNo);
}

/** BR-OC-04 approve; a pending price override must be approved first (BR-OC-02). */
export async function approveOc(tx, actor, brnch, ocNo, rowVer) {
  const oc = await load(tx, brnch, ocNo, rowVer);
  assertState(oc, 'APPROVED');
  if (oc.priceOverride === PRICE_OVERRIDE.PENDING) {
    throw Errors.approvalRequired(
      'Prices differ from the trade price: request a price override and have it approved first (BR-OC-02)',
      null,
    );
  }
  if (dec(oc.value).lte(0)) throw Errors.rule('BR-OC-03', 'The OC has no value: enter the prices');
  await setStatus(tx, actor, oc, 'APPROVED', {
    APPROVED_BY: actor.usrid,
    APPROVED_ON: actor.now,
  });
  await audit(tx, actor, brnch, ocNo, 'APPROVE');
  return getOc(tx, brnch, ocNo);
}

/** BR-OC-04 reject: back to DRAFT with reason. */
export async function rejectOc(tx, actor, brnch, ocNo, rowVer, reason) {
  const oc = await load(tx, brnch, ocNo, rowVer);
  assertState(oc, 'DRAFT');
  await setStatus(tx, actor, oc, 'DRAFT', {
    REVIEWED_BY: null,
    APPROVED_BY: null,
    APPROVED_ON: null,
  });
  await audit(tx, actor, brnch, ocNo, 'REJECT', { reason });
  return getOc(tx, brnch, ocNo);
}

/** BR-OC-05: replace the BRV links (verified BRVs of the same customer, within their free amount). */
export async function setBrvLinks(tx, actor, brnch, ocNo, rowVer, links) {
  const oc = await load(tx, brnch, ocNo, rowVer);
  if (['CONFIRMED', 'CLOSED', 'CANCELLED'].includes(oc.status))
    throw Errors.invalidState(`OC ${ocNo} is ${oc.status}; its payments can no longer change`);
  const nos = links.map((l) => l.receiptNo);
  if (new Set(nos).size !== nos.length) throw Errors.validation('A BRV is listed twice');
  const current = new Map(oc.brvs.map((l) => [l.receiptNo, l]));
  // release links that are removed or changed, then apply the new amounts
  for (const l of oc.brvs) {
    await tx.exec(
      `UPDATE CASH_CHEQUE_RECEIPTS SET APPLIED_AMT = NVL(APPLIED_AMT, 0) - :a
        WHERE BRNCH = :b AND RECEIPT_NO = :r AND CASH_CHEQ_CD = 'Q'`,
      { a: l.amount, b: brnch, r: l.receiptNo },
    );
    if (!nos.includes(l.receiptNo)) {
      await tx.exec('UPDATE ORDER_CONFIRM_BRV SET AMOUNT = 0 WHERE SERNO = :s', { s: l.serno });
    }
  }
  for (const l of links) {
    const brv = await tx.one(
      `SELECT CUSTOMER_CODE, AMOUNT, NVL(APPLIED_AMT, 0) AS APPLIED, DOC_STATUS, CR_DATE FROM CASH_CHEQUE_RECEIPTS
        WHERE BRNCH = :b AND RECEIPT_NO = :r AND CASH_CHEQ_CD = 'Q' FOR UPDATE`,
      { b: brnch, r: l.receiptNo },
    );
    if (!brv) throw Errors.notFound(`BRV ${l.receiptNo}`);
    if (brv.CUSTOMER_CODE !== oc.customerCode)
      throw Errors.rule('BR-OC-05', `BRV ${l.receiptNo} belongs to another customer`);
    if (!['VERIFIED', 'CLEARED'].includes(brv.DOC_STATUS))
      throw Errors.rule('BR-OC-05', `BRV ${l.receiptNo} is not verified`);
    const free = dec(brv.AMOUNT).minus(dec(brv.APPLIED));
    if (dec(l.amount).gt(free))
      throw Errors.rule(
        'BR-OC-05',
        `BRV ${l.receiptNo} has only ${free.toFixed(2)} left to apply`,
        { free: free.toFixed(2) },
      );
    await tx.exec(
      `UPDATE CASH_CHEQUE_RECEIPTS SET APPLIED_AMT = NVL(APPLIED_AMT, 0) + :a
        WHERE BRNCH = :b AND RECEIPT_NO = :r AND CASH_CHEQ_CD = 'Q'`,
      { a: l.amount, b: brnch, r: l.receiptNo },
    );
    const had = current.get(l.receiptNo);
    if (had) {
      await tx.exec('UPDATE ORDER_CONFIRM_BRV SET AMOUNT = :a WHERE SERNO = :s', {
        a: l.amount,
        s: had.serno,
      });
    } else {
      await tx.exec(
        `INSERT INTO ORDER_CONFIRM_BRV (SERNO, ORDER_NO, RECEIPT_NO, CR_DATE, CASH_CHEQ_CD, AMOUNT, COMPC, BRNCH)
         VALUES (:s, :n, :r, :d, 'Q', :a, 1, :b)`,
        {
          s: await tx.nextId('SEQ_OC_BRV'),
          n: ocNo,
          r: l.receiptNo,
          d: brv.CR_DATE,
          a: l.amount,
          b: brnch,
        },
      );
    }
  }
  await tx.exec(
    `UPDATE ORDER_CONFIRM SET ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
      WHERE BRNCH = :b AND ORDER_NO = :n`,
    { b: brnch, n: ocNo, usr: actor.usrid, now: actor.now },
  );
  await audit(tx, actor, brnch, ocNo, 'LINK_BRV', { newValues: links });
  return getOc(tx, brnch, ocNo);
}

/** Balance panel for an OC (BR-BAL-05) with its value and shortfall (BR-BAL-03). */
export async function ocBalance(tx, oc, now) {
  return balance.available(tx, {
    brnch: oc.brnch,
    customerCode: oc.customerCode,
    now,
    value: oc.value,
  });
}

/** Approved balance override that still covers the shortfall (BR-BAL-04). */
async function coveringOverride(tx, oc, short) {
  if (!oc.overrideReqId) return null;
  const req = await loadRequest(tx, oc.overrideReqId).catch(() => null);
  if (!req || req.status !== 'APPROVED') return null;
  return dec(req.amount ?? 0).gte(dec(short)) ? req : null;
}

/** BR-OC-06/07: confirm with the balance check; one DO per schedule line + DO ledger debit. */
export async function confirmOc(tx, actor, brnch, ocNo, rowVer, { doType }) {
  const head = await repo.get(tx, brnch, ocNo);
  if (!head) throw Errors.notFound(`OC ${ocNo}`);
  // lock order (ARCHITECTURE §4): customer, then the document, then numbering
  await balance.lockCustomer(tx, brnch, head.customerCode);
  const oc = await load(tx, brnch, ocNo, rowVer);
  assertState(oc, 'CONFIRMED');
  if (oc.priceOverride === PRICE_OVERRIDE.PENDING)
    throw Errors.approvalRequired('The price override is not approved yet (BR-OC-02)', null);
  const type = await tx.one(
    `SELECT DO_CODE, PRODUCT_CODE, ACTIVE FROM DELIVERY_ORDER_TYPE WHERE BRNCH = :b AND DO_CODE = :t`,
    { b: brnch, t: doType },
  );
  if (!type || type.ACTIVE === 'N')
    throw Errors.validation('Unknown or inactive DO type', [
      { path: 'doType', message: 'Choose a DO type' },
    ]);
  if (type.PRODUCT_CODE !== oc.productCode)
    throw Errors.rule(
      'BR-DO-01',
      `DO type ${doType} is for ${type.PRODUCT_CODE}, the OC is for ${oc.productCode}`,
    );

  const bal = await ocBalance(tx, oc, actor.now);
  const short = shortfallOf(oc.value, bal.available);
  let override = null;
  if (dec(short).gt(0)) {
    override = await coveringOverride(tx, oc, short);
    if (!override) {
      throw Errors.rule(
        'BR-OC-06',
        `Available balance ${formatAmount(bal.available, { brackets: true })} is less than the OC value ${formatAmount(oc.value)}: short by ${formatAmount(short)}`,
        { shortfall: short, available: bal.available, value: oc.value },
      );
    }
  }

  const today = businessDate(actor.now);
  const year = fiscalYearOf(actor.now);
  const lockDays = (await new SettingsReader(tx).num(brnch, 'DO_RATE_LOCK_DAYS')) ?? 14;
  const lockUntil = new Date(actor.now.getTime() + lockDays * 86_400_000);
  const rate = oc.netPrice;
  const dos = [];
  for (const line of oc.schedule) {
    const doNo = await nextNumber(tx, { brnch, year, docType: 'DO' });
    const value = roundMoney(dec(line.qtyTon).times(dec(rate))).toFixed(2);
    await tx.exec(
      `INSERT INTO DELIVERY_ORDER (DEL_ORDER_NO, DO_TYPE, BRNCH, COMPC, YEAR, CUSTOMER_CODE, ORDER_NO,
         SRF_NO, SR_NO, ORDER_DATE, SCHED_DATE, DO_QUANTITY, QTY_TYPE, NO_OF_BAGS, CANCEL_CODE, POST,
         DOC_STATUS, ROW_VER, DO_RATE, DO_VALUE, PRICE_CODE, PRODUCT_CODE, DEST_GEO_CODE,
         RATE_LOCK_UNTIL, DISPATCHED_TON, QR_VER, CREATED_BY, CREATED_ON, ENTER_BY, ENTER_DATE, USRID)
       VALUES (:n, :t, :b, 1, :y, :cu, :oc, :srf, :sr, :od, :sd, :q, :qt, :bags, 'N', 'N', 'ISSUED', 1,
         :drate, :val, :pc, :pr, :geo, :rlu, 0, 1, :usr, :now, :usr10, :now, :usr10)`,
      {
        n: doNo,
        t: doType,
        b: brnch,
        y: year,
        cu: oc.customerCode,
        oc: ocNo,
        srf: oc.srfNo,
        sr: line.srNo,
        od: repo.toDate(today),
        sd: repo.toDate(line.date),
        q: line.qtyTon,
        qt: 'BAGS',
        bags: tonsToBags(line.qtyTon).toNumber(),
        drate: rate,
        val: value,
        pc: oc.priceCode,
        pr: oc.productCode,
        geo: oc.destGeoCode,
        rlu: lockUntil,
        usr: actor.usrid,
        usr10: actor.usrid.slice(0, 10),
        now: actor.now,
      },
    );
    await ledger.post(tx, actor, [
      {
        brnch,
        customerCode: oc.customerCode,
        ledgerType: 'DO',
        entryDate: today,
        docType: 'DO',
        docYear: year,
        docNo: doNo,
        entryKind: 'ISSUE',
        narration: narration.do({ doNo, ocNo, qtyTon: line.qtyTon, rate }),
        debit: value,
        qtyTon: dec(line.qtyTon).toFixed(3),
      },
    ]);
    await enqueue(tx, {
      brnch,
      eventType: 'DO_ISSUED',
      aggregateType: 'DELIVERY_ORDER',
      aggregateKey: `${brnch}|${doType}|${doNo}`,
      channel: 'JOB',
      dedupKey: `DO_ISSUED|${brnch}|${doType}|${doNo}`,
      payload: { brnch, doType, doNo, ocNo, customerCode: oc.customerCode },
      now: actor.now,
    });
    dos.push({ doType, doNo, srNo: line.srNo, qtyTon: dec(line.qtyTon).toFixed(3), rate, value });
  }
  await setStatus(tx, actor, oc, 'CONFIRMED', {
    CONFIRMED_BY: actor.usrid,
    CONFIRMED_ON: actor.now,
    APPROVED: 'Y', // legacy flag (approved = DO generated)
  });
  if (oc.srfNo) {
    await tx.exec(
      `UPDATE SALES_REQUEST_MASTER SET DOC_STATUS = 'CONVERTED', ROW_VER = ROW_VER + 1,
         UPDATED_BY = :usr, UPDATED_ON = :now
       WHERE BRNCH = :b AND SRF_NO = :s AND DOC_STATUS = 'SUBMITTED'`,
      { b: brnch, s: oc.srfNo, usr: actor.usrid, now: actor.now },
    );
  }
  await audit(tx, actor, brnch, ocNo, 'CONFIRM', {
    newValues: {
      dos: dos.map((d) => d.doNo),
      available: bal.available,
      value: oc.value,
      shortfall: short,
      overrideReqId: override?.reqId ?? null,
    },
  });
  return {
    oc: await getOc(tx, brnch, ocNo),
    dos,
    balanceAfter: dec(bal.available).minus(dec(oc.value)).toFixed(2),
  };
}

/** BR-BAL-04 / BR-OC-02: ask for a balance or price override (approval engine). */
export async function requestOverride(tx, actor, brnch, ocNo, { kind, reason }) {
  const oc = await getOc(tx, brnch, ocNo, { forUpdate: true });
  if (['CONFIRMED', 'CLOSED', 'CANCELLED'].includes(oc.status))
    throw Errors.invalidState(`OC ${ocNo} is ${oc.status}`);
  const ctx = { ...actor.audit, now: actor.now };
  if (kind === 'PRICE') {
    if (oc.priceOverride !== PRICE_OVERRIDE.PENDING)
      throw Errors.invalidState('The prices equal the trade price or are already approved');
    const res = await requestApproval(tx, ctx, {
      brnch,
      docType: 'OC_PRICE_OVERRIDE',
      docKey: keyOf(brnch, ocNo),
      action: 'OC_PRICE_OVERRIDE',
      snapshot: {
        prices: oc.prices,
        masterPrices: oc.masterPrices,
        qtyTon: oc.qtyTon,
        value: oc.value,
      },
      amount: oc.value,
      reason,
    });
    if (!res.required) await approvePrice(tx, oc, actor);
    await audit(tx, actor, brnch, ocNo, 'REQUEST_PRICE_OVERRIDE', { reason });
    return { requestId: res.required ? res.requestId : null, oc: await getOc(tx, brnch, ocNo) };
  }
  const bal = await ocBalance(tx, oc, actor.now);
  const short = shortfallOf(oc.value, bal.available);
  if (!dec(short).gt(0))
    throw Errors.invalidState('The balance covers this OC: no override needed');
  const res = await requestApproval(tx, ctx, {
    brnch,
    docType: 'OC_BALANCE_OVERRIDE',
    docKey: keyOf(brnch, ocNo),
    action: 'OC_BALANCE_OVERRIDE',
    snapshot: { value: oc.value, available: bal.available, shortfall: short },
    amount: short,
    reason,
  });
  if (!res.required) {
    throw Errors.rule(
      'BR-BAL-04',
      'No approval rule for balance overrides is active: ask an administrator',
    );
  }
  await audit(tx, actor, brnch, ocNo, 'REQUEST_BALANCE_OVERRIDE', {
    reason,
    newValues: { shortfall: short },
  });
  return { requestId: res.requestId, oc: await getOc(tx, brnch, ocNo) };
}

async function approvePrice(tx, oc, actor) {
  await tx.exec(
    `UPDATE ORDER_CONFIRM SET PRICE_OVERRIDE = 'A', ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
      WHERE BRNCH = :b AND ORDER_NO = :n`,
    { b: oc.brnch, n: oc.ocNo, usr: actor.usrid, now: actor.now },
  );
}

onApproved('OC_PRICE_OVERRIDE', async (tx, req, ctx) => {
  const { brnch, ocNo } = parseKey(req.docKey);
  const oc = await repo.get(tx, brnch, ocNo, { forUpdate: true });
  // only if the prices are still the ones that were approved
  const same =
    oc &&
    Object.keys(req.snapshot?.prices ?? {}).every((k) =>
      dec(req.snapshot.prices[k]).eq(dec(oc.prices[k])),
    );
  if (same && oc.priceOverride === PRICE_OVERRIDE.PENDING)
    await approvePrice(tx, oc, { usrid: ctx.usrid, now: ctx.now });
});
onRejected('OC_PRICE_OVERRIDE', async () => {});
onApproved('OC_BALANCE_OVERRIDE', async (tx, req, ctx) => {
  const { brnch, ocNo } = parseKey(req.docKey);
  await tx.exec(
    `UPDATE ORDER_CONFIRM SET OVERRIDE_REQ_ID = :r, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
      WHERE BRNCH = :b AND ORDER_NO = :n`,
    { r: req.reqId, b: brnch, n: ocNo, usr: ctx.usrid, now: ctx.now },
  );
});
onRejected('OC_BALANCE_OVERRIDE', async () => {});

/**
 * BR-OC-08: cancel while no DO has dispatch; a confirmed OC's undispatched DOs are cancelled and
 * their value returns to the DO ledger (credit).
 */
export async function cancelOc(tx, actor, brnch, ocNo, rowVer, reason) {
  const oc = await load(tx, brnch, ocNo, rowVer);
  assertState(oc, 'CANCELLED');
  if (oc.dos.some((d) => dec(d.dispatchedTon).gt(0)))
    throw Errors.rule('BR-OC-08', 'A DO of this OC has dispatches: cancel the open DOs instead');
  const today = businessDate(actor.now);
  const adviceLines = [];
  for (const d of oc.dos.filter((x) => ['ISSUED', 'ON_HOLD'].includes(x.status))) {
    adviceLines.push({
      doNo: d.doNo,
      doType: d.doType,
      productCode: oc.productCode,
      issueDate: oc.orderDate,
      qtyTon: d.qtyTon,
      ocNo,
      amount: d.value ?? '0',
    });
    await tx.exec(
      `UPDATE DELIVERY_ORDER SET DOC_STATUS = 'CANCELLED', CANCEL_CODE = 'Y', CANCEL_REASON = :r,
         CANCELLED_BY = :usr, CANCELLED_ON = :now, CANCEL_DATE = :now, ROW_VER = ROW_VER + 1,
         UPDATED_BY = :usr, UPDATED_ON = :now
       WHERE BRNCH = :b AND DO_TYPE = :t AND DEL_ORDER_NO = :n`,
      {
        b: brnch,
        t: d.doType,
        n: d.doNo,
        r: `OC cancelled: ${reason}`.slice(0, 500),
        usr: actor.usrid,
        now: actor.now,
      },
    );
    if (d.value && dec(d.value).gt(0)) {
      await ledger.post(tx, actor, [
        {
          brnch,
          customerCode: oc.customerCode,
          ledgerType: 'DO',
          entryDate: today,
          docType: 'CXL',
          docYear: fiscalYearOf(actor.now),
          docNo: d.doNo,
          entryKind: 'RELEASE',
          narration: narration.cancel({ what: 'DO', no: d.doNo, qtyTon: d.qtyTon }),
          credit: d.value,
          qtyTon: d.qtyTon,
        },
      ]);
    }
  }
  // PRD 4.14 / P2-08: one order cancellation advice for the DOs of the OC
  await writeOrderAdvice(tx, actor, { brnch, customerCode: oc.customerCode, lines: adviceLines });
  // release BRV money applied to this OC
  for (const l of oc.brvs) {
    await tx.exec(
      `UPDATE CASH_CHEQUE_RECEIPTS SET APPLIED_AMT = NVL(APPLIED_AMT, 0) - :a
        WHERE BRNCH = :b AND RECEIPT_NO = :r AND CASH_CHEQ_CD = 'Q'`,
      { a: l.amount, b: brnch, r: l.receiptNo },
    );
    await tx.exec('UPDATE ORDER_CONFIRM_BRV SET AMOUNT = 0 WHERE SERNO = :s', { s: l.serno });
  }
  await cancelOcRow(tx, actor, { brnch, ocNo, reason });
  return getOc(tx, brnch, ocNo);
}

/** BR-OC-09: duplicate = new DRAFT OC (new number) with the same order and current trade price. */
export async function duplicateOc(tx, actor, brnch, ocNo) {
  const oc = await getOc(tx, brnch, ocNo);
  const res = await createDraftOc(tx, actor, {
    brnch,
    srfNo: oc.srfNo,
    customerCode: oc.customerCode,
    productCode: oc.productCode,
    destGeoCode: oc.destGeoCode,
    qtyTon: oc.qtyTon,
    schedule: oc.schedule,
    remarks: oc.remarks,
    taxProfile: { stType: oc.salesTaxType },
  });
  await audit(tx, actor, brnch, ocNo, 'DUPLICATE', { newValues: { newOcNo: res.ocNo } });
  return getOc(tx, brnch, res.ocNo);
}

/** DO types usable for the OC's product (BR-DO-01), the customer's last one first. */
export async function doTypesFor(tx, brnch, oc) {
  const rows = await tx.many(
    `SELECT t.DO_CODE, t.DO_DESC,
            (SELECT MAX(d.ORDER_DATE) FROM DELIVERY_ORDER d WHERE d.BRNCH = t.BRNCH AND d.DO_TYPE = t.DO_CODE
               AND d.CUSTOMER_CODE = :c) AS LAST_USED
       FROM DELIVERY_ORDER_TYPE t
      WHERE t.BRNCH = :b AND t.PRODUCT_CODE = :p AND NVL(t.ACTIVE, 'Y') = 'Y'
      ORDER BY LAST_USED DESC NULLS LAST, t.CODE`,
    { b: brnch, p: oc.productCode, c: oc.customerCode },
  );
  return rows.map((r) => ({
    value: r.DO_CODE,
    label: r.DO_DESC ?? r.DO_CODE,
    lastUsed: !!r.LAST_USED,
  }));
}
