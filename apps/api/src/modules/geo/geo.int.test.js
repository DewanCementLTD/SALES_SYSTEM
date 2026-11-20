// Geography (TASKS P1-02, SCHEMA §2.3). SALES_NEW, rolled back.
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

describe('geography (P1-02)', () => {
  it('lists zones of the current branch only (branch leak)', async () => {
    const items = await expectNoBranchLeak(t, {
      url: '/api/v1/geo/nodes?level=1',
      roles: ['MARKETING'],
      brnchOf: (i) => i.brnch,
      seedOtherBranch: async () => {},
      supportsBrnchParam: true,
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.level === 1 && /^Z[A-Z0-9]+$/.test(i.geoCode))).toBe(true);
  });

  it('children of a node are the next level below it', async () => {
    const c = await as({ 2: ['MARKETING'] }, 2);
    const zones = (await c.get('/api/v1/geo/nodes?level=1&pageSize=200')).json().items;
    const zone = zones.find((z) => z.childCount > 0);
    const kids = (await c.get(`/api/v1/geo/nodes?parentCode=${zone.geoCode}&pageSize=200`)).json();
    expect(kids.total).toBe(zone.childCount);
    expect(
      kids.items.every((k) => k.level === 2 && k.geoCode.startsWith(`${zone.geoCode}-T`)),
    ).toBe(true);
    expect(kids.items[0].path[0]).toBe(zone.name);
  });

  it('creates zone → territory → area → city with copied names and fixed codes', async () => {
    const c = await as({ 1: ['SALES_MANAGER'] });
    const z = await c.post('/api/v1/geo/nodes', { code: 'q9', name: 'Test Zone' });
    expect(z.statusCode, z.body).toBe(201);
    expect(z.json()).toMatchObject({
      geoCode: 'ZQ9',
      level: 1,
      sourceTable: 'APP',
      legacyCode: null,
    });
    await c.post('/api/v1/geo/nodes', { parentCode: 'ZQ9', code: '1', name: 'Test Territory' });
    await c.post('/api/v1/geo/nodes', { parentCode: 'ZQ9-T1', code: '01', name: 'Test Area' });
    const city = await c.post('/api/v1/geo/nodes', {
      parentCode: 'ZQ9-T1-A01',
      code: '900',
      name: 'Test City',
    });
    expect(city.json()).toMatchObject({
      geoCode: 'ZQ9-T1-A01-C900',
      level: 4,
      path: ['Test Zone', 'Test Territory', 'Test Area', 'Test City'],
    });
    const dup = await c.post('/api/v1/geo/nodes', { parentCode: 'ZQ9', code: '1', name: 'Again' });
    expect(dup.json().code).toBe('duplicate');
    const orphan = await c.post('/api/v1/geo/nodes', { parentCode: 'ZQ8', code: '1', name: 'x y' });
    expect(orphan.statusCode).toBe(404);
  });

  it('rename copies the name to every node below; stale version refused', async () => {
    const c = await as({ 1: ['SALES_MANAGER'] });
    await c.post('/api/v1/geo/nodes', { code: 'Q8', name: 'Old Name' });
    await c.post('/api/v1/geo/nodes', { parentCode: 'ZQ8', code: '1', name: 'Terr' });
    const r = await c.put('/api/v1/geo/nodes/1/ZQ8', { name: 'New Name' }, ver(1));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ name: 'New Name', rowVer: 2 });
    const child = await c.get('/api/v1/geo/nodes/1/ZQ8-T1');
    expect(child.json().path).toEqual(['New Name', 'Terr']);
    expect((await c.put('/api/v1/geo/nodes/1/ZQ8', { name: 'Again' }, ver(1))).json().code).toBe(
      'version_conflict',
    );
  });

  it('deactivate cascades down; activate needs an active parent', async () => {
    const c = await as({ 1: ['SALES_MANAGER'] });
    await c.post('/api/v1/geo/nodes', { code: 'Q7', name: 'Zone Q7' });
    await c.post('/api/v1/geo/nodes', { parentCode: 'ZQ7', code: '1', name: 'Terr Q7' });
    const off = await c.post('/api/v1/geo/nodes/1/ZQ7/deactivate', { reason: 'Merged' }, ver(1));
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ active: false, descendantsChanged: 1 });
    const child = (await c.get('/api/v1/geo/nodes/1/ZQ7-T1')).json();
    expect(child.active).toBe(false);
    const blocked = await c.post('/api/v1/geo/nodes/1/ZQ7-T1/activate', {}, ver(child.rowVer));
    expect(blocked.json().code).toBe('invalid_state');
    const newChild = await c.post('/api/v1/geo/nodes', {
      parentCode: 'ZQ7',
      code: '2',
      name: 'x y',
    });
    expect(newChild.json().code).toBe('invalid_state');
    expect((await c.post('/api/v1/geo/nodes/1/ZQ7/activate', {}, ver(2))).statusCode).toBe(200);
  });

  it('legacy map shows the node each old code points to', async () => {
    const c = await as({ 1: ['MARKETING'] });
    const res = await c.get('/api/v1/geo/legacy-map?entity=CITY&pageSize=20');
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.brnch === 1 && i.entity === 'CITY')).toBe(true);
    expect(items.filter((i) => i.found).length).toBe(items.length);
  });

  it('summary counts levels and customers without a geography', async () => {
    const c = await as({ 1: ['MARKETING'] });
    const s = (await c.get('/api/v1/geo/summary')).json();
    expect(s.levels.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    expect(s.customers.total).toBeGreaterThan(s.customers.unplaced);
    expect((await c.get('/api/v1/geo/summary?brnch=2')).statusCode).toBe(403);
  });

  it('viewer cannot create; bad code in the URL is a 400', async () => {
    const c = await as({ 1: ['MARKETING'] });
    expect((await c.post('/api/v1/geo/nodes', { code: 'Q6', name: 'Nope' })).statusCode).toBe(403);
    expect((await c.get('/api/v1/geo/nodes/1/bad code')).statusCode).toBe(400);
  });
});
