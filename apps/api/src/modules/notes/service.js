// Credit / debit notes (BUSINESS_RULES §14 BR-NOTE-01…05, §13; TASKS P4-01).
//
// Life: DRAFT (number allocated) → submit → PENDING_APPROVAL with an approval request
// NOTE_POST (amount = net, condition = note type) → approved → POSTED: Cr (credit note) / Dr
// (debit note) the net amount in the DO and the DC ledger, legacy POST = 'Y'. When no NOTE_POST
// rule applies, submit posts at once and needs `note.post`. Rejected → back to DRAFT. A posted
// note is never edited (BR-NOTE-05): `reverse` writes a note of the other kind (same type and
// lines, REVERSAL_OF_SRL = original), posted at once with ledger rows pointing at the original
// ones, and marks the original REVERSED. DRAFT / PENDING_APPROVAL notes can be cancelled (the
// number stays used, BR-NUM). A draft is not edited: its lines could only be replaced by deleting
// CREDIT_NOTE_DETAIL rows (CLAUDE.md rule 7), so a wrong draft is cancelled and entered again.
//
// Legacy rows (no DOC_STATUS) are shown as POSTED; they have no CUSTOMER_LEDGER rows until the
// opening balances are built (P6-03), so reversing one posts plain opposite rows.
import {
  businessDate,
  dec,
  fiscalYearOf,
  narration,
  noteDocType,
  noteTotals,
  salesReturnProblem,
} from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { cancelRequest, onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import * as ledger from '../ledger/service.js';
import { nextNumber } from '../numbering/service.js';
import { SettingsReader } from '../settings/service.js';

const ENTITY = 'CREDIT_NOTE';
export const noteKey = (brnch, kind, srlNo) => `${brnch}|${kind}|${srlNo}`;
const parseKey = (k) => {
  const [b, kind, n] = String(k).split('|');
  return { brnch: Number(b), kind, srlNo: Number(n) };
};
const toDate = (s) => new Date(`${s}T00:00:00+05:00`);
const STATUS = `NVL(n.DOC_STATUS, 'POSTED')`;

const COLS = `n.BRNCH, n.DB_CR_CD, n.SRL_NO, n.NOTE_TYPE, t.DESCRIPTION AS TYPE_NAME,
  TO_CHAR(n.DB_CR_DATE, 'YYYY-MM-DD') AS NOTE_DATE, n.CUSTOMER_CODE, c.CUSTOMER_NAME, n.REMARKS,
  n.AMOUNT, n.WITHHOLDING_TAX, n.NET_AMOUNT, ${STATUS} AS STATUS, n.ROW_VER,
  NVL(n.CREATED_BY, n.ENTER_BY) AS CREATED_BY, NVL(n.CREATED_ON, n.ENTER_DATE) AS CREATED_ON,
  n.POST_BY, n.POST_DATE, n.APPROVAL_REQ_ID, n.REVERSAL_OF_SRL, n.INVOICE_ID, n.CANCEL_REASON,
  n.TRANSFER_CUSTOMER, n.SOURCE_RUN,
  (SELECT TO_CHAR(i.INVOICE_NO) FROM SALES_INVOICE i WHERE i.INVOICE_ID = n.INVOICE_ID) AS INVOICE_NO,
  (SELECT MIN(r.SRL_NO) FROM CREDIT_NOTE r WHERE r.BRNCH = n.BRNCH AND r.REVERSAL_OF_SRL = n.SRL_NO
     AND r.DB_CR_CD <> n.DB_CR_CD) AS REVERSED_BY_SRL`;
const FROM = `CREDIT_NOTE n
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = n.BRNCH AND c.CUSTOMER_CODE = n.CUSTOMER_CODE
  LEFT JOIN CREDIT_NOTE_TYPE t ON t.BRNCH = n.BRNCH AND t.CODE = n.NOTE_TYPE`;

const money = (v) => dec(v ?? 0).toFixed(2);
const nOrNull = (v) => (v === null || v === undefined ? null : String(v));

function mapNote(r) {
  const gross = money(r.AMOUNT);
  return {
    brnch: Number(r.BRNCH),
    kind: r.DB_CR_CD,
    srlNo: String(r.SRL_NO),
    noteType: r.NOTE_TYPE,
    typeName: r.TYPE_NAME ?? null,
    date: r.NOTE_DATE,
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    remarks: r.REMARKS ?? null,
    gross,
    wht: money(r.WITHHOLDING_TAX),
    // legacy rows keep only AMOUNT
    net: r.NET_AMOUNT === null || r.NET_AMOUNT === undefined ? gross : money(r.NET_AMOUNT),
    status: r.STATUS,
    rowVer: Number(r.ROW_VER ?? 0),
    createdBy: r.CREATED_BY ?? null,
    createdOn: r.CREATED_ON ?? null,
    postedBy: r.POST_BY ?? null,
    postedOn: r.POST_DATE ?? null,
    requestId: r.APPROVAL_REQ_ID === null ? null : Number(r.APPROVAL_REQ_ID),
    reversalOf: nOrNull(r.REVERSAL_OF_SRL),
    reversedBy: nOrNull(r.REVERSED_BY_SRL),
    invoiceId: r.INVOICE_ID === null ? null : Number(r.INVOICE_ID),
    invoiceNo: r.INVOICE_NO ?? null,
    cancelReason: r.CANCEL_REASON ?? null,
    transferCustomer: r.TRANSFER_CUSTOMER ?? null,
    sourceRun: r.SOURCE_RUN ?? null,
  };
}

/** @param {{ branches: number[], transfer?: 'Y'|'N', kind?: string, type?: string, customer?: string, from?: string, to?: string, status?: string, page?: number, pageSize?: number }} o */
export async function listNotes(tx, o) {
  const bf = branchFilter('n.BRNCH', o.branches);
  const binds = { ...bf.binds };
  const where = [bf.sql];
  const add = (sql, k, v) => {
    if (v === undefined || v === null || v === '') return;
    where.push(sql);
    binds[k] = v;
  };
  add('n.DB_CR_CD = :kind', 'kind', o.kind);
  if (o.transfer === 'Y') where.push('n.TRANSFER_CUSTOMER IS NOT NULL');
  if (o.transfer === 'N') where.push('n.TRANSFER_CUSTOMER IS NULL');
  add('n.NOTE_TYPE = :nt', 'nt', o.type);
  add('n.CUSTOMER_CODE = :cu', 'cu', o.customer);
  add(`${STATUS} = :st`, 'st', o.status);
  if (o.from) add(`n.DB_CR_DATE >= TO_DATE(:fr, 'YYYY-MM-DD')`, 'fr', o.from);
  if (o.to) add(`n.DB_CR_DATE < TO_DATE(:tod, 'YYYY-MM-DD') + 1`, 'tod', o.to);
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ORDER BY n.DB_CR_DATE DESC, n.SRL_NO DESC, n.DB_CR_CD, n.BRNCH`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapNote) };
}

async function linesOf(tx, brnch, kind, srlNo) {
  const rows = await tx.many(
    `SELECT SR_NO, PARTICULAR, AMOUNT, WHT_PERC FROM CREDIT_NOTE_DETAIL
      WHERE BRNCH = :b AND SRL_NO = :n AND DB_CR_CD = :k ORDER BY SR_NO`,
    { b: brnch, n: srlNo, k: kind },
  );
  return rows.map((r) => ({
    srNo: Number(r.SR_NO),
    particular: r.PARTICULAR ?? '',
    amount: money(r.AMOUNT),
    whtPct: r.WHT_PERC === null ? null : String(r.WHT_PERC),
  }));
}

/** One note with its lines; 404 when it does not exist. */
export async function getNote(tx, brnch, kind, srlNo, { forUpdate = false } = {}) {
  const k = { b: brnch, k: kind, n: srlNo };
  if (forUpdate) {
    const lock = await tx.one(
      'SELECT SRL_NO FROM CREDIT_NOTE WHERE BRNCH = :b AND DB_CR_CD = :k AND SRL_NO = :n FOR UPDATE',
      k,
    );
    if (!lock) throw Errors.notFound(`${kind === 'D' ? 'Debit' : 'Credit'} note ${srlNo}`);
  }
  const r = await tx.one(
    `SELECT * FROM (SELECT ${COLS} FROM ${FROM}
       WHERE n.BRNCH = :b AND n.DB_CR_CD = :k AND n.SRL_NO = :n ORDER BY n.NOTE_TYPE) WHERE ROWNUM = 1`,
    k,
  );
  if (!r) throw Errors.notFound(`${kind === 'D' ? 'Debit' : 'Credit'} note ${srlNo}`);
  return { ...mapNote(r), lines: await linesOf(tx, brnch, kind, Number(srlNo)) };
}

/** Note types of a branch (CREDIT_NOTE_TYPE: codes differ between Karachi and Hattar). */
export async function noteTypes(tx, brnch) {
  const rows = await tx.many(
    `SELECT CODE, DESCRIPTION FROM CREDIT_NOTE_TYPE WHERE BRNCH = :b AND ACTIVE = 'Y' ORDER BY CODE`,
    { b: brnch },
  );
  const salesReturn = await new SettingsReader(tx).get(brnch, 'NOTE_TYPE_SALES_RETURN');
  return rows.map((r) => ({
    code: r.CODE,
    name: r.DESCRIPTION,
    salesReturn: r.CODE === salesReturn, // OPEN-Q5: needs an invoice
  }));
}

/** Checks shared by create and update; returns the totals. */
async function checked(tx, actor, brnch, kind, srlNo, body) {
  const c = await tx.one(
    'SELECT CLOSED, DOC_STATUS FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c',
    { b: brnch, c: body.customerCode },
  );
  if (!c) throw Errors.notFound(`Customer ${body.customerCode}`);
  if (c.CLOSED === 'Y' || c.DOC_STATUS === 'CLOSED')
    throw Errors.rule('BR-CUS-02', `Customer ${body.customerCode} is closed`);
  const type = await tx.one(
    `SELECT CODE FROM CREDIT_NOTE_TYPE WHERE BRNCH = :b AND CODE = :t AND ACTIVE = 'Y'`,
    { b: brnch, t: body.noteType },
  );
  if (!type) throw Errors.rule('BR-NOTE-01', `Note type ${body.noteType} does not exist here`);
  if (body.date > businessDate(actor.now))
    throw Errors.rule('BR-DQ-01', 'A note cannot be dated in the future');
  const totals = noteTotals(body.lines);
  if (dec(totals.net).lte(0)) throw Errors.rule('BR-NOTE-02', 'The net amount must be above 0');

  // BR-NOTE-01 / OPEN-Q5: the sales-return type returns (part of) one invoice of the customer
  const salesReturn = await new SettingsReader(tx).get(brnch, 'NOTE_TYPE_SALES_RETURN');
  const isReturn = kind === 'C' && body.noteType === salesReturn;
  if (isReturn && !body.invoiceId)
    throw Errors.rule('BR-NOTE-01', 'A sales-return note needs the invoice it returns');
  if (!isReturn && body.invoiceId)
    throw Errors.rule('BR-NOTE-01', 'Only a sales-return credit note is linked to an invoice');
  if (isReturn) {
    const inv = await tx.one(
      `SELECT CUSTOMER_CODE, STATUS, TOTAL_COLLECTABLE FROM SALES_INVOICE
        WHERE INVOICE_ID = :id AND BRNCH = :b FOR UPDATE`,
      { id: body.invoiceId, b: brnch },
    );
    if (!inv) throw Errors.notFound(`Invoice ${body.invoiceId}`);
    const earlier = await tx.one(
      `SELECT NVL(SUM(NVL(NET_AMOUNT, AMOUNT)), 0) AS AMT FROM CREDIT_NOTE
        WHERE BRNCH = :b AND INVOICE_ID = :id AND DB_CR_CD = 'C'
          AND NVL(DOC_STATUS, 'POSTED') NOT IN ('CANCELLED', 'REVERSED')
          AND NOT (SRL_NO = :n AND DB_CR_CD = 'C')`,
      { b: brnch, id: body.invoiceId, n: srlNo ?? -1 },
    );
    const problem = salesReturnProblem(
      {
        customerCode: inv.CUSTOMER_CODE,
        status: inv.STATUS,
        totalCollectable: money(inv.TOTAL_COLLECTABLE),
      },
      { customerCode: body.customerCode, net: totals.net, earlierReturns: money(earlier.AMT) },
    );
    if (problem) throw Errors.rule(problem.ruleId, problem.detail);
  }
  return totals;
}

async function writeLines(tx, brnch, kind, srlNo, noteType, lines) {
  let srNo = 0;
  for (const l of lines) {
    srNo += 1;
    await tx.exec(
      `INSERT INTO CREDIT_NOTE_DETAIL (SRL_NO, SR_NO, PARTICULAR, AMOUNT, DB_CR_CD, NOTE_TYPE, WHT_PERC,
         COMPC, BRNCH)
       VALUES (:n, :sr, :p, :amt, :k, :t, :w, 1, :b)`,
      {
        n: srlNo,
        sr: srNo,
        p: l.particular.slice(0, 60),
        amt: l.amount,
        k: kind,
        t: noteType,
        w: l.whtPct ?? null,
        b: brnch,
      },
    );
  }
}

/** POST /notes: DRAFT note with its number (BR-NUM: the number stays used even if cancelled). */
export async function createNote(tx, actor, brnch, body, extra = {}) {
  const totals = await checked(tx, actor, brnch, body.kind, null, body);
  const srlNo = Number(
    await nextNumber(tx, {
      brnch,
      year: fiscalYearOf(actor.now),
      docType: noteDocType(body.kind),
    }),
  );
  await tx.exec(
    `INSERT INTO CREDIT_NOTE (SRL_NO, DB_CR_DATE, CUSTOMER_CODE, DB_CR_CD, NOTE_TYPE, AMOUNT, ENTER_BY,
       ENTER_DATE, REMARKS, POST, WITHHOLDING_TAX, NET_AMOUNT, COMPC, BRNCH, DOC_STATUS, ROW_VER,
       CREATED_BY, CREATED_ON, INVOICE_ID, REVERSAL_OF_SRL, SOURCE_RUN, TRANSFER_CUSTOMER)
     VALUES (:n, :d, :c, :k, :t, :gross, :u10, :now, :rem, 'N', :wht, :net, 1, :b, 'DRAFT', 1,
       :u, :now, :inv, :rev, :run, :trf)`,
    {
      n: srlNo,
      d: toDate(body.date),
      c: body.customerCode,
      k: body.kind,
      t: body.noteType,
      gross: totals.gross,
      u10: actor.usrid.slice(0, 10),
      now: actor.now,
      rem: body.remarks ?? null,
      wht: totals.wht,
      net: totals.net,
      b: brnch,
      u: actor.usrid,
      inv: body.invoiceId ?? null,
      rev: extra.reversalOf ?? null,
      run: extra.sourceRun ?? null,
      trf: extra.transferCustomer ?? null,
    },
  );
  await writeLines(tx, brnch, body.kind, srlNo, body.noteType, body.lines);
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: noteKey(brnch, body.kind, srlNo),
    action: 'CREATE',
    brnch,
    newValues: { ...body, ...totals, lines: undefined },
  });
  return getNote(tx, brnch, body.kind, srlNo);
}

/**
 * POST /notes/transfer (BR-NOTE-04): one document moving `amount` from customer A to customer B —
 * a DRAFT credit note to B with A in TRANSFER_CUSTOMER, type NOTE_TYPE_TRANSFER (OPEN: legacy
 * transfers used a pair of C/D notes). It follows the note life (submit → NOTE_POST → posted).
 */
export async function createTransfer(tx, actor, brnch, body) {
  if (body.fromCustomer === body.toCustomer)
    throw Errors.rule('BR-NOTE-04', 'A transfer needs two different customers');
  const from = await tx.one(
    'SELECT CLOSED, DOC_STATUS FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c',
    { b: brnch, c: body.fromCustomer },
  );
  if (!from) throw Errors.notFound(`Customer ${body.fromCustomer}`);
  if (from.CLOSED === 'Y' || from.DOC_STATUS === 'CLOSED')
    throw Errors.rule('BR-CUS-02', `Customer ${body.fromCustomer} is closed`);
  const noteType = await new SettingsReader(tx).get(brnch, 'NOTE_TYPE_TRANSFER');
  return createNote(
    tx,
    actor,
    brnch,
    {
      kind: 'C',
      noteType,
      customerCode: body.toCustomer,
      date: body.date,
      remarks: body.remarks ?? null,
      invoiceId: null,
      lines: [{ particular: body.particular, amount: body.amount, whtPct: null }],
    },
    { transferCustomer: body.fromCustomer },
  );
}

/** Ledger rows of a posted note: DO and DC ledger, Cr for a credit note, Dr for a debit note. */
function ledgerRows(note, entryKind = 'NOTE') {
  const side = note.kind === 'C' ? { credit: note.net } : { debit: note.net };
  const text = narration.note({
    kind: noteDocType(note.kind),
    noteNo: note.srlNo,
    reason: [
      `${note.noteType}${note.typeName ? ` ${note.typeName}` : ''}`,
      note.invoiceNo ? `INV # ${note.invoiceNo}` : null,
      note.reversalOf ? `reverses # ${note.reversalOf}` : null,
      note.remarks,
    ]
      .filter(Boolean)
      .join(' · '),
  });
  const base = {
    brnch: note.brnch,
    entryDate: note.date,
    docType: noteDocType(note.kind),
    docYear: null,
    docNo: note.srlNo,
  };
  if (note.transferCustomer) {
    // BR-NOTE-04: balance transfer A → B. The note is a credit note to B (customerCode) with A in
    // TRANSFER_CUSTOMER: Dr A, Cr B in both ledgers; its reversal (debit note) swaps the sides.
    const from = note.kind === 'C' ? note.transferCustomer : note.customerCode;
    const to = note.kind === 'C' ? note.customerCode : note.transferCustomer;
    const trf = narration.transfer({
      transferNo: `${noteDocType(note.kind)} ${note.srlNo}`,
      from: note.transferCustomer,
      to: note.customerCode,
    });
    const text2 = note.reversalOf ? `${trf} · reverses # ${note.reversalOf}` : trf;
    return ['DO', 'DC'].flatMap((ledgerType) => [
      {
        ...base,
        ledgerType,
        customerCode: from,
        entryKind: 'TRANSFER_OUT',
        narration: text2,
        debit: note.net,
      },
      {
        ...base,
        ledgerType,
        customerCode: to,
        entryKind: 'TRANSFER_IN',
        narration: text2,
        credit: note.net,
      },
    ]);
  }
  return ['DO', 'DC'].map((ledgerType) => ({
    ...base,
    customerCode: note.customerCode,
    ledgerType,
    entryKind,
    narration: text,
    ...side,
  }));
}

