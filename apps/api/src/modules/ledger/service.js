// Ledger posting service (BUSINESS_RULES §13, TASKS P2-00). Callers post inside the business
// transaction of the source document (CLAUDE.md rule 6). Insert-only: the UK
// (BRNCH, LEDGER_TYPE, DOC_TYPE, DOC_YEAR, DOC_NO, DOC_LINE, ENTRY_KIND, CUSTOMER_CODE)
// stops double posting; a reversal is a new row with REVERSAL_OF.
import { dec, reversalEntry, runningStatement, zLedgerEntry } from '@dcl/shared';
import { AppError, Errors, oraCode } from '../../lib/errors.js';

const INSERT = `INSERT INTO CUSTOMER_LEDGER
  (LEDGER_ID, BRNCH, CUSTOMER_CODE, LEDGER_TYPE, ENTRY_DATE, DOC_TYPE, DOC_YEAR, DOC_NO, DOC_LINE,
   ENTRY_KIND, NARRATION, DEBIT, CREDIT, QTY_TON, GL_CODE, REVERSAL_OF, CREATED_BY, CREATED_ON)
  VALUES (:id, :brnch, :code, :lt, TO_DATE(:ed, 'YYYY-MM-DD'), :dt, :dy, :dn, :dl,
   :ek, :narr, :dr, :cr, :qty, :gl, :rev, :usr, :now)`;

const COLS = `LEDGER_ID, BRNCH, CUSTOMER_CODE, LEDGER_TYPE, TO_CHAR(ENTRY_DATE, 'YYYY-MM-DD') AS ED,
  DOC_TYPE, DOC_YEAR, DOC_NO, DOC_LINE, ENTRY_KIND, NARRATION, DEBIT, CREDIT, QTY_TON, GL_CODE,
  REVERSAL_OF, CREATED_BY, CREATED_ON`;

const n2 = (v) => dec(v ?? 0).toFixed(2);

/** Mapped CUSTOMER_LEDGER row. */
export function mapRow(r) {
  return {
    ledgerId: Number(r.LEDGER_ID),
    brnch: Number(r.BRNCH),
    customerCode: r.CUSTOMER_CODE,
    ledgerType: r.LEDGER_TYPE,
    entryDate: r.ED,
    docType: r.DOC_TYPE,
    docYear: r.DOC_YEAR === null ? null : Number(r.DOC_YEAR),
    docNo: r.DOC_NO,
    docLine: Number(r.DOC_LINE),
    entryKind: r.ENTRY_KIND,
    narration: r.NARRATION,
    debit: n2(r.DEBIT),
    credit: n2(r.CREDIT),
    qtyTon: r.QTY_TON === null ? null : dec(r.QTY_TON).toFixed(3),
    glCode: r.GL_CODE ?? null,
    reversalOf: r.REVERSAL_OF === null ? null : Number(r.REVERSAL_OF),
    createdBy: r.CREATED_BY,
    createdOn: r.CREATED_ON,
  };
}

/** BR-LED-03: GL account of an entry from GL_MAP (BRNCH, DOC_TYPE, ENTRY_CODE); null if unmapped. */
async function glCodeFor(tx, cache, brnch, docType, entryKind) {
  const k = `${brnch}|${docType}|${entryKind}`;
  if (!cache.has(k)) {
    const r = await tx.one(
      'SELECT ACC_CODE FROM GL_MAP WHERE BRNCH = :b AND DOC_TYPE = :dt AND ENTRY_CODE = :ek',
      { b: brnch, dt: docType, ek: entryKind },
    );
    cache.set(k, r?.ACC_CODE ?? null);
  }
  return cache.get(k);
}

/**
 * Post ledger rows (all or nothing with the caller's transaction).
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ usrid: string, now: Date }} actor
 * @param {(import('zod').input<typeof zLedgerEntry> & { reversalOf?: number })[]} entries
 * @returns {Promise<number[]>} new LEDGER_IDs
 */
