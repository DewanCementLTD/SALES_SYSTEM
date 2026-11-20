// Customer line lists (TASKS P1-03): areas served (CUSTOMER_AREA), security deposits
// (SECURITY_DEPOSIT, BR-CUS-06) and bank accounts (CUSTOMER_BANK_ACC). Lines are added and
// deactivated, never deleted. These are not BR-CUS-02 fields, so they apply directly (audited).
import { MASTERS, dec, parseGeoCode } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { refExists } from '../masters/repo.js';
import * as repo from './repo.js';

export const LINE_KINDS = ['areas', 'security', 'bank-accounts'];

export const LINE_BODIES = {
  areas: z.object({ geoCode: z.string().trim().max(50) }),
  security: z.object({
    description: z.string().trim().min(2).max(30),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount'),
  }),
  'bank-accounts': z.object({
    bankCode: z.string().trim().toUpperCase().min(1).max(4),
    accountNo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,12}$/, 'Up to 12 letters, digits or dashes'),
    branchName: z.string().trim().min(2).max(100),
  }),
};

const auditKey = (brnch, code, kind, key) => `${brnch}|${code}|${kind}|${key}`;

/** @returns {Promise<any[]>} */
export async function listLines(tx, kind, brnch, code) {
  if (kind === 'areas') {
    const rows = await tx.many(
      `SELECT a.LINE_ID, a.GEO_CODE, a.ZONE_CODE, a.TERRITORY_CODE, a.AREA_DOC, a.ACTIVE, a.UPDATED_BY, a.UPDATED_ON,
              g.GEO_LEVEL, g.ZONE_NAME, g.TERRITORY_NAME, g.AREA_NAME, g.CITY_NAME
         FROM CUSTOMER_AREA a
         LEFT JOIN GEO_HIERARCHY g ON g.BRNCH = a.BRNCH AND g.GEO_CODE = a.GEO_CODE
        WHERE a.BRNCH = :b AND a.CUST_ID = :c ORDER BY a.ACTIVE DESC, g.CITY_NAME, a.LINE_ID`,
      { b: brnch, c: code },
    );
    return rows.map((r) => ({
      key: String(r.LINE_ID),
      geoCode: r.GEO_CODE ?? null,
      geoPath:
        r.GEO_LEVEL === null
          ? []
          : [r.ZONE_NAME, r.TERRITORY_NAME, r.AREA_NAME, r.CITY_NAME].slice(0, Number(r.GEO_LEVEL)),
      legacy: r.GEO_CODE
        ? null
        : { zone: r.ZONE_CODE, territory: r.TERRITORY_CODE, area: r.AREA_DOC },
      active: r.ACTIVE === 'Y',
    }));
  }
  if (kind === 'security') {
    const rows = await tx.many(
      `SELECT LINE_ID, DESCRIPTION, AMOUNT, ACTIVE FROM SECURITY_DEPOSIT
        WHERE BRNCH = :b AND CUSTOMER_CODE = :c ORDER BY ACTIVE DESC, LINE_ID`,
      { b: brnch, c: code },
    );
    return rows.map((r) => ({
      key: String(r.LINE_ID),
      description: r.DESCRIPTION,
      amount: dec(r.AMOUNT ?? 0).toFixed(2),
      active: r.ACTIVE === 'Y',
    }));
  }
  const rows = await tx.many(
    `SELECT a.BANK_CODE, a.ACCOUNT_NO, a.BRANCH_NAME, a.ACTIVE, b.BANK_NAME
       FROM CUSTOMER_BANK_ACC a LEFT JOIN BANK_DESC b ON b.BRNCH = a.BRNCH AND b.BANK_CODE = a.BANK_CODE
      WHERE a.BRNCH = :b AND a.CUSTOMER_CODE = :c ORDER BY a.ACTIVE DESC, a.BANK_CODE, a.ACCOUNT_NO`,
    { b: brnch, c: code },
  );
  return rows.map((r) => ({
    key: `${r.BANK_CODE}~${r.ACCOUNT_NO}`,
    bankCode: r.BANK_CODE,
    bankName: r.BANK_NAME ?? null,
    accountNo: r.ACCOUNT_NO,
    branchName: r.BRANCH_NAME,
    active: r.ACTIVE === 'Y',
  }));
}

/** Security deposit total of active lines (R7 "S.D", BR-CUS-06). */
export function securityTotal(lines) {
  return lines
    .filter((l) => l.active)
    .reduce((s, l) => s.plus(l.amount), dec(0))
    .toFixed(2);
}

async function customerFor(tx, brnch, code) {
  const c = await repo.getCustomer(tx, brnch, code, { forUpdate: true });
  if (!c) throw Errors.notFound('Customer');
  if (c.status === 'CLOSED') throw Errors.invalidState('A closed customer cannot be changed');
  return c;
}