async function setStatus(tx, actor, note, status, sets = '', binds = {}) {
  const n = await tx.exec(
    `UPDATE CREDIT_NOTE SET DOC_STATUS = :st, ROW_VER = ROW_VER + 1, UPDATED_BY = :u, UPDATED_ON = :now
       ${sets}
     WHERE BRNCH = :b AND DB_CR_CD = :k AND SRL_NO = :n AND ROW_VER = :rv`,
    {
      st: status,
      u: actor.usrid,
      now: actor.now,
      b: note.brnch,
      k: note.kind,
      n: Number(note.srlNo),
      rv: note.rowVer,
      ...binds,
    },
  );
  if (n !== 1) throw Errors.versionConflict();
}

/** PENDING_APPROVAL → POSTED: both ledgers, legacy POST flag. */
async function postNote(tx, actor, note) {
  await ledger.post(tx, actor, ledgerRows(note));
  await setStatus(tx, actor, note, 'POSTED', `, POST = 'Y', POST_BY = :pb, POST_DATE = :now`, {
    pb: actor.usrid.slice(0, 10),
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: noteKey(note.brnch, note.kind, note.srlNo),
    action: 'POST',
    brnch: note.brnch,
    newValues: { net: note.net },
  });
}

/**
 * Submit a DRAFT (BR-NOTE-03): NOTE_POST approval request, or straight to POSTED when no rule
 * applies (then the user needs `note.post`).
 * @param {{ canPost: boolean }} opts
 */
