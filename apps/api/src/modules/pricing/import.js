// Trade price import from Excel (TASKS P1-06, API_SPEC §4): upload → preview (every row checked in a
// rolled-back transaction with the same rules as a single price) → commit (all rows in one
// transaction + one RATE_CHANGE approval for the batch, action TRADE_PRICE_IMPORT).
// Previews are kept in this API process for 30 minutes (single API process; P6 may move them to DB).
import { randomUUID } from 'node:crypto';
import { zTradePriceRequest } from '@dcl/shared';
import ExcelJS from 'exceljs';
import { AppError, Errors } from '../../lib/errors.js';
import { onApproved, onRejected, requestApproval } from '../approvals/service.js';
import { recordAudit } from '../audit/service.js';
import { requestTradePrice, setStatus } from './service.js';

export const IMPORT_COLUMNS = [
  'customer_code',
  'product_code',
  'geo_code',
  'price',
  'effective_from',
  'target',
];
const MAX_ROWS = 2000;
const TTL_MS = 30 * 60 * 1000;
/** @type {Map<string, { brnch: number, usrid: string, at: number, rows: any[] }>} */
const previews = new Map();

const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'result' in v) return cellText(v.result);
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  return String(v).trim();
};

/** Read the first sheet: header row with IMPORT_COLUMNS names (any order, case-insensitive). */
export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw Errors.validation('The file is not a valid .xlsx workbook');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw Errors.validation('The workbook has no sheet');
  const header = (ws.getRow(1).values ?? []).map((h) => cellText(h).toLowerCase());
  const col = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)]));
  const missing = IMPORT_COLUMNS.filter((c) => c !== 'target' && col[c] < 0);
  if (missing.length) throw Errors.validation(`Missing columns: ${missing.join(', ')}`);
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (c) => (col[c] >= 0 ? cellText(row.getCell(col[c]).value) : '');
    if (!get('customer_code') && !get('product_code')) return;
    rows.push({
      row: n,
      customerCode: get('customer_code'),
      productCode: get('product_code'),
      geoCode: get('geo_code'),
      invoicePrice: get('price'),
      efDate: get('effective_from'),
      ...(get('target') ? { target: get('target') } : {}),
    });
  });
  if (!rows.length) throw Errors.validation('No data rows under the header');
  if (rows.length > MAX_ROWS) throw Errors.validation(`At most ${MAX_ROWS} rows per import`);
  return rows;
}

/** Check one row exactly like a single new price (insert only, caller rolls back or commits). */
async function checkRow(tx, actor, brnch, r) {
  const parsed = zTradePriceRequest.safeParse(r);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }
  try {
    const res = await requestTradePrice(tx, actor, brnch, parsed.data, { approval: false });
    return { ok: true, priceCode: res.priceCode };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.detail, ruleId: e.ruleId ?? null };
    throw e;
  }
}

/**
 * Preview: every row checked inside the caller's (rolled-back) transaction; rows build on each other
 * (two versions of one key in a file are checked in order).
 */
export async function preview(tx, actor, brnch, rows, nowMs) {
  for (const [k, v] of previews) if (nowMs - v.at > TTL_MS) previews.delete(k);
  const out = [];
  for (const r of rows) out.push({ ...r, ...(await checkRow(tx, actor, brnch, r)) });
  const importId = randomUUID();
  const valid = out.filter((r) => r.ok).length;
  if (valid === out.length) previews.set(importId, { brnch, usrid: actor.usrid, at: nowMs, rows });
  return { importId: valid === out.length ? importId : null, total: out.length, valid, rows: out };
}

/** Commit a clean preview: all rows + one approval request (or approved at once without a rule). */
export async function commit(tx, actor, brnch, importId, nowMs) {
  const p = previews.get(importId);
  if (!p || nowMs - p.at > TTL_MS || p.brnch !== brnch || p.usrid !== actor.usrid) {
    throw Errors.notFound('Import preview (upload the file again)');
  }
  const codes = [];
  for (const r of p.rows) {
    const res = await checkRow(tx, actor, brnch, r);
    if (!res.ok) throw Errors.invalidState(`Row ${r.row} is no longer valid: ${res.error}`);
    codes.push(res.priceCode);
  }
  await recordAudit(tx, actor.audit, {
    entity: 'TRADE_PRICE',
    key: `IMPORT|${importId}`,
    action: 'IMPORT',
    brnch,
    newValues: { rows: codes.length, priceCodes: codes.slice(0, 100) },
  });
  const r = await requestApproval(
    tx,
    { ...actor.audit, now: actor.now },
    {
      docType: 'RATE_CHANGE',
      brnch,
      docKey: `TRADE_IMPORT|${brnch}|${importId}`,
      action: 'TRADE_PRICE_IMPORT',
      snapshot: { priceCodes: codes, rows: p.rows },
      reason: `Trade price import: ${codes.length} prices`,
    },
  );
  if (!r.required) for (const c of codes) await setStatus(tx, brnch, c, 'APPROVED', actor);
  previews.delete(importId);
  return { created: codes.length, priceCodes: codes, requestId: r.required ? r.requestId : null };
}

const batch = (status) => async (tx, req, ctx) => {
  const brnch = Number(req.docKey.split('|')[1]);
  for (const c of req.snapshot.priceCodes) await setStatus(tx, brnch, c, status, ctx);
};
onApproved('TRADE_PRICE_IMPORT', batch('APPROVED'));
onRejected('TRADE_PRICE_IMPORT', batch('REJECTED'));
