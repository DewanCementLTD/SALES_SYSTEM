// City-wise permits (BUSINESS_RULES §8, TASKS P2-05). DRAFT → (PENDING_CFO →) ISSUED →
// PARTLY_DISPATCHED → DISPATCHED; cancel any time (BR-PMT-07). Issue checks the available balance
// with the customer locked (BR-PMT-02, BR-BAL-02) and debits the DO ledger; no expiry (BR-PMT-04).
// Legacy permits (no DOC_STATUS): APPROVED 'Y' or any line → issued.
import {
  areaAmount,
  businessDate,
  canTrade,
  cfoRequired,
  checkTransition,
  dec,
  fiscalYearOf,
  formatAmount,
  narration,
  permitCityRate,
  permitNoOf,
  permitValue,
  shortfall as shortfallOf,
} from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { paginate } from '../../lib/oracle/paginate.js';
import { loadRequest, onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import * as customers from '../customers/repo.js';
import * as balance from '../ledger/balance.js';
import * as ledger from '../ledger/service.js';
import { nextNumber } from '../numbering/service.js';
import { SHEET_STATUS_SQL } from '../pricing/rate-sheets.js';
import { SettingsReader } from '../settings/service.js';

const ENTITY = 'PERMIT_MST_CITY';
const iso = (d) => (d ? businessDate(d) : null);
const n2 = (v) => (v === null || v === undefined ? null : dec(v).toFixed(2));
const toDate = (s) => (s ? new Date(`${s}T00:00:00+05:00`) : null);
const keyOf = (brnch, no) => `${brnch}|${no}`;
const parseKey = (k) => {
  const [b, n] = String(k).split('|');
  return { brnch: Number(b), permitNo: n };
};

export const PERMIT_STATUS_SQL = `NVL(m.DOC_STATUS, 'ISSUED')`;

const COLS = `m.BRNCH, TO_CHAR(m.PERMIT_NO) AS PERMIT_NO, m.PERMIT_DATE, m.VALID_FROM, m.VALID_TO,
  m.CUSTOMER_CODE, c.CUSTOMER_NAME, m.PRODUCT_CODE, m.QTY, m.PERMIT_VALUE, m.YEAR, m.DOB, m.DCB, m.CRLMT,
  ${PERMIT_STATUS_SQL} AS STATUS, m.ROW_VER, NVL(m.CREATED_BY, 'legacy') AS CREATED_BY, m.CREATED_ON,
  m.ISSUED_BY, m.ISSUED_ON, m.CFO_REQ_ID, m.OVERRIDE_REQ_ID, m.CANCEL_REASON, m.CANCELLED_BY,
  m.CANCELLED_ON, m.SENT_TO_DEALER_ON`;
const FROM = `PERMIT_MST_CITY m
  LEFT JOIN CUSTOMER_INFO c ON c.BRNCH = m.BRNCH AND c.CUSTOMER_CODE = m.CUSTOMER_CODE`;

function mapPermit(r) {
  return {
    brnch: Number(r.BRNCH),
    permitNo: r.PERMIT_NO,
    permitDate: iso(r.PERMIT_DATE),
    validFrom: iso(r.VALID_FROM),
    validTo: iso(r.VALID_TO),
    customerCode: r.CUSTOMER_CODE,
    customerName: r.CUSTOMER_NAME ?? null,
    productCode: r.PRODUCT_CODE ?? null,
    qtyTon: r.QTY === null ? null : dec(r.QTY).toFixed(3),
    value: n2(r.PERMIT_VALUE),
    year: r.YEAR === null ? null : Number(r.YEAR),
    legacyBalances:
      r.DOB === null && r.DCB === null
        ? null
        : { doBalance: n2(r.DOB), dcBalance: n2(r.DCB), creditLimit: n2(r.CRLMT) },
    status: r.STATUS,
    rowVer: Number(r.ROW_VER),
    createdBy: r.CREATED_BY,
    createdOn: r.CREATED_ON ?? null,
    issuedBy: r.ISSUED_BY ?? null,
    issuedOn: r.ISSUED_ON ?? null,
    cfoReqId: r.CFO_REQ_ID === null ? null : Number(r.CFO_REQ_ID),
    overrideReqId: r.OVERRIDE_REQ_ID === null ? null : Number(r.OVERRIDE_REQ_ID),
    cancelReason: r.CANCEL_REASON ?? null,
    cancelledBy: r.CANCELLED_BY ?? null,
    cancelledOn: r.CANCELLED_ON ?? null,
    sentToDealerOn: r.SENT_TO_DEALER_ON ?? null,
  };
}

export async function list(tx, o) {
  const bf = branchFilter('m.BRNCH', o.branches);
  const where = [bf.sql];
  const binds = { ...bf.binds };
  if (o.status) {
    where.push(`${PERMIT_STATUS_SQL} = :st`);
    binds.st = o.status;
  }
  if (o.customer) {
    where.push('m.CUSTOMER_CODE = :cu');
    binds.cu = o.customer;
  }
  if (o.from) {
    where.push('m.PERMIT_DATE >= :df');
    binds.df = toDate(o.from);
  }
  if (o.to) {
    where.push('m.PERMIT_DATE < :dt + 1');
    binds.dt = toDate(o.to);
  }
  if (o.q) {
    where.push(
      `(TO_CHAR(m.PERMIT_NO) LIKE :q ESCAPE '\\' OR m.CUSTOMER_CODE LIKE :q ESCAPE '\\' OR UPPER(c.CUSTOMER_NAME) LIKE :q ESCAPE '\\')`,
    );
    binds.q = `%${o.q.toUpperCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  }
  const page = await paginate(tx, {
    sql: `SELECT ${COLS} FROM ${FROM} WHERE ${where.join(' AND ')}
          ORDER BY m.PERMIT_DATE DESC NULLS LAST, m.PERMIT_NO DESC, m.BRNCH`,
    binds,
    page: o.page,
    pageSize: o.pageSize,
  });
  return { ...page, items: page.items.map(mapPermit) };
}

const AREA_NAME = `(SELECT MAX(a.AREA_NAME) FROM AREA a WHERE a.BRNCH = d.BRNCH AND a.AREA_DOC = d.AREA_DOC)`;

export async function areas(tx, brnch, permitNo) {
  const rows = await tx.many(
    `SELECT d.LNKNO, d.AREA_DOC, ${AREA_NAME} AS AREA_NAME, d.QTY, d.CRATE, d.AMOUNT,
            NVL(d.DISPATCHED_TON, 0) AS DISPATCHED, NVL(d.AREA_STATUS, 'OPEN') AS AREA_STATUS,
            d.RATE_OVERRIDE, d.SHEET_RATE
       FROM PERMIT_DTL_CITY d WHERE d.BRNCH = :b AND d.PERMIT_NO = :n ORDER BY d.LNKNO`,
    { b: brnch, n: permitNo },
  );
  return rows.map((r) => ({
    lnkno: Number(r.LNKNO),
    areaDoc: r.AREA_DOC,
    areaName: r.AREA_NAME ?? null,
    qtyTon: dec(r.QTY ?? 0).toFixed(3),
    rate: n2(r.CRATE) ?? '0.00',
    amount: n2(r.AMOUNT) ?? '0.00',
    dispatchedTon: dec(r.DISPATCHED).toFixed(3),
    balanceTon: dec(r.QTY ?? 0)
      .minus(dec(r.DISPATCHED))
      .toFixed(3),
    status: r.AREA_STATUS,
    rateOverride: r.RATE_OVERRIDE === 'Y',
    sheetRate: n2(r.SHEET_RATE),
  }));
}

export async function adjustments(tx, brnch, permitNo) {
  const rows = await tx.many(
    `SELECT SERNO, WDATE, LNKNO, AREA_DOC, QTY, CRATE, AMOUNT FROM PERMIT_ADJ_CITY
      WHERE BRNCH = :b AND PERMIT_NO = :n ORDER BY SERNO`,
    { b: brnch, n: permitNo },
  );
  return rows.map((r) => ({
    serno: Number(r.SERNO),
    date: iso(r.WDATE),
    lnkno: r.LNKNO === null ? null : Number(r.LNKNO),
    areaDoc: r.AREA_DOC,
    qtyTon: dec(r.QTY ?? 0).toFixed(3),
    rate: n2(r.CRATE),
    amount: n2(r.AMOUNT),
  }));
}

export async function getPermit(tx, brnch, permitNo, { forUpdate = false } = {}) {
  if (forUpdate) {
    const l = await tx.one(
      'SELECT PERMIT_NO FROM PERMIT_MST_CITY WHERE BRNCH = :b AND PERMIT_NO = :n FOR UPDATE',
      { b: brnch, n: permitNo },
    );
    if (!l) throw Errors.notFound(`Permit ${permitNo}`);
  }
  const r = await tx.one(`SELECT ${COLS} FROM ${FROM} WHERE m.BRNCH = :b AND m.PERMIT_NO = :n`, {
    b: brnch,
    n: permitNo,
  });
  if (!r) throw Errors.notFound(`Permit ${permitNo}`);
  return {
    ...mapPermit(r),
    areas: await areas(tx, brnch, permitNo),
    adjustments: await adjustments(tx, brnch, permitNo),
  };
}

/**
 * City rates for a product on a date (BR-PMT-01): lines of the latest approved rate sheet with the
 * last freight rate per city; rate = booking − LFR.
 */
export async function cityRates(tx, brnch, productCode, date) {
  const sheet = await tx.one(
    `SELECT SERNO, WDATE FROM (
       SELECT m.SERNO, m.WDATE FROM AREA_RATES_M m
        WHERE m.BRNCH = :b AND m.WDATE <= :d
          AND ${SHEET_STATUS_SQL} = 'APPROVED'
        ORDER BY m.WDATE DESC, m.SERNO DESC) WHERE ROWNUM = 1`,
    { b: brnch, d: toDate(date) },
  );
  if (!sheet) return { sheet: null, lines: [] };
  const rows = await tx.many(
    `SELECT d.AREA_DOC, ${AREA_NAME} AS AREA_NAME, d.BOOKING_P, d.FREIGHT,
            (SELECT MAX(fd.FRIEGHT) KEEP (DENSE_RANK LAST ORDER BY fm.WDATE, fm.SERNO)
               FROM ZONE_CITY_FRIEGHT_M fm JOIN ZONE_CITY_FRIEGHT_D fd ON fd.BRNCH = fm.BRNCH AND fd.SERNO = fm.SERNO
              WHERE fm.BRNCH = d.BRNCH AND fd.AREA_DOC = d.AREA_DOC AND fm.WDATE <= :d) AS LFR
       FROM AREA_RATES_D d JOIN AREA_RATES_P p ON p.BRNCH = d.BRNCH AND p.P_LNKNO = d.P_LNKNO
      WHERE d.BRNCH = :b AND d.SERNO = :s AND p.PRODUCT_CODE = :p
      ORDER BY AREA_NAME, d.AREA_DOC`,
    { b: brnch, s: sheet.SERNO, p: productCode, d: toDate(date) },
  );
  return {
    sheet: { serno: Number(sheet.SERNO), date: iso(sheet.WDATE) },
    lines: rows.map((r) => ({
      areaDoc: String(r.AREA_DOC),
      areaName: r.AREA_NAME ?? null,
      booking: n2(r.BOOKING_P),
      freight: n2(r.LFR ?? r.FREIGHT),
      rate: permitCityRate({ booking: r.BOOKING_P, freight: r.FREIGHT }, r.LFR),
    })),
  };
}

const audit = (tx, actor, brnch, no, action, extra = {}) =>
  recordAudit(tx, actor.audit, { entity: ENTITY, key: keyOf(brnch, no), action, brnch, ...extra });

/** Rates for the body's areas: given rate (override) or the sheet rate. */
async function priced(tx, brnch, body) {
  const rates = await cityRates(tx, brnch, body.productCode, body.permitDate);
  const byDoc = new Map(rates.lines.map((l) => [l.areaDoc, l]));
  return body.areas.map((a) => {
    const sheet = byDoc.get(String(a.areaDoc));
    const rate = a.rate ?? sheet?.rate;
    if (rate === null || rate === undefined)
      throw Errors.rule(
        'BR-PMT-01',
        `No rate for area ${a.areaDoc} on the approved rate sheet: enter the rate`,
      );
    return {
      ...a,
      rate: dec(rate).toFixed(2),
      sheetRate: sheet?.rate ?? null,
      override: !sheet || !dec(rate).eq(dec(sheet.rate)),
      amount: areaAmount(a.qtyTon, rate),
    };
  });
}

async function writeAreas(tx, brnch, permitNo, customerCode, lines) {
  const have = await areas(tx, brnch, permitNo);
  const byDoc = new Map(have.map((a) => [a.areaDoc, a]));
  for (const l of lines) {
    const ex = byDoc.get(String(l.areaDoc));
    const binds = {
      q: l.qtyTon,
      r: l.rate,
      amt: l.amount,
      ov: l.override ? 'Y' : 'N',
      sr: l.sheetRate,
    };
    if (ex) {
      await tx.exec(
        `UPDATE PERMIT_DTL_CITY SET QTY = :q, CRATE = :r, AMOUNT = :amt, RATE_OVERRIDE = :ov, SHEET_RATE = :sr,
           AREA_STATUS = 'OPEN', ROW_VER = ROW_VER + 1 WHERE BRNCH = :b AND LNKNO = :l`,
        { ...binds, b: brnch, l: ex.lnkno },
      );
    } else {
      await tx.exec(
        `INSERT INTO PERMIT_DTL_CITY (PERMIT_NO, LNKNO, AREA_DOC, QTY, CUSTOMER_CODE, CRATE, AMOUNT, COMPC,
           BRNCH, DISPATCHED_TON, AREA_STATUS, ROW_VER, RATE_OVERRIDE, SHEET_RATE)
         VALUES (:n, :l, :ad, :q, :cu, :r, :amt, 1, :b, 0, 'OPEN', 1, :ov, :sr)`,
        {
          ...binds,
          n: permitNo,
          l: await tx.nextId('SEQ_PERMIT_DTL'),
          ad: String(l.areaDoc),
          cu: customerCode,
          b: brnch,
        },
      );
    }
  }
  // areas removed from a draft keep their row, cancelled (never deleted)
  const given = new Set(lines.map((l) => String(l.areaDoc)));
  for (const a of have) {
    if (!given.has(a.areaDoc) && a.status !== 'CANCELLED') {
      await tx.exec(
        `UPDATE PERMIT_DTL_CITY SET AREA_STATUS = 'CANCELLED', QTY = 0, AMOUNT = 0, ROW_VER = ROW_VER + 1
          WHERE BRNCH = :b AND LNKNO = :l`,
        { b: brnch, l: a.lnkno },
      );
    }
  }
}

async function checkCustomer(tx, brnch, code) {
  const c = await customers.getCustomer(tx, brnch, code);
  if (!c) throw Errors.notFound(`Customer ${code}`);
  const t = canTrade(c);
  if (!t.ok)
    throw Errors.rule('BR-CUS-02', `${t.reason}: a permit needs an approved, active customer`);
}

export async function createPermit(tx, actor, brnch, body) {
  await checkCustomer(tx, brnch, body.customerCode);
  const lines = await priced(tx, brnch, body);
  const year = fiscalYearOf(toDate(body.permitDate));
  const permitNo = permitNoOf(await nextNumber(tx, { brnch, year, docType: 'PMT' }), brnch);
  const qty = lines.reduce((s, l) => s.plus(dec(l.qtyTon)), dec(0)).toFixed(3);
  await tx.exec(
    `INSERT INTO PERMIT_MST_CITY (PERMIT_NO, BRNCH, COMPC, PERMIT_DATE, VALID_TO, CUSTOMER_CODE, QTY,
       PRODUCT_CODE, YEAR, DOC_STATUS, ROW_VER, PERMIT_VALUE, QR_VER, CREATED_BY, CREATED_ON)
     VALUES (:n, :b, 1, :pd, :vt, :cu, :q, :p, :y, 'DRAFT', 1, :v, 1, :usr, :now)`,
    {
      n: permitNo,
      b: brnch,
      pd: toDate(body.permitDate),
      vt: toDate(body.validTo ?? null),
      cu: body.customerCode,
      q: qty,
      p: body.productCode,
      y: year,
      v: permitValue(lines),
      usr: actor.usrid,
      now: actor.now,
    },
  );
  await writeAreas(tx, brnch, permitNo, body.customerCode, lines);
  await audit(tx, actor, brnch, permitNo, 'CREATE', { newValues: body });
  return getPermit(tx, brnch, permitNo);
}

function assertState(p, to) {
  const t = checkTransition('PERMIT', p.status, to);
  if (!t.ok) throw Errors.invalidState(`Permit ${p.permitNo} is ${p.status}: ${t.detail}`);
}

async function bump(tx, actor, p, sets = {}) {
  const cols = Object.keys(sets);
  const binds = { b: p.brnch, n: p.permitNo, rv: p.rowVer, usr: actor.usrid, now: actor.now };
  cols.forEach((c, i) => {
    binds[`x${i}`] = sets[c];
  });
  const n = await tx.exec(
    `UPDATE PERMIT_MST_CITY SET ROW_VER = ROW_VER + 1, UPDATED_BY = :usr, UPDATED_ON = :now
       ${cols.map((c, i) => `, ${c} = :x${i}`).join('')}
     WHERE BRNCH = :b AND PERMIT_NO = :n AND ROW_VER = :rv`,
    binds,
  );
  if (n !== 1) throw Errors.versionConflict();
}

export async function updatePermit(tx, actor, brnch, permitNo, rowVer, body) {
  const p = await getPermit(tx, brnch, permitNo, { forUpdate: true });
  if (p.rowVer !== rowVer) throw Errors.versionConflict();
  if (p.status !== 'DRAFT')
    throw Errors.invalidState(`Permit ${permitNo} is ${p.status}; only a DRAFT can be edited`);
  if (body.customerCode !== p.customerCode)
    throw Errors.validation('The customer of a permit cannot change');
  await checkCustomer(tx, brnch, body.customerCode);
  const lines = await priced(tx, brnch, body);
  await bump(tx, actor, p, {
    PERMIT_DATE: toDate(body.permitDate),
    VALID_TO: toDate(body.validTo ?? null),
    PRODUCT_CODE: body.productCode,
    QTY: lines.reduce((s, l) => s.plus(dec(l.qtyTon)), dec(0)).toFixed(3),
    PERMIT_VALUE: permitValue(lines),
    CFO_REQ_ID: null, // changes need a fresh CFO decision
  });
  await writeAreas(tx, brnch, permitNo, p.customerCode, lines);
  await audit(tx, actor, brnch, permitNo, 'UPDATE', { oldValues: p, newValues: body });
  return getPermit(tx, brnch, permitNo);
}

/** BR-PMT-03: send to the CFO (approval PERMIT_CFO). */
export async function sendToCfo(tx, actor, brnch, permitNo, rowVer, reason) {
  const p = await getPermit(tx, brnch, permitNo, { forUpdate: true });
  if (p.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(p, 'PENDING_CFO');
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch,
      docType: 'PERMIT_CFO',
      docKey: keyOf(brnch, permitNo),
      action: 'PERMIT_CFO',
      snapshot: { qtyTon: p.qtyTon, value: p.value, areas: p.areas.length },
      amount: p.value,
      qty: p.qtyTon,
      reason,
    },
  );
  if (!res.required)
    throw Errors.rule('BR-PMT-03', 'No CFO approval rule is active: ask an administrator');
  await bump(tx, actor, p, { DOC_STATUS: 'PENDING_CFO' });
  await audit(tx, actor, brnch, permitNo, 'SEND_CFO', {
    reason,
    newValues: { requestId: res.requestId },
  });
  return { permit: await getPermit(tx, brnch, permitNo), requestId: res.requestId };
}

onApproved('PERMIT_CFO', async (tx, req, ctx) => {
  const { brnch, permitNo } = parseKey(req.docKey);
  await tx.exec(
    `UPDATE PERMIT_MST_CITY SET DOC_STATUS = 'DRAFT', CFO_REQ_ID = :r, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :usr, UPDATED_ON = :now WHERE BRNCH = :b AND PERMIT_NO = :n AND DOC_STATUS = 'PENDING_CFO'`,
    { r: req.reqId, b: brnch, n: permitNo, usr: ctx.usrid, now: ctx.now },
  );
});
onRejected('PERMIT_CFO', async (tx, req, ctx) => {
  const { brnch, permitNo } = parseKey(req.docKey);
  await tx.exec(
    `UPDATE PERMIT_MST_CITY SET DOC_STATUS = 'DRAFT', CFO_REQ_ID = NULL, ROW_VER = ROW_VER + 1,
       UPDATED_BY = :usr, UPDATED_ON = :now WHERE BRNCH = :b AND PERMIT_NO = :n AND DOC_STATUS = 'PENDING_CFO'`,
    { b: brnch, n: permitNo, usr: ctx.usrid, now: ctx.now },
  );
});
onApproved('PERMIT_BALANCE_OVERRIDE', async (tx, req, ctx) => {
  const { brnch, permitNo } = parseKey(req.docKey);
  await tx.exec(
    `UPDATE PERMIT_MST_CITY SET OVERRIDE_REQ_ID = :r, ROW_VER = ROW_VER + 1, UPDATED_BY = :usr,
       UPDATED_ON = :now WHERE BRNCH = :b AND PERMIT_NO = :n`,
    { r: req.reqId, b: brnch, n: permitNo, usr: ctx.usrid, now: ctx.now },
  );
});
onRejected('PERMIT_BALANCE_OVERRIDE', async () => {});

async function approvedReq(tx, id) {
  if (!id) return null;
  const r = await loadRequest(tx, id).catch(() => null);
  return r?.status === 'APPROVED' ? r : null;
}

/** BR-PMT-02: issue with the balance check (customer locked) → DO ledger debit. */
export async function issuePermit(tx, actor, brnch, permitNo, rowVer) {
  const head = await getPermit(tx, brnch, permitNo);
  await balance.lockCustomer(tx, brnch, head.customerCode);
  const p = await getPermit(tx, brnch, permitNo, { forUpdate: true });
  if (p.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(p, 'ISSUED');
  const threshold = await new SettingsReader(tx).num(brnch, 'PERMIT_CFO_QTY');
  if (cfoRequired(p.qtyTon, threshold) && !(await approvedReq(tx, p.cfoReqId)))
    throw Errors.rule(
      'BR-PMT-03',
      `Permits above ${threshold} t need CFO approval: send it to the CFO first`,
    );
  const bal = await balance.available(tx, {
    brnch,
    customerCode: p.customerCode,
    now: actor.now,
    value: p.value,
  });
  const short = shortfallOf(p.value, bal.available);
  if (dec(short).gt(0)) {
    const ov = await approvedReq(tx, p.overrideReqId);
    if (!ov || dec(ov.amount ?? 0).lt(dec(short))) {
      throw Errors.rule(
        'BR-PMT-02',
        `Available balance ${formatAmount(bal.available, { brackets: true })} is less than the permit value ${formatAmount(p.value)}: short by ${formatAmount(short)}`,
        { shortfall: short, available: bal.available, value: p.value },
      );
    }
  }
  const today = businessDate(actor.now);
  await bump(tx, actor, p, {
    DOC_STATUS: 'ISSUED',
    VALID_FROM: toDate(today),
    ISSUED_BY: actor.usrid,
    ISSUED_ON: actor.now,
    APPROVED: 'Y',
    DOB: bal.doLedgerBalance,
    DCB: bal.dcLedgerBalance,
  });
  await ledger.post(tx, actor, [
    {
      brnch,
      customerCode: p.customerCode,
      ledgerType: 'DO',
      entryDate: today,
      docType: 'PMT',
      docYear: p.year,
      docNo: permitNo,
      entryKind: 'ISSUE',
      narration: narration.permit({
        permitNo,
        qtyTon: p.qtyTon,
        city: p.areas.length === 1 ? p.areas[0].areaName : `${p.areas.length} areas`,
      }),
      debit: p.value,
      qtyTon: p.qtyTon,
    },
  ]);
  await audit(tx, actor, brnch, permitNo, 'ISSUE', {
    newValues: { value: p.value, available: bal.available, shortfall: short },
  });
  return {
    permit: await getPermit(tx, brnch, permitNo),
    balanceAfter: dec(bal.available).minus(dec(p.value)).toFixed(2),
  };
}

export async function requestBalanceOverride(tx, actor, brnch, permitNo, reason) {
  const p = await getPermit(tx, brnch, permitNo, { forUpdate: true });
  if (!['DRAFT', 'PENDING_CFO'].includes(p.status))
    throw Errors.invalidState(`Permit ${permitNo} is ${p.status}`);
  const bal = await balance.available(tx, {
    brnch,
    customerCode: p.customerCode,
    now: actor.now,
    value: p.value,
  });
  const short = shortfallOf(p.value, bal.available);
  if (!dec(short).gt(0))
    throw Errors.invalidState('The balance covers this permit: no override needed');
  const res = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      brnch,
      docType: 'PERMIT_BALANCE_OVERRIDE',
      docKey: keyOf(brnch, permitNo),
      action: 'PERMIT_BALANCE_OVERRIDE',
      snapshot: { value: p.value, available: bal.available, shortfall: short },
      amount: short,
      reason,
    },
  );
  if (!res.required)
    throw Errors.rule('BR-BAL-04', 'No approval rule for balance overrides is active');
  await audit(tx, actor, brnch, permitNo, 'REQUEST_BALANCE_OVERRIDE', {
    reason,
    newValues: { shortfall: short },
  });
  return { requestId: res.requestId, permit: await getPermit(tx, brnch, permitNo) };
}

/** BR-PMT-06: adjust issued area quantities (≥ dispatched); DO ledger Dr/Cr the difference. */
export async function adjustPermit(tx, actor, brnch, permitNo, rowVer, { lines, reason }) {
  const head = await getPermit(tx, brnch, permitNo);
  await balance.lockCustomer(tx, brnch, head.customerCode);
  const p = await getPermit(tx, brnch, permitNo, { forUpdate: true });
  if (p.rowVer !== rowVer) throw Errors.versionConflict();
  if (!['ISSUED', 'PARTLY_DISPATCHED'].includes(p.status))
    throw Errors.invalidState(
      `Permit ${permitNo} is ${p.status}; adjust an issued permit (edit a draft)`,
    );
  let delta = dec(0);
  const today = businessDate(actor.now);
  for (const l of lines) {
    const a = p.areas.find((x) => x.lnkno === l.lnkno);
    if (!a || a.status === 'CANCELLED') throw Errors.notFound(`Area line ${l.lnkno}`);
    if (dec(l.qtyTon).lt(dec(a.dispatchedTon)))
      throw Errors.rule('BR-PMT-05', `Area ${a.areaDoc}: ${a.dispatchedTon} t already dispatched`);
    const diffQty = dec(l.qtyTon).minus(dec(a.qtyTon));
    if (diffQty.isZero()) continue;
    const diffAmt = dec(areaAmount(l.qtyTon, a.rate)).minus(dec(a.amount));
    delta = delta.plus(diffAmt);
    await tx.exec(
      `UPDATE PERMIT_DTL_CITY SET QTY = :q, AMOUNT = :amt, ROW_VER = ROW_VER + 1 WHERE BRNCH = :b AND LNKNO = :l`,
      { q: l.qtyTon, amt: areaAmount(l.qtyTon, a.rate), b: brnch, l: a.lnkno },
    );
    await tx.exec(
      `INSERT INTO PERMIT_ADJ_CITY (SERNO, WDATE, PERMIT_NO, LNKNO, AREA_DOC, QTY, CUSTOMER_CODE, CRATE, AMOUNT, COMPC, BRNCH)
       VALUES (:s, :d, :n, :l, :ad, :q, :cu, :r, :amt, 1, :b)`,
      {
        s: await tx.nextId('SEQ_PERMIT_ADJ'),
        d: toDate(today),
        n: permitNo,
        l: a.lnkno,
        ad: a.areaDoc,
        q: diffQty.toFixed(3),
        cu: p.customerCode,
        r: a.rate,
        amt: diffAmt.toFixed(2),
        b: brnch,
      },
    );
  }
  if (delta.isZero()) throw Errors.validation('Nothing to adjust');
  if (delta.gt(0)) {
    // an increase needs the balance again (BR-PMT-06)
    const bal = await balance.available(tx, {
      brnch,
      customerCode: p.customerCode,
      now: actor.now,
    });
    if (dec(bal.available).lt(delta))
      throw Errors.rule(
        'BR-PMT-06',
        `The increase of ${formatAmount(delta)} exceeds the available balance ${formatAmount(bal.available, { brackets: true })}`,
        { shortfall: delta.minus(dec(bal.available)).toFixed(2) },
      );
  }
  const newValue = dec(p.value).plus(delta);
  const newQty = p.areas.reduce((s, a) => {
    const l = lines.find((x) => x.lnkno === a.lnkno);
    return s.plus(dec(l ? l.qtyTon : a.qtyTon));
  }, dec(0));
  await bump(tx, actor, p, { QTY: newQty.toFixed(3), PERMIT_VALUE: newValue.toFixed(2) });
  await ledger.post(tx, actor, [
    {
      brnch,
      customerCode: p.customerCode,
      ledgerType: 'DO',
      entryDate: today,
      docType: 'DOA',
      docYear: fiscalYearOf(actor.now),
      docNo: `${permitNo}-${p.rowVer + 1}`,
      entryKind: 'ADJUST',
      narration: narration.adjust({
        what: 'permit',
        no: permitNo,
        fromTon: p.qtyTon,
        toTon: newQty.toFixed(3),
      }),
      ...(delta.gt(0) ? { debit: delta.toFixed(2) } : { credit: delta.abs().toFixed(2) }),
      qtyTon: newQty.minus(dec(p.qtyTon)).abs().toFixed(3),
    },
  ]);
  await audit(tx, actor, brnch, permitNo, 'ADJUST', {
    reason,
    newValues: { lines, delta: delta.toFixed(2) },
  });
  return getPermit(tx, brnch, permitNo);
}

/** BR-PMT-07: cancel any time; an issued permit's undispatched value returns to the DO ledger. */
export async function cancelPermit(tx, actor, brnch, permitNo, rowVer, reason) {
  const p = await getPermit(tx, brnch, permitNo, { forUpdate: true });
  if (p.rowVer !== rowVer) throw Errors.versionConflict();
  assertState(p, 'CANCELLED');
  const wasIssued = ['ISSUED', 'PARTLY_DISPATCHED'].includes(p.status);
  let released = dec(0);
  for (const a of p.areas.filter((x) => x.status !== 'CANCELLED')) {
    released = released.plus(dec(areaAmount(a.balanceTon, a.rate)));
    await tx.exec(
      `UPDATE PERMIT_DTL_CITY SET AREA_STATUS = 'CANCELLED', ROW_VER = ROW_VER + 1 WHERE BRNCH = :b AND LNKNO = :l`,
      { b: brnch, l: a.lnkno },
    );
  }
  await bump(tx, actor, p, {
    DOC_STATUS: 'CANCELLED',
    CANCEL_REASON: reason,
    CANCELLED_BY: actor.usrid,
    CANCELLED_ON: actor.now,
  });
  // legacy permits are inside the opening balance (P6-03): no ledger row of their own to release
  if (wasIssued && released.gt(0) && p.createdBy !== 'legacy') {
    await ledger.post(tx, actor, [
      {
        brnch,
        customerCode: p.customerCode,
        ledgerType: 'DO',
        entryDate: businessDate(actor.now),
        docType: 'CXL',
        docYear: fiscalYearOf(actor.now),
        docNo: permitNo,
        entryKind: 'RELEASE',
        narration: narration.cancel({ what: 'permit', no: permitNo }),
        credit: released.toFixed(2),
      },
    ]);
  }
  await audit(tx, actor, brnch, permitNo, 'CANCEL', {
    reason,
    newValues: { released: released.toFixed(2) },
  });
  return getPermit(tx, brnch, permitNo);
}

export { keyOf };