export async function submitNote(tx, actor, brnch, kind, srlNo, rowVer, opts) {
  const note = await getNote(tx, brnch, kind, srlNo, { forUpdate: true });
  if (note.rowVer !== rowVer) throw Errors.versionConflict();
  if (note.status !== 'DRAFT')
    throw Errors.invalidState(`Note ${srlNo} is ${note.status}: only a draft can be submitted`);
  const key = noteKey(brnch, kind, srlNo);
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch,
      docType: 'NOTE_POST',
      docKey: key,
      action: 'NOTE_POST',
      snapshot: {
        kind,
        srlNo,
        noteType: note.noteType,
        customerCode: note.customerCode,
        transferFrom: note.transferCustomer,
        net: note.net,
        lines: note.lines,
      },
      amount: note.net,
      conditionCode: note.noteType,
      reason: note.remarks ?? `${kind === 'D' ? 'Debit' : 'Credit'} note ${srlNo}`,
    },
  );
  await setStatus(tx, actor, note, 'PENDING_APPROVAL', ', APPROVAL_REQ_ID = :req', {
    req: res.required ? res.requestId : null,
  });
  if (!res.required) {
    if (!opts.canPost)
      throw Errors.forbidden('No approval rule applies: you need note.post to post this note');
    await postNote(tx, actor, await getNote(tx, brnch, kind, srlNo));
  } else {
    await recordAudit(tx, actor.audit, { entity: ENTITY, key, action: 'SUBMIT', brnch });
  }
  return {
    note: await getNote(tx, brnch, kind, srlNo),
    requestId: res.required ? res.requestId : null,
  };
}