export async function post(tx, actor, entries) {
  const gl = new Map();
  const known = new Set();
  const ids = [];
  for (const raw of entries) {
    const parsed = zLedgerEntry.safeParse(raw);
    if (!parsed.success) {
      throw Errors.validation(
        'Ledger entry is not valid',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    const e = parsed.data;
    const ck = `${e.brnch}|${e.customerCode}`;
    if (!known.has(ck)) {
      const c = await tx.one(
        'SELECT 1 AS X FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c',
        { b: e.brnch, c: e.customerCode },
      );
      if (!c) throw Errors.notFound(`Customer ${e.customerCode} in branch ${e.brnch}`);
      known.add(ck);
    }
    const id = await tx.nextId('SEQ_CUSTOMER_LEDGER');
    try {
      await tx.exec(INSERT, {
        id,
        brnch: e.brnch,
        code: e.customerCode,
        lt: e.ledgerType,
        ed: e.entryDate,
        dt: e.docType,
        dy: e.docYear ?? null,
        dn: e.docNo,
        dl: e.docLine,
        ek: e.entryKind,
        narr: e.narration,
        dr: dec(e.debit).toFixed(2),
        cr: dec(e.credit).toFixed(2),
        qty: e.qtyTon ?? null,
        gl: await glCodeFor(tx, gl, e.brnch, e.docType, e.entryKind),
        rev: raw.reversalOf ?? null,
        usr: actor.usrid,
        now: actor.now,
      });
    } catch (err) {
      if (oraCode(err) === 1) {
        throw new AppError(
          'duplicate',
          409,
          `${e.docType} ${e.docNo} is already posted to the ${e.ledgerType} ledger of ${e.customerCode} (${e.entryKind})`,
          { ruleId: 'BR-LED', cause: err },
        );
      }
      throw err;
    }
    ids.push(id);
  }
  return ids;
}

/** Rows of one source document (both ledgers), oldest first. */
export async function documentRows(tx, { brnch, docType, docNo, docYear }) {
  const rows = await tx.many(
    `SELECT ${COLS} FROM CUSTOMER_LEDGER
      WHERE BRNCH = :b AND DOC_TYPE = :dt AND DOC_NO = :dn
        AND (DOC_YEAR = :dy OR (:dy IS NULL AND DOC_YEAR IS NULL))
      ORDER BY LEDGER_ID`,
    { b: brnch, dt: docType, dn: String(docNo), dy: docYear ?? null },
  );
  return rows.map(mapRow);
}

/**
 * Reverse every row of a document that is not a reversal and not yet reversed
 * (e.g. invoice cancelled pre-FBR, BR-LED table). Returns the new LEDGER_IDs.
 * @param {Parameters<typeof reversalEntry>[1]} over
 */
export async function reverseDocument(tx, actor, doc, over) {
  const rows = await documentRows(tx, doc);
  const reversed = new Set(rows.filter((r) => r.reversalOf).map((r) => r.reversalOf));
  const open = rows.filter((r) => !r.reversalOf && !reversed.has(r.ledgerId));
  if (!open.length) throw Errors.invalidState(`${doc.docType} ${doc.docNo} has nothing to reverse`);
  return post(
    tx,
    actor,
    open.map((r) => reversalEntry(r, over)),
  );
}

/** Ledger balance (debit − credit) on or before `asOf` (inclusive), or overall. */
export async function balance(tx, { brnch, customerCode, ledgerType, asOf }) {
  const r = await tx.one(
    `SELECT NVL(SUM(DEBIT), 0) - NVL(SUM(CREDIT), 0) AS BAL FROM CUSTOMER_LEDGER
      WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND LEDGER_TYPE = :lt
        AND (:asof IS NULL OR ENTRY_DATE < TO_DATE(:asof, 'YYYY-MM-DD') + 1)`,
    { b: brnch, c: customerCode, lt: ledgerType, asof: asOf ?? null },
  );
  return n2(r.BAL);
}

export const STATEMENT_MAX_LINES = 5000;

/** R1 (DO) / R13 (DC) statement for a date range (API_SPEC §13). */
export async function statement(tx, { brnch, customerCode, ledgerType, from, to }) {
  const opening = await tx.one(
    `SELECT NVL(SUM(DEBIT), 0) - NVL(SUM(CREDIT), 0) AS BAL FROM CUSTOMER_LEDGER
      WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND LEDGER_TYPE = :lt
        AND ENTRY_DATE < TO_DATE(:f, 'YYYY-MM-DD')`,
    { b: brnch, c: customerCode, lt: ledgerType, f: from },
  );
  const rows = await tx.many(
    `SELECT ${COLS} FROM CUSTOMER_LEDGER
      WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND LEDGER_TYPE = :lt
        AND ENTRY_DATE >= TO_DATE(:f, 'YYYY-MM-DD') AND ENTRY_DATE < TO_DATE(:t, 'YYYY-MM-DD') + 1
      ORDER BY ENTRY_DATE, LEDGER_ID`,
    { b: brnch, c: customerCode, lt: ledgerType, f: from, t: to },
    { maxRows: STATEMENT_MAX_LINES + 1 },
  );
  if (rows.length > STATEMENT_MAX_LINES) {
    throw Errors.rule(
      'R1',
      `More than ${STATEMENT_MAX_LINES} lines in this range; choose a shorter date range`,
    );
  }
  const s = runningStatement(n2(opening.BAL), rows.map(mapRow));
  return { brnch, customerCode, ledgerType, from, to, ...s };
}
