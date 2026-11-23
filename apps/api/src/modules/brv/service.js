// BRV commands (BUSINESS_RULES §5, TASKS P2-04). ENTERED → VERIFIED (ledger credit in DO and DC,
// BR-BRV-04) → CLEARED; VERIFIED/CLEARED → BOUNCED (ledger debit "Cheque return", BR-BRV-05);
// ENTERED → CANCELLED (BR-BRV-06). Maker ≠ verifier (BR-BRV-03). One transaction per command.
import {
  MASTERS,
  canVerify,
  checkTransition,
  dec,
  displayDate,
  fiscalYearOf,
  formatAmount,
  narration,
} from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { writeReceiptAdvice } from '../cancellations/service.js';
import * as ledger from '../ledger/service.js';
import { refExists } from '../masters/repo.js';
import { notifyDealer } from '../notifications/dealer.js';
import { nextNumber } from '../numbering/service.js';
import * as repo from './repo.js';

const ENTITY = 'CASH_CHEQUE_RECEIPTS';
const keyOf = (brnch, no) => `${brnch}|${no}`;

export async function getBrv(tx, brnch, receiptNo, opts) {
  const brv = await repo.get(tx, brnch, receiptNo, opts);
  if (!brv) throw Errors.notFound(`BRV ${receiptNo}`);
  return brv;
}

/** Customer exists; instrument, banks and deposit account are known; returns the account short code. */
async function checkRefs(tx, brnch, b) {
  const c = await tx.one(
    `SELECT CUSTOMER_CODE, CLOSED, DOC_STATUS FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c`,
    { b: brnch, c: b.customerCode },
  );
  if (!c) throw Errors.notFound(`Customer ${b.customerCode}`);
  if (c.CLOSED === 'Y' || c.DOC_STATUS === 'CLOSED')
    throw Errors.rule('BR-CUS-02', `Customer ${b.customerCode} is closed`);
  const problems = [];
  if (!(await refExists(tx, MASTERS.instruments, brnch, b.instCode)))
    problems.push({ path: 'instCode', message: 'Unknown instrument' });
  if (b.category && !(await refExists(tx, MASTERS.categories, brnch, b.category)))
    problems.push({ path: 'category', message: 'Unknown category' });
  if (b.bankCode && !(await refExists(tx, MASTERS.banks, brnch, b.bankCode)))
    problems.push({ path: 'bankCode', message: 'Unknown bank' });
  const dep = await tx.one(
    'SELECT ABBR, ACTIVE FROM COMPANY_BANK WHERE BRNCH = :b AND BANK_CODE = :k',
    { b: brnch, k: b.depositAccount },
  );
  if (!dep || dep.ACTIVE === 'N')
    problems.push({ path: 'depositAccount', message: 'Unknown or inactive company account' });
  if (problems.length) throw Errors.validation('The BRV refers to unknown data', problems);
  return dep.ABBR ?? b.depositAccount;
}

function assertState(brv, to) {
  const t = checkTransition('BRV', brv.status, to);
  if (!t.ok) throw Errors.invalidState(`BRV ${brv.receiptNo} is ${brv.status}: ${t.detail}`);
}

const audit = (tx, actor, brnch, no, action, extra = {}) =>
  recordAudit(tx, actor.audit, { entity: ENTITY, key: keyOf(brnch, no), action, brnch, ...extra });

export async function createBrv(tx, actor, brnch, body) {
  const depositAbbr = await checkRefs(tx, brnch, body);
  const year = fiscalYearOf(new Date(`${body.brvDate}T00:00:00+05:00`));
  const receiptNo = await nextNumber(tx, { brnch, year, docType: 'BRV' });
  await repo.insert(tx, { brnch, receiptNo, year, body, depositAbbr, ...actor });
  await audit(tx, actor, brnch, receiptNo, 'CREATE', { newValues: body });
  return getBrv(tx, brnch, receiptNo);
}

export async function updateBrv(tx, actor, brnch, receiptNo, rowVer, body) {
  const before = await getBrv(tx, brnch, receiptNo, { forUpdate: true });
  if (before.status !== 'ENTERED')
    throw Errors.invalidState(
      `BRV ${receiptNo} is ${before.status}; only an ENTERED BRV can be edited`,
    );
  const depositAbbr = await checkRefs(tx, brnch, body);
  if ((await repo.update(tx, { brnch, receiptNo, rowVer, body, depositAbbr, ...actor })) !== 1)
    throw Errors.versionConflict();
  await audit(tx, actor, brnch, receiptNo, 'UPDATE', { oldValues: before, newValues: body });
  return getBrv(tx, brnch, receiptNo);
}

