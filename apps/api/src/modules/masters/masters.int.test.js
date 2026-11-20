// Simple masters (TASKS P1-01, API_SPEC §4). Runs on SALES_NEW inside a rolled-back transaction.
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
const editor = () => as({ 1: ['SALES_MANAGER'], 2: ['SALES_MANAGER'] });
const ver = (v) => ({ headers: { 'if-match': `"${v}"` } });

describe('masters (P1-01)', () => {
  it('lists migrated channels of the current branch only (branch leak, BR-BR-04)', async () => {
    const items = await expectNoBranchLeak(t, {
      url: '/api/v1/masters/channels',
      roles: ['MARKETING'],
      brnchOf: (i) => i.brnch,
      seedOtherBranch: async () => {}, // branch 2 already holds 9 legacy channels
      supportsBrnchParam: true,
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toMatchObject({ channelCode: expect.any(String), active: true, rowVer: 1 });
  });

  it('brnch=all returns both branches for a two-branch user', async () => {
    const c = await as({ 1: ['MARKETING'], 2: ['MARKETING'] });
    const res = await c.get('/api/v1/masters/channels?brnch=all&pageSize=200');
    expect(new Set(res.json().items.map((i) => i.brnch))).toEqual(new Set([1, 2]));
  });

  it('creates a channel (code upper-cased), refuses a duplicate and a viewer', async () => {
    const c = await editor();
    const res = await c.post('/api/v1/masters/channels', {
      brnch: 2,
      channelCode: 'z9',
      description: 'Test channel',
      reportGroup: 'DISTRIBUTOR',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    expect(res.json()).toMatchObject({ brnch: 2, channelCode: 'Z9', reportGroup: 'DISTRIBUTOR' });

    const dup = await c.post('/api/v1/masters/channels', {
      brnch: 2,
      channelCode: 'Z9',
      description: 'Again',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('duplicate');

    const bad = await c.post('/api/v1/masters/channels', { channelCode: 'Z8', reportGroup: 'X' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['body.description', 'body.reportGroup']),
    );

    const viewer = await as({ 1: ['MARKETING'] });
    const denied = await viewer.post('/api/v1/masters/channels', {
      channelCode: 'Z7',
      description: 'Nope',
    });
    expect(denied.statusCode).toBe(403);
  });

  it('update needs If-Match, refuses a stale version and audits the changed fields', async () => {
    const c = await editor();
    await c.post('/api/v1/masters/transporters', {
      transpCode: 'ZZ1',
      name: 'Test Transport',
      phone: '021-1',
    });
    const url = '/api/v1/masters/transporters/1/ZZ1';
    const body = { name: 'Test Transport Co', phone: '021-1' };
    expect((await c.put(url, body)).statusCode).toBe(400);
    const ok = await c.put(url, body, ver(1));
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'Test Transport Co', rowVer: 2 });
    expect((await c.put(url, body, ver(1))).json().code).toBe('version_conflict');

    const audit = await t.db.read((tx) =>
      tx.many(
        `SELECT ACTION, OLD_VALUES, NEW_VALUES FROM AUDIT_LOG
          WHERE ENTITY = 'TRANSPORTER_DESC' AND ENTITY_KEY = '1|ZZ1' ORDER BY AUDIT_ID`,
      ),
    );
    expect(audit.map((a) => a.ACTION)).toEqual(['CREATE', 'UPDATE']);
    expect(JSON.parse(audit[1].NEW_VALUES)).toEqual({ name: 'Test Transport Co' });
  });

  it('deactivates and activates (never deletes); active filter; repeated command refused', async () => {
    const c = await editor();
    await c.post('/api/v1/masters/instruments', { instCode: 'ZZ', description: 'Test instrument' });
    const base = '/api/v1/masters/instruments/1/ZZ';
    const off = await c.post(`${base}/deactivate`, { reason: 'Not used any more' }, ver(1));
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ active: false, rowVer: 2 });
    expect((await c.post(`${base}/deactivate`, {}, ver(2))).json().code).toBe('invalid_state');

    const active = await c.get('/api/v1/masters/instruments?active=true&q=ZZ');
    expect(active.json().items.find((i) => i.instCode === 'ZZ')).toBeUndefined();
    const inactive = await c.get('/api/v1/masters/instruments?active=false&q=ZZ');
    expect(inactive.json().items.map((i) => i.instCode)).toContain('ZZ');

    expect((await c.post(`${base}/activate`, {}, ver(2))).json()).toMatchObject({ active: true });
    const still = await t.db.read((tx) =>
      tx.one(`SELECT COUNT(*) AS N FROM INSTRUMENT_TYPE WHERE BRNCH = 1 AND INST_CODE = 'ZZ'`),
    );
    expect(Number(still.N)).toBe(1);
  });

  it('auto-numbers bag codes and checks references in the same branch', async () => {
    const c = await editor();
    const bag = await c.post('/api/v1/masters/bags', { description: 'Test bag' });
    expect(bag.statusCode, bag.body).toBe(201);
    expect(bag.json().bagCode).toBeGreaterThan(0);

    const doBad = await c.post('/api/v1/masters/do-types', {
      doCode: 'ZZT',
      description: 'Test DO',
      productCode: 'NOPE',
    });
    expect(doBad.statusCode).toBe(400);
    const doOk = await c.post('/api/v1/masters/do-types', {
      doCode: 'ZZT',
      description: 'Test DO',
      productCode: 'OPC',
    });
    expect(doOk.statusCode, doOk.body).toBe(201);
    expect(doOk.json().code).toBeGreaterThan(0);
  });

  it('product periods are read-only, filtered by product, newest first (BR-TAX-10)', async () => {
    const c = await editor();
    const list = await c.get('/api/v1/masters/product-periods?productCode=opc');
    expect(list.statusCode, list.body).toBe(200);
    const periods = list.json().items.map((i) => i.period);
    expect(periods.length).toBeGreaterThan(1);
    expect([...periods].sort((a, b) => b - a)).toEqual(periods);
    expect(list.json().items[0]).toMatchObject({
      productCode: 'OPC',
      fedPerTon: expect.stringMatching(/^\d+\.\d{2}$/),
    });

    const one = await c.get(`/api/v1/masters/product-periods/1/OPC~${periods[0]}`);
    expect(one.statusCode).toBe(200);
    expect((await c.get('/api/v1/masters/product-periods/1/OPC')).statusCode).toBe(404);

    const create = await c.post('/api/v1/masters/product-periods', {
      productCode: 'OPC',
      period: 999,
      productName: 'x',
    });
    expect(create.json().code).toBe('invalid_state');
  });

  it('lookups return value/label lists and see a new record at once', async () => {
    const c = await editor();
    const first = await c.get('/api/v1/lookups?types=channels,product-codes');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()['product-codes'].map((p) => p.value)).toContain('OPC');
    await c.post('/api/v1/masters/channels', { channelCode: 'Z6', description: 'Lookup test' });
    const again = await c.get('/api/v1/lookups?types=channels');
    expect(again.json().channels).toContainEqual({
      value: 'Z6',
      label: 'Lookup test',
      active: true,
    });

    expect((await c.get('/api/v1/lookups?types=nope')).statusCode).toBe(400);
    const other = await (await as({ 1: ['MARKETING'] })).get('/api/v1/lookups?types=banks&brnch=2');
    expect(other.statusCode).toBe(403);
  });

  it('unknown master type is a validation error', async () => {
    const c = await editor();
    expect((await c.get('/api/v1/masters/nothing')).statusCode).toBe(400);
  });
});
