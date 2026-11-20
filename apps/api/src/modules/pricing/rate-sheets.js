// City rate sheets for permit clients (BR-PRC-02/05/06, TASKS P1-07): AREA_RATES_M (sheet) →
// AREA_RATES_P (product) → AREA_RATES_D (city line). A new sheet is a copy of the previous one under
// a new number (DOC_SEQUENCE RSH); it is edited while OPEN, submitted for approval (RATE_CHANGE /
// RATE_SHEET_APPROVE) and then applies from its date. Freight sheets (ZONE_CITY_FRIEGHT_M/D) give
// the last freight rate per city.
import { businessDate, dec, rateChain } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { nextNumber } from '../numbering/service.js';
import { effectivePeriod } from './service.js';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */

const toDate = (iso) => new Date(`${iso}T00:00:00+05:00`);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
/** Legacy sheets have STATUS P (pending/open) or A (approved) and no DOC_STATUS. */
export const SHEET_STATUS_SQL = `NVL(m.DOC_STATUS, CASE WHEN m.STATUS = 'A' THEN 'APPROVED' ELSE 'OPEN' END)`;

function mapSheet(r) {
  return {
    brnch: Number(r.BRNCH),
    serno: Number(r.SERNO),
    date: r.WDATE ? businessDate(r.WDATE) : null,
    status: r.SHEET_STATUS,
    lines: r.LINES === undefined ? undefined : Number(r.LINES),
    createdBy: r.CREATED_BY ?? null,
    approvedBy: r.APPROVED_BY ?? null,
    rowVer: Number(r.ROW_VER),
  };
}

