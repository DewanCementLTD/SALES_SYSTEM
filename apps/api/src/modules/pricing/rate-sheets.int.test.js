// City rate sheets and freight (TASKS P1-07, BR-PRC-02/05/06). SALES_NEW, rolled back.
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

async function as(roles, brnch = 2) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
const EFF = (date) => `/api/v1/pricing/rate-sheets/effective?product=OPS&areaDoc=2144&date=${date}`;

describe('city rate sheets (P1-07)', () => {
  it('BR-PRC-02: permit price comes from the latest APPROVED sheet (open sheets do not count)', async () => {
    const c = await as({ 2: ['MARKETING'] });
    const res = await c.get(EFF('2026-11-20'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().line).toMatchObject({ sheet: 1904, booking: '28370.00', productCode: 'OPS' });
  });

  it('new sheet copies the previous one; edit recalculates the chain; submit locks; approval applies it', async () => {
    const maker = await as({ 2: ['SALES_MANAGER'] });
    const created = await maker.post('/api/v1/pricing/rate-sheets', { date: '2026-11-21' });
    expect(created.statusCode, created.body).toBe(201);
    const sheet = created.json();
    expect(sheet).toMatchObject({ status: 'OPEN', date: '2026-11-21' });
    expect(sheet.lines.length).toBeGreaterThan(0);
    expect(
      (await maker.post('/api/v1/pricing/rate-sheets', { date: '2026-11-21' })).json().code,
    ).toBe('duplicate');

    const line = sheet.lines.find((l) => l.productCode === 'OPS' && l.areaDoc === 2144);
    const base = `/api/v1/pricing/rate-sheets/2/${sheet.serno}`;
    const edited = await maker.put(`${base}/lines/${line.lnkno}`, {
      booking: '30000',
      freight: '3000',
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({
      booking: '30000.00',
      netBook: '27000.00',
      fed: '4000.00',
    });

    const mrp = await maker.post(`${base}/set-mrp`, { productCode: 'OPS', mrp: '30500' });
    expect(mrp.json().updated).toBeGreaterThan(0);
    const after = (await maker.get(base)).json().lines.find((l) => l.lnkno === line.lnkno);
    expect(after).toMatchObject({ mrp: '30500.00', salesTax: '4652.54' });

    const sub = await maker.post(`${base}/submit`, {});
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().sheet.status).toBe('PENDING_APPROVAL');
    expect((await maker.put(`${base}/lines/${line.lnkno}`, { booking: '1' })).json().code).toBe(
      'invalid_state',
    );

    const fm = await as({ 2: ['FINANCE_MANAGER'] });
    const ok = await fm.post(`/api/v1/approvals/${sub.json().requestId}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await maker.get(EFF('2026-11-22'))).json().line).toMatchObject({
      sheet: sheet.serno,
      booking: '30000.00',
    });
  });

  it('freight sheets and last freight rate per city', async () => {
    const c = await as({ 2: ['MARKETING'] });
    const list = (await c.get('/api/v1/pricing/freight-sheets')).json().items;
    expect(list[0]).toMatchObject({ serno: 36, brnch: 2 });
    const lfr = await c.get('/api/v1/pricing/freight/last?areaDoc=2144&date=2026-11-20');
    expect(lfr.json().freight).toMatchObject({ sheet: 36, freight: expect.any(String) });
    expect((await c.post('/api/v1/pricing/rate-sheets', { date: '2026-12-01' })).statusCode).toBe(
      403,
    );
  });
});