onApproved('NOTE_POST', async (tx, req, ctx) => {
  const k = parseKey(req.docKey);
  const note = await getNote(tx, k.brnch, k.kind, k.srlNo, { forUpdate: true });
  if (note.status !== 'PENDING_APPROVAL') return;
  await postNote(tx, { usrid: ctx.usrid, now: ctx.now, audit: ctx }, note);
});

onRejected('NOTE_POST', async (tx, req, ctx) => {
  const k = parseKey(req.docKey);
  const note = await getNote(tx, k.brnch, k.kind, k.srlNo, { forUpdate: true });
  if (note.status !== 'PENDING_APPROVAL') return;
  await setStatus(
    tx,
    { usrid: ctx.usrid, now: ctx.now },
    note,
    'DRAFT',
    ', APPROVAL_REQ_ID = NULL',
  );
  await recordAudit(tx, ctx, {
    entity: ENTITY,
    key: req.docKey,
    action: req.status === 'CANCELLED' ? 'WITHDRAW' : 'REJECT',
    brnch: k.brnch,
  });
});

/** Cancel a DRAFT or PENDING_APPROVAL note (withdraws its approval request). */
export async function cancelNote(tx, actor, brnch, kind, srlNo, rowVer, reason) {
  let note = await getNote(tx, brnch, kind, srlNo, { forUpdate: true });
  if (note.rowVer !== rowVer) throw Errors.versionConflict();
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(note.status))
    throw Errors.invalidState(
      `Note ${srlNo} is ${note.status}: a posted note is corrected by reversing it (BR-NOTE-05)`,
    );
  if (note.status === 'PENDING_APPROVAL' && note.requestId) {
    await cancelRequest(tx, { ...actor.audit, now: actor.now }, note.requestId); // → DRAFT
    note = await getNote(tx, brnch, kind, srlNo);
  }
  await setStatus(
    tx,
    actor,
    note,
    'CANCELLED',
    ', CANCEL_REASON = :r, CANCELLED_BY = :u, CANCELLED_ON = :now',
    { r: reason.slice(0, 500) },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: noteKey(brnch, kind, srlNo),
    action: 'CANCEL',
    brnch,
    reason,
  });
  return getNote(tx, brnch, kind, srlNo);
}