/** BR-BRV-03/04: verify (maker ≠ verifier) and credit both ledgers in the same transaction. */
export async function verifyBrv(tx, actor, brnch, receiptNo, rowVer, { method, bankRef, remarks }) {
  const brv = await getBrv(tx, brnch, receiptNo, { forUpdate: true });
  if (brv.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(brv, 'VERIFIED');
  const mc = canVerify(brv, actor.usrid);
  if (!mc.ok) throw Errors.makerChecker(mc.reason, 'BR-BRV-03');
  const n = await repo.setStatus(tx, {
    brnch,
    receiptNo,
    rowVer,
    status: 'VERIFIED',
    ...actor,
    sets: {
      VERIFIED_BY: actor.usrid,
      VERIFIED_ON: actor.now,
      VERIFY_METHOD: method,
      VERIFY_REF: bankRef,
      VERIFY_REMARKS: remarks ?? null,
    },
  });
  if (n !== 1) throw Errors.versionConflict();
  const narr = narration.brv({
    brvNo: receiptNo,
    instrument: brv.instrument ?? brv.instCode,
    bank: brv.depositShort,
    chequeNo: brv.chequeNo && brv.chequeNo !== 'TRANSFER' ? brv.chequeNo : null,
  });
  const entry = {
    brnch,
    customerCode: brv.customerCode,
    entryDate: brv.brvDate,
    docType: 'BRV',
    docYear: brv.year,
    docNo: receiptNo,
    entryKind: 'RECEIPT',
    narration: narr,
    credit: brv.amount,
  };
  await ledger.post(tx, actor, [
    { ...entry, ledgerType: 'DO' },
    { ...entry, ledgerType: 'DC' },
  ]);
  // BR-NTF-01: tell the dealer the payment is received
  await notifyDealer(tx, {
    brnch,
    event: 'BRV_VERIFIED',
    docKey: keyOf(brnch, receiptNo),
    customerCode: brv.customerCode,
    vars: {
      AMOUNT: formatAmount(brv.amount),
      BRV_NO: receiptNo,
      BRV_DATE: displayDate(`${brv.brvDate}T00:00:00+05:00`),
    },
    now: actor.now,
  });
  await audit(tx, actor, brnch, receiptNo, 'VERIFY', {
    newValues: { method, bankRef, remarks, amount: brv.amount },
  });
  return getBrv(tx, brnch, receiptNo);
}

/** VERIFIED → CLEARED (the bank cleared the instrument); no ledger effect. */
export async function clearBrv(tx, actor, brnch, receiptNo, rowVer, { clearDate }) {
  const brv = await getBrv(tx, brnch, receiptNo, { forUpdate: true });
  if (brv.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(brv, 'CLEARED');
  const d = new Date(`${clearDate}T00:00:00+05:00`);
  if (
    (await repo.setStatus(tx, {
      brnch,
      receiptNo,
      rowVer,
      status: 'CLEARED',
      ...actor,
      sets: { CLEAR_DATE: d, CLEAR_DT: d },
    })) !== 1
  )
    throw Errors.versionConflict();
  await audit(tx, actor, brnch, receiptNo, 'CLEAR', { newValues: { clearDate } });
  return getBrv(tx, brnch, receiptNo);
}

/**
 * BR-BRV-05: bounce reverses the receipt in both ledgers (debit "Cheque return"). Links to OCs not
 * yet confirmed are released; confirmed OCs are returned as impacted (their DOs go through the
 * BR-PRC-08 shortfall check, P2-07).
 */
export async function bounceBrv(tx, actor, brnch, receiptNo, rowVer, { reason, returnDate }) {
  const brv = await getBrv(tx, brnch, receiptNo, { forUpdate: true });
  if (brv.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(brv, 'BOUNCED');
  const rd = new Date(`${returnDate}T00:00:00+05:00`);
  const n = await repo.setStatus(tx, {
    brnch,
    receiptNo,
    rowVer,
    status: 'BOUNCED',
    ...actor,
    sets: {
      BOUNCED_BY: actor.usrid,
      BOUNCED_ON: actor.now,
      BOUNCE_REASON: reason,
      RETURN_DATE: rd,
    },
  });
  if (n !== 1) throw Errors.versionConflict();
  const over = {
    entryDate: returnDate,
    docType: 'BOUNCE',
    entryKind: 'RETURN',
    narration: narration.bounce({ brvNo: receiptNo, chequeNo: brv.chequeNo, reason }),
  };
  const posted = await ledger.documentRows(tx, {
    brnch,
    docType: 'BRV',
    docNo: receiptNo,
    docYear: brv.year,
  });
  if (posted.length) {
    await ledger.reverseDocument(
      tx,
      actor,
      { brnch, docType: 'BRV', docNo: receiptNo, docYear: brv.year },
      over,
    );
  } else {
    // legacy BRV: its receipt is inside the opening balance (P6-03), so the return is a plain debit
    const base = {
      brnch,
      customerCode: brv.customerCode,
      docYear: brv.year,
      docNo: receiptNo,
      debit: brv.amount,
      ...over,
    };
    await ledger.post(tx, actor, [
      { ...base, ledgerType: 'DO' },
      { ...base, ledgerType: 'DC' },
    ]);
  }
  const ocs = await repo.linkedOcs(tx, brnch, receiptNo);
  const released = ocs.filter((o) => ['DRAFT', 'REVIEWED', 'APPROVED'].includes(o.status));
  if (released.length) {
    await tx.exec(
      `UPDATE ORDER_CONFIRM_BRV SET AMOUNT = 0, REM = SUBSTR('Released: BRV bounced. ' || REM, 1, 100)
        WHERE BRNCH = :b AND RECEIPT_NO = :n
          AND ORDER_NO IN (SELECT o.ORDER_NO FROM ORDER_CONFIRM o WHERE o.BRNCH = :b
                AND o.DOC_STATUS IN ('DRAFT', 'REVIEWED', 'APPROVED'))`,
      { b: brnch, n: receiptNo },
    );
    await tx.exec(
      `UPDATE CASH_CHEQUE_RECEIPTS SET APPLIED_AMT = NVL(APPLIED_AMT, 0) - :amt
        WHERE BRNCH = :b AND RECEIPT_NO = :n AND CASH_CHEQ_CD = 'Q'`,
      {
        b: brnch,
        n: receiptNo,
        amt: released.reduce((s, o) => s.plus(dec(o.amount)), dec(0)).toFixed(2),
      },
    );
  }
  const impact = {
    releasedOcs: released.map((o) => o.ocNo),
    confirmedOcs: ocs.filter((o) => ['CONFIRMED', 'CLOSED'].includes(o.status)).map((o) => o.ocNo),
  };
  // P2-08: receipt cancellation advice (legacy CANCEL_TYPE 'B' = bounce)
  impact.adviceNo = await writeReceiptAdvice(tx, actor, {
    brnch,
    customerCode: brv.customerCode,
    receiptNo,
    amount: brv.amount,
    kind: 'B',
    remarks: reason,
  });
  await audit(tx, actor, brnch, receiptNo, 'BOUNCE', {
    reason,
    newValues: { returnDate, ...impact },
  });
  return { brv: await getBrv(tx, brnch, receiptNo), impact };
}

/** BR-BRV-06: cancel only while ENTERED, with reason. */
export async function cancelBrv(tx, actor, brnch, receiptNo, rowVer, reason) {
  const brv = await getBrv(tx, brnch, receiptNo, { forUpdate: true });
  if (brv.rowVer !== rowVer) throw Errors.versionConflict();
  if (brv.status !== 'ENTERED')
    throw Errors.rule(
      'BR-BRV-06',
      `BRV ${receiptNo} is ${brv.status}: after verification use bounce or a debit note`,
    );
  const n = await repo.setStatus(tx, {
    brnch,
    receiptNo,
    rowVer,
    status: 'CANCELLED',
    ...actor,
    sets: {
      CANCEL_REASON: reason,
      CANCELLED_BY: actor.usrid,
      CANCELLED_ON: actor.now,
    },
  });
  if (n !== 1) throw Errors.versionConflict();
  await writeReceiptAdvice(tx, actor, {
    brnch,
    customerCode: brv.customerCode,
    receiptNo,
    amount: brv.amount,
    kind: 'C',
    remarks: reason,
  });
  await audit(tx, actor, brnch, receiptNo, 'CANCEL', { reason });
  return getBrv(tx, brnch, receiptNo);
}
