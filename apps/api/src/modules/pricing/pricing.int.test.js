// Trade prices (TASKS P1-06, BR-PRC-01..06). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { expectNoBranchLeak } from '../../../test/helpers/branch-leak.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
});
afterEach(async () => {
  await t.close();
});

async function as(roles, brnch = 2) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
// Hattar: customer 1210-21-001, OPS, Abbottabad — legacy versions ABABDOPS01…18
const KEY = { customer: '1210-21-001', product: 'OPS', geoCode: 'Z12-T12-A01-C2172' };
const qs = (o) => new URLSearchParams(o).toString();

describe('trade prices (P1-06)', () => {
  it('BR-PRC-02: quote returns the version effective on the date + period breakdown', async () => {
    const c = await as({ 2: ['MARKETING'] });
    const res = await c.get(`/api/v1/pricing/quote?${qs({ ...KEY, date: '2026-09-15' })}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().tradePrice).toMatchObject({
      priceCode: 'ABABDOPS17',
      invoicePrice: '25500.00',
    });
    expect(res.json().period).toMatchObject({ mrp: expect.any(String), fedPerTon: '4000.00' });
    const later = await c.get(`/api/v1/pricing/quote?${qs({ ...KEY, date: '2026-11-20' })}`);
    expect(later.json().tradePrice.priceCode).toBe('ABABDOPS18');
  });

  it('BR-PRC-01: history lists every version, newest first', async () => {
    const c = await as({ 2: ['MARKETING'] });
    const h = (await c.get(`/api/v1/pricing/trade-prices/history?${qs(KEY)}`)).json().items;
    expect(h[0].priceCode).toBe('ABABDOPS18');
    expect(h.length).toBeGreaterThanOrEqual(18);
  });

  it('BR-PRC-01/06: new version = next code, waits for approval, then quotes', async () => {
    const maker = await as({ 2: ['SALES_MANAGER'] });
    const res = await maker.post('/api/v1/pricing/trade-prices', {
      customerCode: KEY.customer,
      productCode: KEY.product,
      geoCode: KEY.geoCode,
      invoicePrice: '26000',
      efDate: '2026-11-25',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().tradePrice).toMatchObject({
      priceCode: 'ABABDOPS19',
      status: 'PENDING_APPROVAL',
      companyPrice: expect.any(String),
    });
    const q = `/api/v1/pricing/quote?${qs({ ...KEY, date: '2026-11-30' })}`;
    expect((await maker.get(q)).json().tradePrice.priceCode).toBe('ABABDOPS18');

    const again = await maker.post('/api/v1/pricing/trade-prices', {
      customerCode: KEY.customer,
      productCode: KEY.product,
      geoCode: KEY.geoCode,
      invoicePrice: '26100',
      efDate: '2026-11-26',
    });
    expect(again.json().code).toBe('duplicate');

    const fm = await as({ 2: ['FINANCE_MANAGER'] });
    const ok = await fm.post(`/api/v1/approvals/${res.json().requestId}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await maker.get(q)).json().tradePrice).toMatchObject({
      priceCode: 'ABABDOPS19',
      invoicePrice: '26000.00',
    });
  });

  it('BR-PRC-01: cannot start on or before the current version; BR-PRC-03: never above MRP', async () => {
    const maker = await as({ 2: ['SALES_MANAGER'] });
    const body = { customerCode: KEY.customer, productCode: KEY.product, geoCode: KEY.geoCode };
    const old = await maker.post('/api/v1/pricing/trade-prices', {
      ...body,
      invoicePrice: '25000',
      efDate: '2026-09-30',
    });
    expect(old.json()).toMatchObject({ code: 'rule_violation', ruleId: 'BR-PRC-01' });
    const high = await maker.post('/api/v1/pricing/trade-prices', {
      ...body,
      invoicePrice: '99999',
      efDate: '2026-12-01',
    });
    expect(high.json()).toMatchObject({ code: 'rule_violation', ruleId: 'BR-PRC-03' });
    expect(high.json().data.excess).toEqual(expect.any(String));
  });

  it('new key needs a price-code base; lists are branch-scoped', async () => {
    const maker = await as({ 2: ['SALES_MANAGER'] });
    const body = {
      customerCode: KEY.customer,
      productCode: 'OPS',
      geoCode: 'Z0-T0-A01-C2086',
      invoicePrice: '25000',
      efDate: '2026-12-01',
    };
    expect((await maker.post('/api/v1/pricing/trade-prices', body)).statusCode).toBe(400);
    const ok = await maker.post('/api/v1/pricing/trade-prices', {
      ...body,
      priceCodeBase: 'ZZTST',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().tradePrice.priceCode).toBe('ZZTST01');

    await expectNoBranchLeak(t, {
      url: '/api/v1/pricing/trade-prices',
      roles: ['MARKETING'],
      brnchOf: (i) => i.brnch,
      seedOtherBranch: async () => {},
      supportsBrnchParam: true,
    });
  });
});