/** Add a line. @returns {Promise<string>} key of the new line */
export async function addLine(tx, actor, kind, brnch, code, body) {
  const c = await customerFor(tx, brnch, code);
  let key;
  if (kind === 'areas') {
    const p = parseGeoCode(body.geoCode);
    if (!p || p.level < 3) {
      throw Errors.validation('Choose an area or a city', [
        { path: 'body.geoCode', message: 'Area or city required' },
      ]);
    }
    const node = await tx.one(
      'SELECT ACTIVE FROM GEO_HIERARCHY WHERE BRNCH = :b AND GEO_CODE = :g',
      { b: brnch, g: body.geoCode },
    );
    if (!node)
      throw Errors.validation(`Geography ${body.geoCode} does not exist in branch ${brnch}`);
    if (node.ACTIVE !== 'Y') throw Errors.invalidState(`Geography ${body.geoCode} is inactive`);
    const dup = await tx.one(
      `SELECT LINE_ID FROM CUSTOMER_AREA WHERE BRNCH = :b AND CUST_ID = :c AND GEO_CODE = :g AND ACTIVE = 'Y'`,
      { b: brnch, c: code, g: body.geoCode },
    );
    if (dup) throw Errors.duplicate('This area is already on the list');
    const num = (v) => (v && /^\d{1,9}$/.test(v) ? Number(v) : null);
    const id = await tx.nextId('SEQ_CUSTOMER_LINE');
    await tx.exec(
      `INSERT INTO CUSTOMER_AREA (CUST_ID, ZONE_CODE, TERRITORY_CODE, AREA_DOC, COMPC, BRNCH, LINE_ID, GEO_CODE, ACTIVE, UPDATED_BY, UPDATED_ON)
       VALUES (:c, NULL, NULL, :areaDoc, 1, :b, :id, :g, 'Y', :usr, :now)`,
      {
        c: code,
        areaDoc: num(p.city) ?? null,
        b: brnch,
        id,
        g: body.geoCode,
        usr: actor.usrid,
        now: actor.now,
      },
    );
    key = String(id);
  } else if (kind === 'security') {
    const id = await tx.nextId('SEQ_CUSTOMER_LINE');
    await tx.exec(
      `INSERT INTO SECURITY_DEPOSIT (CUSTOMER_CODE, DESCRIPTION, AMOUNT, COMPC, BRNCH, LINE_ID, ACTIVE, UPDATED_BY, UPDATED_ON)
       VALUES (:c, :d, :amt, 1, :b, :id, 'Y', :usr, :now)`,
      {
        c: code,
        d: body.description,
        amt: dec(body.amount).toString(),
        b: brnch,
        id,
        usr: actor.usrid,
        now: actor.now,
      },
    );
    key = String(id);
  } else {
    if (!(await refExists(tx, MASTERS.banks, brnch, body.bankCode))) {
      throw Errors.validation(`Bank ${body.bankCode} does not exist in branch ${brnch}`, [
        { path: 'body.bankCode', message: 'Unknown bank' },
      ]);
    }
    const zone = c.zoneCode && c.zoneCode.length <= 3 ? c.zoneCode : null;
    await tx.exec(
      `INSERT INTO CUSTOMER_BANK_ACC (BANK_CODE, ACCOUNT_NO, CUSTOMER_CODE, ZONE_CODE, BRANCH_NAME, COMPC, BRNCH, ACTIVE, UPDATED_BY, UPDATED_ON)
       VALUES (:bank, :acc, :c, :z, :br, 1, :b, 'Y', :usr, :now)`,
      {
        bank: body.bankCode,
        acc: body.accountNo,
        c: code,
        z: zone,
        br: body.branchName,
        b: brnch,
        usr: actor.usrid,
        now: actor.now,
      },
    );
    key = `${body.bankCode}~${body.accountNo}`;
  }
  await recordAudit(tx, actor.audit, {
    entity:
      kind === 'areas'
        ? 'CUSTOMER_AREA'
        : kind === 'security'
          ? 'SECURITY_DEPOSIT'
          : 'CUSTOMER_BANK_ACC',
    key: auditKey(brnch, code, kind, key),
    action: 'CREATE',
    brnch,
    newValues: body,
  });
  return key;
}

/** Deactivate / activate a line (never deleted). */
export async function setLineActive(tx, actor, kind, brnch, code, key, active) {
  await customerFor(tx, brnch, code);
  let n;
  const binds = { act: active ? 'Y' : 'N', b: brnch, c: code, usr: actor.usrid, now: actor.now };
  if (kind === 'bank-accounts') {
    const [bank, acc] = key.split('~');
    n = await tx.exec(
      `UPDATE CUSTOMER_BANK_ACC SET ACTIVE = :act, UPDATED_BY = :usr, UPDATED_ON = :now
        WHERE BRNCH = :b AND CUSTOMER_CODE = :c AND BANK_CODE = :bank AND ACCOUNT_NO = :acc AND ACTIVE <> :act`,
      { ...binds, bank, acc },
    );
  } else {
    if (!/^\d{1,12}$/.test(key)) throw Errors.notFound('Line');
    const table = kind === 'areas' ? 'CUSTOMER_AREA' : 'SECURITY_DEPOSIT';
    const custCol = kind === 'areas' ? 'CUST_ID' : 'CUSTOMER_CODE';
    n = await tx.exec(
      `UPDATE ${table} SET ACTIVE = :act, UPDATED_BY = :usr, UPDATED_ON = :now
        WHERE BRNCH = :b AND ${custCol} = :c AND LINE_ID = :id AND ACTIVE <> :act`,
      { ...binds, id: Number(key) },
    );
  }
  if (n !== 1)
    throw Errors.invalidState(`Line ${key} not found or already ${active ? 'active' : 'inactive'}`);
  await recordAudit(tx, actor.audit, {
    entity:
      kind === 'areas'
        ? 'CUSTOMER_AREA'
        : kind === 'security'
          ? 'SECURITY_DEPOSIT'
          : 'CUSTOMER_BANK_ACC',
    key: auditKey(brnch, code, kind, key),
    action: active ? 'ACTIVATE' : 'DEACTIVATE',
    brnch,
  });
}
