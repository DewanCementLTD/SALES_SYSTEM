// Credit limits (TASKS P1-04, BR-CUS-07). SALES_NEW, rolled back.
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
const CUST = '/api/v1/customers/1/102-04';

describe('credit limits (P1-04)', () => {
  it('BR-CUS-07: overview lists ten types with initial/current/availed/unused', async () => {
    const c = await as({ 1: ['MARKETING'] });
    const res = await c.get('/api/v1/customers/1/199-120/credit-limits');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().types).toHaveLength(10);
    expect(res.json().types.find((x) => x.creditType === 'A')).toMatchObject({
      current: '250000.00',
      availed: '168947.60',
      unused: '81052.40',
    });
  });

  it('BR-CUS-07: document → approval by someone else → limit applied (row created if missing)', async () => {
    const maker = await as({ 1: ['SALES_MANAGER', 'FINANCE_MANAGER'] });
    const req = await maker.post(`${CUST}/credit-limits`, {
      creditType: 'B',
      amount: '750000',
      remark: 'Approved by DGM',
    });
    expect(req.statusCode, req.body).toBe(201);
    const doc = req.json().document;
    expect(doc).toMatchObject({ status: 'PENDING_APPROVAL', creditType: 'B', amount: '750000.00' });
    expect(req.json().requestId).toEqual(expect.any(Number));

    const dup = await maker.post(`${CUST}/credit-limits`, {
      creditType: 'B',
      amount: '1',
      remark: 'again',
    });
    expect(dup.json().code).toBe('duplicate');

    const self = await maker.post(`/api/v1/credit-limits/1/${doc.serno}/approve`, {});
    expect(self.statusCode).toBe(403);

    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    const ok = await fm.post(`/api/v1/credit-limits/1/${doc.serno}/approve`, { comment: 'OK' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('APPROVED');
    const b = (await fm.get(`${CUST}/credit-limits`))
      .json()
      .types.find((x) => x.creditType === 'B');
    expect(b.current).toBe('750000.00');
  });

  it('rejected document leaves the limit unchanged; viewer cannot request', async () => {
    const maker = await as({ 1: ['SALES_MANAGER'] });
    const before = (await maker.get(`${CUST}/credit-limits`)).json().types[0].current;
    const doc = (
      await maker.post(`${CUST}/credit-limits`, {
        creditType: 'A',
        amount: '1000',
        remark: 'Trial',
      })
    ).json().document;
    const fm = await as({ 1: ['FINANCE_MANAGER'] });
    const rej = await fm.post(`/api/v1/credit-limits/1/${doc.serno}/reject`, { comment: 'No' });
    expect(rej.json().status).toBe('REJECTED');
    expect((await maker.get(`${CUST}/credit-limits`)).json().types[0].current).toBe(before);
    const rejected = (await fm.get('/api/v1/credit-limits?status=REJECTED')).json().items;
    expect(rejected.map((d) => d.serno)).toContain(doc.serno);

    const viewer = await as({ 1: ['AUDITOR'] });
    const denied = await viewer.post(`${CUST}/credit-limits`, {
      creditType: 'A',
      amount: '1',
      remark: 'x y z',
    });
    expect(denied.statusCode).toBe(403);
  });
});