/**
 * BR-NOTE-05: reverse a POSTED note with a note of the other kind (same type, lines and amounts),
 * posted at once; the original becomes REVERSED.
 */
export async function reverseNote(tx, actor, brnch, kind, srlNo, rowVer, reason) {
  const note = await getNote(tx, brnch, kind, srlNo, { forUpdate: true });
  if (note.rowVer !== rowVer) throw Errors.versionConflict();
  if (note.status !== 'POSTED')
    throw Errors.invalidState(
      `Note ${srlNo} is ${note.status}: only a posted note can be reversed`,
    );
  if (note.reversalOf)
    throw Errors.invalidState(`Note ${srlNo} is itself a reversal: issue a new note instead`);
  const other = kind === 'C' ? 'D' : 'C';
  const today = businessDate(actor.now);
  const lines = note.lines.length
    ? note.lines.map((l) => ({ particular: l.particular, amount: l.amount, whtPct: l.whtPct }))
    : [{ particular: `Reversal of ${noteDocType(kind)} ${srlNo}`, amount: note.net }];
  const totals = noteTotals(lines);
  const revNo = Number(
    await nextNumber(tx, { brnch, year: fiscalYearOf(actor.now), docType: noteDocType(other) }),
  );
  await tx.exec(
    `INSERT INTO CREDIT_NOTE (SRL_NO, DB_CR_DATE, CUSTOMER_CODE, DB_CR_CD, NOTE_TYPE, AMOUNT, ENTER_BY,
       ENTER_DATE, REMARKS, POST, POST_BY, POST_DATE, WITHHOLDING_TAX, NET_AMOUNT, COMPC, BRNCH,
       DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON, INVOICE_ID, REVERSAL_OF_SRL, TRANSFER_CUSTOMER)
     VALUES (:n, :d, :c, :k, :t, :gross, :u10, :now, :rem, 'Y', :u10, :now, :wht, :net, 1, :b,
       'POSTED', 1, :u, :now, :inv, :rev, :trf)`,
    {
      n: revNo,
      d: toDate(today),
      c: note.customerCode,
      k: other,
      t: note.noteType,
      gross: totals.gross,
      u10: actor.usrid.slice(0, 10),
      now: actor.now,
      rem: `Reversal of ${noteDocType(kind)} ${srlNo}: ${reason}`.slice(0, 500),
      wht: totals.wht,
      net: totals.net,
      b: brnch,
      u: actor.usrid,
      inv: note.invoiceId,
      rev: Number(srlNo),
      trf: note.transferCustomer,
    },
  );
  await writeLines(tx, brnch, other, revNo, note.noteType, lines);
  const rev = await getNote(tx, brnch, other, revNo);
  // ledger: point at the original rows when there are some (new notes); legacy notes have none
  const orig = await ledger.documentRows(tx, {
    brnch,
    docType: noteDocType(kind),
    docNo: srlNo,
    docYear: null,
  });
  const open = orig.filter((r) => !r.reversalOf);
  if (open.length) {
    await ledger.post(
      tx,
      actor,
      open.map((r) => ({
        ...ledgerRows(rev).find(
          (x) => x.ledgerType === r.ledgerType && x.customerCode === r.customerCode,
        ),
        reversalOf: r.ledgerId,
      })),
    );
  } else {
    await ledger.post(tx, actor, ledgerRows(rev));
  }
  await setStatus(tx, actor, note, 'REVERSED');
  const key = noteKey(brnch, kind, srlNo);
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key,
    action: 'REVERSE',
    brnch,
    reason,
    newValues: { reversedBy: noteKey(brnch, other, revNo) },
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: noteKey(brnch, other, revNo),
    action: 'CREATE',
    brnch,
    reason,
    newValues: { reversalOf: key, net: totals.net },
  });
  return { note: await getNote(tx, brnch, kind, srlNo), reversal: rev };
}
