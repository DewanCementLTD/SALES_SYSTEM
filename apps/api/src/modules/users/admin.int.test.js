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

async function login(u, brnch = 1) {
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch });
  return c;
}

const newUser = (usrid, access) => ({
  usrid,
  fullName: 'New Person',
  homeBrnch: access[0].brnch,
  access,
});

describe('admin users (P0-16, PRD 4.19)', () => {
  it('creates a user with a one-time password that must be changed', async () => {
    const admin = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'], 2: ['SYS_ADMIN'] } });
    const a = await login(admin);
    const res = await a.post(
      '/api/v1/admin/users',
      newUser('NEWFIN1', [{ brnch: 1, isDefault: true, roles: ['FINANCE'] }]),
    );
    expect(res.statusCode).toBe(201);
    const { userId, temporaryPassword } = res.json();
    const nu = await login({ usrid: 'NEWFIN1', password: temporaryPassword });
    expect((await nu.get('/api/v1/auth/me')).json().mustChangePassword).toBe(true);

    const dup = await a.post('/api/v1/admin/users', newUser('newfin1', [{ brnch: 1, roles: [] }]));
    expect(dup.json().code).toBe('duplicate');

    const detail = await a.get(`/api/v1/admin/users/${userId}`);
    expect(detail.headers.etag).toBe('"1"');
    expect(detail.json().access).toEqual([{ brnch: 1, isDefault: true, roles: ['FINANCE'] }]);
  });

  it('PUT needs If-Match and refuses a stale version', async () => {
    const admin = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
    const target = await createUser(t.db, { roles: { 1: ['FINANCE'] } });
    const a = await login(admin);
    const body = { fullName: 'Renamed Person', homeBrnch: 1 };
    expect((await a.put(`/api/v1/admin/users/${target.userId}`, body)).statusCode).toBe(400);
    expect(
      (
        await a.put(`/api/v1/admin/users/${target.userId}`, body, {
          headers: { 'if-match': '"1"' },
        })
      ).statusCode,
    ).toBe(200);
    const stale = await a.put(`/api/v1/admin/users/${target.userId}`, body, {
      headers: { 'if-match': '"1"' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('version_conflict');
  });

  it('branch admin: own branch only, cannot grant SYS_ADMIN', async () => {
    const ba = await createUser(t.db, { roles: { 1: ['BRANCH_ADMIN'] } });
    const c = await login(ba);
    const other = await c.post(
      '/api/v1/admin/users',
      newUser('HTRUSER1', [{ brnch: 2, roles: ['FINANCE'] }]),
    );
    expect(other.json().code).toBe('branch_forbidden');
    const sys = await c.post(
      '/api/v1/admin/users',
      newUser('KHISYS1', [{ brnch: 1, roles: ['SYS_ADMIN'] }]),
    );
    expect(sys.statusCode).toBe(403);
    const ok = await c.post(
      '/api/v1/admin/users',
      newUser('KHIFIN1', [{ brnch: 1, roles: ['FINANCE'] }]),
    );
    expect(ok.statusCode).toBe(201);

    // a Hattar-only user is invisible to the Karachi branch admin
    const htr = await createUser(t.db, { roles: { 2: ['FINANCE'] } });
    expect((await c.get(`/api/v1/admin/users/${htr.userId}`)).statusCode).toBe(404);
  });

  it('lock blocks login and ends sessions; unlock restores', async () => {
    const admin = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
    const target = await createUser(t.db, { roles: { 1: ['FINANCE'] } });
    const a = await login(admin);
    const tc = await login(target);
    expect(
      (
        await a.post(`/api/v1/admin/users/${target.userId}/lock`, {
          reason: 'Left the company today',
        })
      ).statusCode,
    ).toBe(200);
    expect((await tc.post('/api/v1/auth/refresh')).statusCode).toBe(401);
    const blocked = await new Client(t.app).post('/api/v1/auth/login', {
      usrid: target.usrid,
      password: target.password,
      brnch: 1,
      fiscalYear: 2027,
    });
    expect(blocked.statusCode).toBe(423);
    expect((await a.post(`/api/v1/admin/users/${target.userId}/unlock`, {})).statusCode).toBe(200);
    await login(target);
    expect(
      (await a.post(`/api/v1/admin/users/${admin.userId}/lock`, { reason: 'Locking myself out' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('settings (P0-11)', () => {
  it('branch value overrides company value; company level only for SYS_ADMIN; values validated', async () => {
    const sys = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
    const ba = await createUser(t.db, { roles: { 1: ['BRANCH_ADMIN'] } });
    const s = await login(sys);
    const b = await login(ba);

    expect(
      (await b.put('/api/v1/admin/settings/0/WEIGHT_TOLERANCE_KG', { value: '150' })).statusCode,
    ).toBe(403);
    expect(
      (await b.put('/api/v1/admin/settings/1/WEIGHT_TOLERANCE_KG', { value: 'abc' })).statusCode,
    ).toBe(400);
    expect(
      (await b.put('/api/v1/admin/settings/1/WEIGHT_TOLERANCE_KG', { value: '120' })).statusCode,
    ).toBe(200);
    expect(
      (await b.put('/api/v1/admin/settings/2/WEIGHT_TOLERANCE_KG', { value: '120' })).statusCode,
    ).toBe(403);

    const list = (await s.get('/api/v1/admin/settings?level=1')).json();
    const tol = list.find((x) => x.key === 'WEIGHT_TOLERANCE_KG');
    expect(tol).toMatchObject({
      value: '120',
      source: 'branch',
      companyValue: '100',
      openQuestion: 'Q6',
    });
    const company = (await s.get('/api/v1/admin/settings?level=0'))
      .json()
      .find((x) => x.key === 'WEIGHT_TOLERANCE_KG');
    expect(company.value).toBe('100');
  });
});

describe('idempotency (P0-06)', () => {
  it('same Idempotency-Key + same body replays; other body → 422', async () => {
    const admin = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
    const a = await login(admin);
    const key = `test-${Date.now()}`;
    const body = { code: 'TEST_ROLE_X', name: 'Test role', permissions: ['oc.view'] };
    const first = await a.post('/api/v1/admin/roles', body, {
      headers: { 'idempotency-key': key },
    });
    expect(first.statusCode).toBe(201);
    const second = await a.post('/api/v1/admin/roles', body, {
      headers: { 'idempotency-key': key },
    });
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.json()).toEqual(first.json());
    const other = await a.post(
      '/api/v1/admin/roles',
      { ...body, name: 'Other' },
      { headers: { 'idempotency-key': key } },
    );
    expect(other.statusCode).toBe(422);
  });
});