export async function listSheets(tx, { branches, page, pageSize, status }) {
  const bf = branchFilter('m.BRNCH', branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (status) {
    where.push(`${SHEET_STATUS_SQL} = :st`);
    binds.st = status;
  }
  const res = await paginate(tx, {
    sql: `SELECT m.BRNCH, m.SERNO, m.WDATE, ${SHEET_STATUS_SQL} AS SHEET_STATUS, m.CREATED_BY, m.APPROVED_BY, m.ROW_VER,
                 (SELECT COUNT(*) FROM AREA_RATES_D d WHERE d.BRNCH = m.BRNCH AND d.SERNO = m.SERNO) AS LINES
            FROM AREA_RATES_M m WHERE ${where.join(' AND ')}
           ORDER BY m.WDATE DESC NULLS LAST, m.BRNCH, m.SERNO DESC`,
    binds,
    page,
    pageSize,
  });
  return { ...res, items: res.items.map(mapSheet) };
}

async function loadSheet(tx, brnch, serno, { forUpdate = false } = {}) {
  if (forUpdate) {
    await tx.one('SELECT SERNO FROM AREA_RATES_M WHERE BRNCH = :b AND SERNO = :s FOR UPDATE', {
      b: brnch,
      s: serno,
    });
  }
  const r = await tx.one(
    `SELECT m.BRNCH, m.SERNO, m.WDATE, ${SHEET_STATUS_SQL} AS SHEET_STATUS, m.CREATED_BY, m.APPROVED_BY, m.ROW_VER
       FROM AREA_RATES_M m WHERE m.BRNCH = :b AND m.SERNO = :s`,
    { b: brnch, s: serno },
  );
  if (!r) throw Errors.notFound('Rate sheet');
  return mapSheet(r);
}

const LINE_COLS = `d.LNKNO, d.P_LNKNO, p.PRODUCT_CODE, d.ZONE_CODE, d.TERRITORY_CODE, d.AREA_DOC, d.BOOKING_P, d.FREIGHT,
  d.NET_BOOK, d.REBATE, d.EX_FACTORY, d.TAX_236, d.FED, d.SALES_TAX, d.NET_RET, d.MRP`;
const mapLine = (r) => ({
  lnkno: Number(r.LNKNO),
  productCode: r.PRODUCT_CODE,
  zone: r.ZONE_CODE,
  territory: r.TERRITORY_CODE,
  areaDoc: r.AREA_DOC === null ? null : Number(r.AREA_DOC),
  city: r.CITY_NAME ?? null,
  booking: n2(r.BOOKING_P),
  freight: n2(r.FREIGHT),
  netBook: n2(r.NET_BOOK),
  rebate: n2(r.REBATE),
  exFactory: n2(r.EX_FACTORY),
  tax236: n2(r.TAX_236),
  fed: n2(r.FED),
  salesTax: n2(r.SALES_TAX),
  netRet: n2(r.NET_RET),
  mrp: n2(r.MRP),
});
/** City name: AREA (AREA_DOC) of the branch (Hattar); Karachi permit codes may have none. */
const CITY_JOIN = `LEFT JOIN (SELECT BRNCH, AREA_DOC, MAX(AREA_NAME) AS CITY_NAME FROM AREA GROUP BY BRNCH, AREA_DOC) a
  ON a.BRNCH = d.BRNCH AND a.AREA_DOC = d.AREA_DOC`;

export async function getSheet(tx, brnch, serno) {
  const sheet = await loadSheet(tx, brnch, serno);
  const lines = await tx.many(
    `SELECT ${LINE_COLS}, a.CITY_NAME FROM AREA_RATES_D d
       JOIN AREA_RATES_P p ON p.BRNCH = d.BRNCH AND p.P_LNKNO = d.P_LNKNO ${CITY_JOIN}
      WHERE d.BRNCH = :b AND d.SERNO = :s ORDER BY p.PRODUCT_CODE, d.ZONE_CODE, d.TERRITORY_CODE, d.AREA_DOC, d.LNKNO`,
    { b: brnch, s: serno },
  );
  return { ...sheet, lines: lines.map(mapLine) };
}

/** New sheet for a date = copy of the latest earlier sheet (products and city lines). */
export async function createSheet(tx, actor, brnch, date) {
  const exists = await tx.one('SELECT SERNO FROM AREA_RATES_M WHERE BRNCH = :b AND WDATE = :d', {
    b: brnch,
    d: toDate(date),
  });
  if (exists) throw Errors.duplicate(`Rate sheet ${exists.SERNO} already exists for ${date}`);
  const src = await tx.one(
    `SELECT SERNO FROM (SELECT SERNO FROM AREA_RATES_M WHERE BRNCH = :b AND WDATE < :d ORDER BY WDATE DESC, SERNO DESC)
      WHERE ROWNUM = 1`,
    { b: brnch, d: toDate(date) },
  );
  const serno = Number(await nextNumber(tx, { brnch, year: actor.fiscalYear, docType: 'RSH' }));
  await tx.exec(
    `INSERT INTO AREA_RATES_M (SERNO, WDATE, STATUS, COMPC, BRNCH, DOC_STATUS, ROW_VER, CREATED_BY, CREATED_ON)
     VALUES (:s, :d, 'P', 1, :b, 'OPEN', 1, :usr, :now)`,
    { s: serno, d: toDate(date), b: brnch, usr: actor.usrid, now: actor.now },
  );
  let lines = 0;
  if (src) {
    const products = await tx.many(
      'SELECT P_LNKNO, PRODUCT_CODE FROM AREA_RATES_P WHERE BRNCH = :b AND SERNO = :s',
      {
        b: brnch,
        s: Number(src.SERNO),
      },
    );
    for (const p of products) {
      const pl = await tx.nextId('SEQ_AREA_RATES_P');
      await tx.exec(
        'INSERT INTO AREA_RATES_P (SERNO, P_LNKNO, PRODUCT_CODE, COMPC, BRNCH) VALUES (:s, :pl, :pc, 1, :b)',
        { s: serno, pl, pc: p.PRODUCT_CODE, b: brnch },
      );
      lines += await tx.exec(
        `INSERT INTO AREA_RATES_D (SERNO, LNKNO, P_LNKNO, ZONE_CODE, TERRITORY_CODE, AREA_DOC, BOOKING_P, FREIGHT, NET_BOOK,
            REBATE, EX_FACTORY, TAX_236, FED, SALES_TAX, NET_RET, MRP, LINKNO_DIST, COMPC, BRNCH)
         SELECT :s, SEQ_AREA_RATES_D.NEXTVAL, :pl, ZONE_CODE, TERRITORY_CODE, AREA_DOC, BOOKING_P, FREIGHT, NET_BOOK,
            REBATE, EX_FACTORY, TAX_236, FED, SALES_TAX, NET_RET, MRP, LINKNO_DIST, 1, :b
           FROM AREA_RATES_D WHERE BRNCH = :b AND P_LNKNO = :old`,
        { s: serno, pl, b: brnch, old: Number(p.P_LNKNO) },
      );
    }
  }
  await recordAudit(tx, actor.audit, {
    entity: 'AREA_RATES_M',
    key: `${brnch}|${serno}`,
    action: 'CREATE',
    brnch,
    newValues: { date, copiedFrom: src ? Number(src.SERNO) : null, lines },
  });
  return getSheet(tx, brnch, serno);
}

async function openSheet(tx, brnch, serno) {
  const s = await loadSheet(tx, brnch, serno, { forUpdate: true });
  if (s.status !== 'OPEN')
    throw Errors.invalidState(
      `Rate sheet ${serno} is ${s.status.toLowerCase()} and cannot be changed`,
    );
  return s;
}

async function writeLine(tx, brnch, line, values, date) {
  const period = await effectivePeriod(tx, brnch, line.productCode, date);
  if (!period)
    throw Errors.rule('BR-TAX-10', `Product ${line.productCode} has no period on ${date}`);
  const c = rateChain(values, {
    fedPerTon: period.fedPerTon,
    salesTaxPer: period.salesTaxPer ?? '0',
  });
  await tx.exec(
    `UPDATE AREA_RATES_D SET BOOKING_P = :bk, FREIGHT = :fr, NET_BOOK = :nb, REBATE = :rb, EX_FACTORY = :ex, TAX_236 = :t236,
        FED = :fed, SALES_TAX = :st, NET_RET = :nr, MRP = :mrp
      WHERE BRNCH = :b AND LNKNO = :l`,
    {
      bk: c.booking,
      fr: c.freight,
      nb: c.netBook,
      rb: c.rebate,
      ex: c.exFactory,
      t236: c.tax236,
      fed: c.fed,
      st: c.salesTax,
      nr: c.netRet,
      mrp: c.mrp,
      b: brnch,
      l: line.lnkno,
    },
  );
  return c;
}

async function loadLine(tx, brnch, serno, lnkno) {
  const r = await tx.one(
    `SELECT ${LINE_COLS} FROM AREA_RATES_D d JOIN AREA_RATES_P p ON p.BRNCH = d.BRNCH AND p.P_LNKNO = d.P_LNKNO
      WHERE d.BRNCH = :b AND d.SERNO = :s AND d.LNKNO = :l`,
    { b: brnch, s: serno, l: lnkno },
  );
  if (!r) throw Errors.notFound('Rate sheet line');
  return mapLine(r);
}

/** Edit one city line (BR-PRC-05 chain recalculated; FED / ST% from the period at the sheet date). */
export async function updateLine(tx, actor, brnch, serno, lnkno, patch) {
  const sheet = await openSheet(tx, brnch, serno);
  const line = await loadLine(tx, brnch, serno, lnkno);
  const c = await writeLine(tx, brnch, line, { ...line, ...patch }, sheet.date);
  await recordAudit(tx, actor.audit, {
    entity: 'AREA_RATES_D',
    key: `${brnch}|${serno}|${lnkno}`,
    action: 'UPDATE',
    brnch,
    oldValues: Object.fromEntries(Object.keys(patch).map((k) => [k, line[k]])),
    newValues: patch,
  });
  return { ...line, ...c };
}

/** "Set MRP for all lines" of one product (PRD 4.3). */
export async function setMrp(tx, actor, brnch, serno, productCode, mrp) {
  const sheet = await openSheet(tx, brnch, serno);
  const rows = await tx.many(
    `SELECT ${LINE_COLS} FROM AREA_RATES_D d JOIN AREA_RATES_P p ON p.BRNCH = d.BRNCH AND p.P_LNKNO = d.P_LNKNO
      WHERE d.BRNCH = :b AND d.SERNO = :s AND p.PRODUCT_CODE = :pc`,
    { b: brnch, s: serno, pc: productCode },
  );
  if (!rows.length) throw Errors.notFound(`Product ${productCode} on rate sheet ${serno}`);
  for (const r of rows) {
    const line = mapLine(r);
    await writeLine(tx, brnch, line, { ...line, mrp }, sheet.date);
  }
  await recordAudit(tx, actor.audit, {
    entity: 'AREA_RATES_M',
    key: `${brnch}|${serno}`,
    action: 'SET_MRP',
    brnch,
    newValues: { productCode, mrp, lines: rows.length },
  });
  return { updated: rows.length };
}

async function setSheetStatus(tx, brnch, serno, status, { usrid, now }) {
  await tx.exec(
    `UPDATE AREA_RATES_M SET DOC_STATUS = :st, STATUS = :legacy, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
       ${status === 'APPROVED' ? ', APPROVED_BY = :usr, APPROVED_ON = :now' : ''}
     WHERE BRNCH = :b AND SERNO = :s`,
    { st: status, legacy: status === 'APPROVED' ? 'A' : 'P', usr: usrid, now, b: brnch, s: serno },
  );
}

/** OPEN → PENDING_APPROVAL (RATE_CHANGE); without a rule it is approved at once. */
export async function submitSheet(tx, actor, brnch, serno) {
  const sheet = await openSheet(tx, brnch, serno);
  await setSheetStatus(tx, brnch, serno, 'PENDING_APPROVAL', actor);
  const r = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'RATE_CHANGE',
      brnch,
      docKey: `RATE_SHEET|${brnch}|${serno}`,
      action: 'RATE_SHEET_APPROVE',
      snapshot: { serno, date: sheet.date },
      reason: `City rate sheet ${serno} for ${sheet.date}`,
    },
  );
  if (!r.required) await setSheetStatus(tx, brnch, serno, 'APPROVED', actor);
  await recordAudit(tx, actor.audit, {
    entity: 'AREA_RATES_M',
    key: `${brnch}|${serno}`,
    action: 'SUBMIT',
    brnch,
  });
  return { sheet: await loadSheet(tx, brnch, serno), requestId: r.required ? r.requestId : null };
}

