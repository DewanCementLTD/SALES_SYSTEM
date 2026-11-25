// Tax withheld by customers (TASKS P4-05). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
  t.clock.set('2026-11-25T05:00:00Z');
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

describe('tax withheld (P4-05)', () => {
  it('entries, certificates up to the amount, reversal, summary per customer; branch scope', async () => {
    const fin = await as({ 1: ['FINANCE'] });
    const entry = {
      customerCode: '912-351',
      taxKind: 'IT',
      date: '2026-11-10',
      amount: '12500',
      docType: 'BRV',
      docNo: '227002357',
      remarks: 'u/s 153 on BRV',
    };
    expect((await fin.post('/api/v1/tax-withheld', { ...entry, amount: '0' })).statusCode).toBe(
      400,
    );
    let r = await fin.post('/api/v1/tax-withheld', entry);
    expect(r.statusCode, r.body).toBe(201);
    const e = r.json();
    expect(e).toMatchObject({ amount: '12500.00', certReceived: '0.00', outstanding: '12500.00' });

    r = await fin.post(`/api/v1/tax-withheld/${e.twId}/certificate`, { amount: '10000' });
    expect(r.json()).toMatchObject({ certReceived: '10000.00', outstanding: '2500.00' });
    r = await fin.post(`/api/v1/tax-withheld/${e.twId}/certificate`, { amount: '2500.01' });
    expect(r.statusCode).toBe(422);
    r = await fin.post(`/api/v1/tax-withheld/${e.twId}/reverse`, {
      reason: 'Entered on the wrong customer',
    });
    expect(r.statusCode).toBe(409); // a certificate is on it

    const wrong = (
      await fin.post('/api/v1/tax-withheld', { ...entry, taxKind: 'ST', amount: '800' })
    ).json();
    r = await fin.post(`/api/v1/tax-withheld/${wrong.twId}/reverse`, {
      reason: 'Entered on the wrong customer',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      amount: '-800.00',
      docType: 'REV',
      docNo: String(wrong.twId),
    });
    r = await fin.post(`/api/v1/tax-withheld/${wrong.twId}/reverse`, {
      reason: 'Second time round',
    });
    expect(r.statusCode).toBe(409);

    const sum = (await fin.get('/api/v1/tax-withheld/summary')).json().items;
    expect(sum.filter((x) => x.customerCode === '912-351')).toEqual([
      expect.objectContaining({
        taxKind: 'IT',
        amount: '12500.00',
        certReceived: '10000.00',
        outstanding: '2500.00',
      }),
    ]); // the ST entry and its reversal net to zero
    const asOfBefore = (await fin.get('/api/v1/tax-withheld/summary?asOf=2026-11-09')).json().items;
    expect(asOfBefore.some((x) => x.customerCode === '912-351')).toBe(false);

    const isb = await as({ 2: ['FINANCE'] }, 2);
    expect(
      (await isb.post(`/api/v1/tax-withheld/${e.twId}/certificate`, { amount: '1' })).statusCode,
    ).toBe(404);
    expect((await isb.get('/api/v1/tax-withheld')).json().items.every((x) => x.brnch === 2)).toBe(
      true,
    );
  });
});
