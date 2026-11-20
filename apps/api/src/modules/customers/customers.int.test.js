// Customers (TASKS P1-03, BR-CUS-*). SALES_NEW, rolled back.
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

async function as(roles, brnch = 1) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}
const ver = (v) => ({ headers: { 'if-match': `"${v}"` } });
const GEO = 'Z1-T12-A1'; // Karachi: KARACHI › KHI-5 › DISTRICT WEST
const newCustomer = (extra = {}) => ({
  customerName: 'TEST CEMENT TRADERS',
  channelCode: '001',
  zoneCode: '001',
  geoCode: GEO,
  salesTaxType: 'U',
  mobile: '0300-1234567',
  ...extra,
});

async function created(maker) {
  const res = await maker.post('/api/v1/customers', newCustomer());
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('customers (P1-03)', () => {
  it('lists customers of the current branch only (branch leak)', async () => {
    await expectNoBranchLeak(t, {
      url: '/api/v1/customers?q=CEMENT',
      roles: ['MARKETING'],
      brnchOf: (i) => i.brnch,
      seedOtherBranch: async () => {},
      supportsBrnchParam: true,
    });
  });

  it('legacy customer: APPROVED without DOC_STATUS, legacy block groups shown read-only', async () => {
    const c = await as({ 1: ['MARKETING'] });
    const res = await c.get('/api/v1/customers/1/102-04');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ customerCode: '102-04', status: 'APPROVED' });
    expect(res.json().blocks.legacyGroups.length).toBeGreaterThan(0);
    expect(res.json().blocks.history).toEqual([]);
  });

  it('BR-CUS-03: code generated from geography, same as the preview; pending approval', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const preview = (await maker.get(`/api/v1/customers/code-preview?geoCode=${GEO}`)).json();
    expect(preview.code).toMatch(/^1-12-01-\d{3}$/);
    const res = await created(maker);
    expect(res.customer).toMatchObject({
      customerCode: preview.code,
      status: 'PENDING_APPROVAL',
      geoCode: GEO,
      zoneCode: '001',
      mobile: '03001234567',
    });
    expect(res.requestId).toEqual(expect.any(Number));
    const next = (await maker.get(`/api/v1/customers/code-preview?geoCode=${GEO}`)).json();
    expect(next.code).not.toBe(preview.code);
  });

  it('create needs an area-level geography and (Karachi) a customer zone', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const zoneOnly = await maker.post('/api/v1/customers', newCustomer({ geoCode: 'Z1' }));
    expect(zoneOnly.statusCode).toBe(400);
    const noZone = await maker.post('/api/v1/customers', newCustomer({ zoneCode: null }));
    expect(noZone.statusCode).toBe(400);
    expect(noZone.json().errors[0].path).toBe('body.zoneCode');
    const badChannel = await maker.post('/api/v1/customers', newCustomer({ channelCode: '999' }));
    expect(badChannel.statusCode).toBe(400);
  });

  it('BR-CUS-02: maker cannot approve; another approver can', async () => {
    const maker = await as({ 1: ['MARKETING', 'CUSTOMER_APPROVER'] });
    const { customer } = await created(maker);
    const url = `/api/v1/customers/1/${customer.customerCode}`;
    const self = await maker.post(`${url}/approve`, {});
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('maker_checker');

    const checker = await as({ 1: ['CUSTOMER_APPROVER'] });
    const ok = await checker.post(`${url}/approve`, { comment: 'Documents checked' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().customer).toMatchObject({
      status: 'APPROVED',
      approvedBy: expect.any(String),
    });
    expect((await checker.post(`${url}/approve`, {})).json().code).toBe('invalid_state');
  });

  it('rejected customer goes back to draft and can be submitted again', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const { customer } = await created(maker);
    const url = `/api/v1/customers/1/${customer.customerCode}`;
    const checker = await as({ 1: ['CUSTOMER_APPROVER'] });
    expect(
      (await checker.post(`${url}/reject`, { comment: 'NTN missing' })).json().customer.status,
    ).toBe('DRAFT');
    const cur = (await maker.get(url)).json();
    const sub = await maker.post(`${url}/submit`, undefined, ver(cur.rowVer));
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().customer.status).toBe('PENDING_APPROVAL');
  });

  it('BR-CUS-02: approved customer — tax/contact change waits for approval, address applies now', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const { customer } = await created(maker);
    const url = `/api/v1/customers/1/${customer.customerCode}`;
    const checker = await as({ 1: ['CUSTOMER_APPROVER'] });
    await checker.post(`${url}/approve`, {});
    const cur = (await maker.get(url)).json();

    const res = await maker.put(
      url,
      { address1: 'Shop 4, Main Road', ntn: '1234567-8' },
      ver(cur.rowVer),
    );
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json().pendingFields).toEqual(['ntn']);
    expect(res.json().customer).toMatchObject({ address1: 'Shop 4, Main Road', ntn: null });
    expect((await maker.get(url)).json().pendingApproval).toMatchObject({
      action: 'CUSTOMER_CHANGE',
    });

    const ok = await checker.post(`${url}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await maker.get(url)).json()).toMatchObject({
      ntn: '1234567-8',
      pendingApproval: null,
    });
  });

  it('PUT needs If-Match and refuses a stale version', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const { customer } = await created(maker);
    const url = `/api/v1/customers/1/${customer.customerCode}`;
    expect((await maker.put(url, { address2: 'x' })).statusCode).toBe(400);
    expect((await maker.put(url, { address2: 'Block B' }, ver(customer.rowVer))).statusCode).toBe(
      200,
    );
    expect((await maker.put(url, { address2: 'Block C' }, ver(customer.rowVer))).json().code).toBe(
      'version_conflict',
    );
  });

  it('BR-CUS-08: block with reason and stop-dispatch, then unblock; history kept', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const { customer } = await created(maker);
    const url = `/api/v1/customers/1/${customer.customerCode}`;
    const approver = await as({ 1: ['CUSTOMER_APPROVER'] });
    await approver.post(`${url}/approve`, {});
    let cur = (await approver.get(url)).json();
    expect(
      (await approver.post(`${url}/block`, { reason: 'short' }, ver(cur.rowVer))).statusCode,
    ).toBe(400);
    const b = await approver.post(
      `${url}/block`,
      { reason: 'Cheque bounced twice this month', stopDispatch: true },
      ver(cur.rowVer),
    );
    expect(b.statusCode, b.body).toBe(200);
    expect(b.json().status).toBe('BLOCKED');
    cur = (await approver.get(url)).json();
    const u = await approver.post(
      `${url}/unblock`,
      { reason: 'Payment received in full' },
      ver(cur.rowVer),
    );
    expect(u.json().status).toBe('APPROVED');
    const hist = (await approver.get(url)).json().blocks.history;
    expect(hist.map((h) => h.action)).toEqual(['UNBLOCK', 'BLOCK']);
    expect(hist[1].stopDispatch).toBe(true);
    expect(
      (await maker.post(`${url}/block`, { reason: 'Not allowed for me' }, ver(1))).statusCode,
    ).toBe(403);
  });
});

describe('customer lines (P1-03: areas, security deposits, bank accounts)', () => {
  it('Hattar legacy areas are mapped to geography cities', async () => {
    const c = await as({ 2: ['MARKETING'] }, 2);
    const res = await c.get('/api/v1/customers/2/1-01-01-068/lines/areas');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
    expect(res.json().items[0]).toMatchObject({
      geoCode: expect.stringMatching(/^Z/),
      active: true,
    });
  });

  it('BR-CUS-06: deposits add up; deactivated lines drop out of the total, never deleted', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const { customer } = await created(maker);
    const url = `/api/v1/customers/1/${customer.customerCode}/lines/security`;
    await maker.post(url, { description: 'CASH DEPOSIT', amount: '100000' });
    const two = await maker.post(url, { description: 'CERTIFICATES', amount: '250000.50' });
    expect(two.statusCode, two.body).toBe(201);
    expect(two.json().securityTotal).toBe('350000.50');
    const key = two.json().items.find((i) => i.description === 'CASH DEPOSIT').key;
    const off = await maker.post(`${url}/${key}/deactivate`, {});
    expect(off.json().securityTotal).toBe('250000.50');
    expect(off.json().items).toHaveLength(2);
    expect((await maker.post(`${url}/${key}/deactivate`, {})).json().code).toBe('invalid_state');
  });

  it('areas need an area/city; bank accounts need a known bank; duplicates refused', async () => {
    const maker = await as({ 1: ['MARKETING'] });
    const { customer } = await created(maker);
    const base = `/api/v1/customers/1/${customer.customerCode}/lines`;
    expect((await maker.post(`${base}/areas`, { geoCode: 'Z1' })).statusCode).toBe(400);
    const a = await maker.post(`${base}/areas`, { geoCode: GEO });
    expect(a.statusCode, a.body).toBe(201);
    expect((await maker.post(`${base}/areas`, { geoCode: GEO })).json().code).toBe('duplicate');
    const bad = await maker.post(`${base}/bank-accounts`, {
      bankCode: 'ZZZZ',
      accountNo: '123',
      branchName: 'Main',
    });
    expect(bad.statusCode).toBe(400);
    const ok = await maker.post(`${base}/bank-accounts`, {
      bankCode: 'HBL',
      accountNo: 'T-998877',
      branchName: 'Saddar',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().items[0]).toMatchObject({ key: 'HBL~T-998877', bankName: expect.any(String) });
  });
});