const sheetKey = (req) => {
  const [, b, s] = req.docKey.split('|');
  return [Number(b), Number(s)];
};
onApproved('RATE_SHEET_APPROVE', async (tx, req, ctx) => {
  const [b, s] = sheetKey(req);
  await setSheetStatus(tx, b, s, 'APPROVED', ctx);
});
// rejected: back to OPEN so it can be corrected and submitted again
onRejected('RATE_SHEET_APPROVE', async (tx, req, ctx) => {
  const [b, s] = sheetKey(req);
  await setSheetStatus(tx, b, s, 'OPEN', ctx);
});

/** BR-PRC-02: permit price = line of the latest APPROVED sheet dated on or before the permit date. */
export async function effectiveLine(tx, { brnch, productCode, areaDoc, date }) {
  const r = await tx.one(
    `SELECT ${LINE_COLS}, a.CITY_NAME, m.SERNO AS SHEET, m.WDATE AS SHEET_DATE
       FROM AREA_RATES_M m
       JOIN AREA_RATES_D d ON d.BRNCH = m.BRNCH AND d.SERNO = m.SERNO
       JOIN AREA_RATES_P p ON p.BRNCH = d.BRNCH AND p.P_LNKNO = d.P_LNKNO ${CITY_JOIN}
      WHERE m.BRNCH = :b AND p.PRODUCT_CODE = :pc AND d.AREA_DOC = :ad AND m.WDATE <= :d
        AND ${SHEET_STATUS_SQL} = 'APPROVED'
      ORDER BY m.WDATE DESC, m.SERNO DESC`,
    { b: brnch, pc: productCode, ad: areaDoc, d: toDate(date) },
  );
  return r
    ? { sheet: Number(r.SHEET), sheetDate: businessDate(r.SHEET_DATE), ...mapLine(r) }
    : null;
}

