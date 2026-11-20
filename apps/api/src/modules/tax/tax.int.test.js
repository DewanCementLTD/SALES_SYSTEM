// Tax rates (TASKS P1-05, BR-TAX-05/10, BR-PRC-01/06). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
});
afterEach(async () => {
  await t.close();
});

async function as(roles, brnch = 1) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}

describe('tax rates (P1-05)', () => {
  it('BR-TAX-05 / BR-PRC-06: WHT rate waits for approval, then applies from its date', async () => {
    const maker = await as({ 1: ['FINANCE_MANAGER'] });
    const res = await maker.post('/api/v1/tax/rates', {
      filerStatus: 'N',
      section: '236G',
      ratePct: '0.2',
      effectiveFrom: '2026-07-01',
      remarks: 'Finance Act 2026',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().rate).toMatchObject({
      status: 'PENDING_APPROVAL',
      brnch: 0,
      section: '236G',
    });
    const q = '/api/v1/tax/rates/effective?filerStatus=N&section=236G&date=2026-11-20';
    expect((await maker.get(q)).json().rate).toBeNull();

    const dup = await maker.post('/api/v1/tax/rates', {
      filerStatus: 'N',
      section: '236G',
      ratePct: '0.3',
      effectiveFrom: '2026-07-01',
    });
    expect(dup.json().code).toBe('duplicate');

    const self = await maker.post(`/api/v1/approvals/${res.json().requestId}/approve`, {});
    expect(self.statusCode).toBe(403);
    const checker = await as({ 1: ['FINANCE_MANAGER'] });
    const ok = await checker.post(`/api/v1/approvals/${res.json().requestId}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await maker.get(q)).json().rate).toMatchObject({ ratePct: '0.2', status: 'APPROVED' });
    expect(
      (
        await maker.get('/api/v1/tax/rates/effective?filerStatus=N&section=236G&date=2026-06-30')
      ).json().rate,
    ).toBeNull();
  });

  it('BR-TAX-10: FED / ST change = new product period after approval; history untouched', async () => {
    const maker = await as({ 1: ['FINANCE_MANAGER'] });
    const before = (await maker.get('/api/v1/masters/product-periods?productCode=OPC')).json();
    const latest = before.items[0];
    const early = await maker.post('/api/v1/tax/product-periods', {
      productCode: 'OPC',
      dateFrom: '2000-01-01',
      fedPerTon: '4000',
      salesTaxPer: '18',
    });
    expect(early.json()).toMatchObject({ code: 'rule_violation', ruleId: 'BR-PRC-01' });

    const req = await maker.post('/api/v1/tax/product-periods', {
      productCode: 'OPC',
      dateFrom: '2027-07-01',
      fedPerTon: '4500',
      salesTaxPer: '18',
    });
    expect(req.statusCode, req.body).toBe(201);
    expect((await maker.get('/api/v1/tax/product-periods/pending')).json().items[0]).toMatchObject({
      productCode: 'OPC',
      fedPerTon: '4500',
    });
    const checker = await as({ 1: ['FINANCE_MANAGER'] });
    await checker.post(`/api/v1/approvals/${req.json().requestId}/approve`, {});
    const after = (await maker.get('/api/v1/masters/product-periods?productCode=OPC')).json();
    expect(after.total).toBe(before.total + 1);
    expect(after.items[0]).toMatchObject({
      period: latest.period + 1,
      dateFrom: '2027-07-01',
      fedPerTon: '4500.00',
      salesTaxPer: '18.00',
      mrp: latest.mrp,
    });
    expect(after.items[1]).toEqual(latest);
  });

  it('viewer cannot add rates', async () => {
    const c = await as({ 1: ['MARKETING'] });
    const res = await c.post('/api/v1/tax/rates', {
      filerStatus: 'F',
      ratePct: '0.1',
      effectiveFrom: '2026-07-01',
    });
    expect(res.statusCode).toBe(403);
    expect((await c.get('/api/v1/tax/rates')).statusCode).toBe(200);
  });
});