// --- freight sheets (ZONE_CITY_FRIEGHT_M/D, Hattar) ---

export async function listFreightSheets(tx, branches) {
  const bf = branchFilter('m.BRNCH', branches);
  const rows = await tx.many(
    `SELECT m.BRNCH, m.SERNO, m.WDATE, m.EDATE, m.STATUS,
            (SELECT COUNT(*) FROM ZONE_CITY_FRIEGHT_D d WHERE d.BRNCH = m.BRNCH AND d.SERNO = m.SERNO) AS LINES
       FROM ZONE_CITY_FRIEGHT_M m WHERE ${bf.sql} ORDER BY m.WDATE DESC NULLS LAST, m.SERNO DESC`,
    bf.binds,
  );
  return rows.map((r) => ({
    brnch: Number(r.BRNCH),
    serno: Number(r.SERNO),
    date: r.WDATE ? businessDate(r.WDATE) : null,
    endDate: r.EDATE ? businessDate(r.EDATE) : null,
    status: r.STATUS ?? null,
    lines: Number(r.LINES),
  }));
}

export async function freightSheet(tx, brnch, serno) {
  const rows = await tx.many(
    `SELECT d.AREA_DOC, d.FRIEGHT, d.FRIEGHT_PER, a.CITY_NAME FROM ZONE_CITY_FRIEGHT_D d ${CITY_JOIN}
      WHERE d.BRNCH = :b AND d.SERNO = :s ORDER BY a.CITY_NAME, d.AREA_DOC`,
    { b: brnch, s: serno },
  );
  return rows.map((r) => ({
    areaDoc: r.AREA_DOC === null ? null : Number(r.AREA_DOC),
    city: r.CITY_NAME ?? null,
    freight: n2(r.FRIEGHT),
    freightPer: r.FRIEGHT_PER === null ? null : String(r.FRIEGHT_PER),
  }));
}

/** Last freight rate (LFR) for a city on a date: latest freight sheet dated on or before it. */
export async function lastFreight(tx, { brnch, areaDoc, date }) {
  const r = await tx.one(
    `SELECT m.SERNO, m.WDATE, d.FRIEGHT FROM ZONE_CITY_FRIEGHT_M m
       JOIN ZONE_CITY_FRIEGHT_D d ON d.BRNCH = m.BRNCH AND d.SERNO = m.SERNO
      WHERE m.BRNCH = :b AND d.AREA_DOC = :ad AND m.WDATE <= :d ORDER BY m.WDATE DESC, m.SERNO DESC`,
    { b: brnch, ad: areaDoc, d: toDate(date) },
  );
  return r ? { sheet: Number(r.SERNO), date: businessDate(r.WDATE), freight: n2(r.FRIEGHT) } : null;
}
