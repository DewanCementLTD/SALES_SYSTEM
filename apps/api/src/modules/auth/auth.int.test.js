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

describe('P0-06 app skeleton', () => {
  it('invalid body → 400 problem+json with field errors', async () => {
    const c = new Client(t.app);
    const res = await c.post('/api/v1/auth/login', { usrid: '', brnch: 7 });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['body.usrid', 'body.password', 'body.brnch', 'body.fiscalYear']),
    );
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('unknown route → 404 problem+json; protected route without session → 401', async () => {
    const c = new Client(t.app);
    expect((await c.get('/api/v1/nope')).json().code).toBe('not_found');
    const me = await c.get('/api/v1/auth/me');
    expect(me.statusCode).toBe(401);
    expect(me.json().code).toBe('unauthenticated');
  });

  it('health endpoints answer', async () => {
    const c = new Client(t.app);
    expect((await c.get('/health/live')).json()).toEqual({ status: 'ok' });
    expect((await c.get('/health/ready')).statusCode).toBe(200);
    expect((await c.get('/metrics')).body).toContain('dcl_api_');
  });
});

describe('P0-08 auth (PRD 4.1)', () => {
  it('login sets httpOnly session cookies and returns user, branches and permissions', async () => {
    const u = await createUser(t.db, { roles: { 1: ['FINANCE'], 2: ['MARKETING'] } });
    const c = new Client(t.app);
    const res = await c.post('/api/v1/auth/login', {
      usrid: u.usrid,
      password: u.password,
      brnch: 1,
      fiscalYear: 2027,
    });
    expect(res.statusCode).toBe(200);
    const at = res.cookies.find((x) => x.name === 'at');
    expect(at.httpOnly).toBe(true);
    expect(res.cookies.find((x) => x.name === 'rt').path).toBe('/api/v1/auth');
    expect(res.cookies.find((x) => x.name === 'csrf').httpOnly).toBeFalsy();
    const body = res.json();
    expect(body.branch).toBe(1);
    expect(body.permissions).toContain('oc.confirm');
    expect(body.branches.map((b) => b.brnch)).toEqual([1, 2]);
    expect(body.branches[0].fiscalYears[0].year).toBe(2027);
  });

  it('wrong password ×5 locks the account (423) and a correct password is refused while locked', async () => {
    const u = await createUser(t.db);
    const c = new Client(t.app);
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await c.post('/api/v1/auth/login', {
        usrid: u.usrid,
        password: 'wrong-pass-1A',
        brnch: 1,
        fiscalYear: 2027,
      });
      codes.push(r.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 401, 423]);
    const r = await c.post('/api/v1/auth/login', {
      usrid: u.usrid,
      password: u.password,
      brnch: 1,
      fiscalYear: 2027,
    });
    expect(r.statusCode).toBe(423);
    expect(r.json().code).toBe('locked');
    t.clock.advance(16 * 60_000); // LOGIN_LOCK_MIN = 15
    await c.login(u.usrid, u.password);
  });

  it('unknown user and wrong password give the same message', async () => {
    const u = await createUser(t.db);
    const c = new Client(t.app);
    const a = await c.post('/api/v1/auth/login', {
      usrid: 'NO_SUCH_USER',
      password: 'x',
      brnch: 1,
      fiscalYear: 2027,
    });
    const b = await c.post('/api/v1/auth/login', {
      usrid: u.usrid,
      password: 'x',
      brnch: 1,
      fiscalYear: 2027,
    });
    expect(a.json().detail).toBe(b.json().detail);
  });

  it('refuses a branch the user is not allowed on', async () => {
    const u = await createUser(t.db, { roles: { 1: ['FINANCE'] } });
    const c = new Client(t.app);
    const r = await c.post('/api/v1/auth/login', {
      usrid: u.usrid,
      password: u.password,
      brnch: 2,
      fiscalYear: 2027,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('branch_forbidden');
  });

  it('access token expires after 15 min; refresh rotates and restores the session', async () => {
    const u = await createUser(t.db);
    const c = new Client(t.app);
    await c.login(u.usrid, u.password);
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(200);
    t.clock.advance(16 * 60_000);
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(401);
    const oldRt = c.cookies.get('rt');
    expect((await c.post('/api/v1/auth/refresh')).statusCode).toBe(200);
    expect(c.cookies.get('rt')).not.toBe(oldRt);
    expect((await c.get('/api/v1/auth/me')).statusCode).toBe(200);
  });

  it('refresh-token reuse revokes the whole family', async () => {
    const u = await createUser(t.db);
    const c = new Client(t.app);
    await c.login(u.usrid, u.password);
    const stolen = c.cookies.get('rt');
    expect((await c.post('/api/v1/auth/refresh')).statusCode).toBe(200); // legit rotation
    const goodRt = c.cookies.get('rt');

    const attacker = new Client(t.app);
    attacker.cookies.set('rt', stolen);
    const reuse = await attacker.post('/api/v1/auth/refresh');
    expect(reuse.statusCode).toBe(401);

    // the legitimate holder's newer token is now revoked as well
    const victim = new Client(t.app);
    victim.cookies.set('rt', goodRt);
    expect((await victim.post('/api/v1/auth/refresh')).statusCode).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const u = await createUser(t.db);
    const c = new Client(t.app);
    await c.login(u.usrid, u.password);
    const rt = c.cookies.get('rt');
    expect((await c.post('/api/v1/auth/logout')).statusCode).toBe(200);
    const again = new Client(t.app);
    again.cookies.set('rt', rt);
    expect((await again.post('/api/v1/auth/refresh')).statusCode).toBe(401);
  });

  it('state-changing requests need the CSRF header', async () => {
    const u = await createUser(t.db, { roles: { 1: ['FINANCE'], 2: ['FINANCE'] } });
    const c = new Client(t.app);
    await c.login(u.usrid, u.password);
    const r = await c.post(
      '/api/v1/auth/switch-branch',
      { brnch: 2, fiscalYear: 2027 },
      { headers: { 'x-csrf-token': 'bad' } },
    );
    expect(r.statusCode).toBe(403);
  });

  it('switch-branch changes the session branch and permissions', async () => {
    const u = await createUser(t.db, { roles: { 1: ['FINANCE'], 2: ['MARKETING'] } });
    const c = new Client(t.app);
    await c.login(u.usrid, u.password);
    const r = await c.post('/api/v1/auth/switch-branch', { brnch: 2, fiscalYear: 2027 });
    expect(r.statusCode).toBe(200);
    expect(r.json().branch).toBe(2);
    const me = (await c.get('/api/v1/auth/me')).json();
    expect(me.branch).toBe(2);
    expect(me.permissions).not.toContain('oc.confirm');
    expect(me.permissions).toContain('srf.create');
  });

  it('migrated/new users must change password first; policy and history are enforced', async () => {
    const u = await createUser(t.db, { mustChange: true });
    const c = new Client(t.app);
    const login = await c.login(u.usrid, u.password);
    expect(login.mustChangePassword).toBe(true);
    const blocked = await c.post('/api/v1/auth/switch-branch', { brnch: 1, fiscalYear: 2027 });
    expect(blocked.json().code).toBe('password_change_required');

    const weak = await c.post('/api/v1/auth/change-password', {
      currentPassword: u.password,
      newPassword: 'short',
    });
    expect(weak.statusCode).toBe(400);
    const same = await c.post('/api/v1/auth/change-password', {
      currentPassword: u.password,
      newPassword: u.password,
    });
    expect(same.statusCode).toBe(400);
    const ok = await c.post('/api/v1/auth/change-password', {
      currentPassword: u.password,
      newPassword: 'NewPassw0rd2026',
    });
    expect(ok.statusCode).toBe(200);
    expect((await c.get('/api/v1/auth/me')).json().mustChangePassword).toBe(false);
  });

  it('login is audited (BR-AUD-01)', async () => {
    const u = await createUser(t.db);
    const c = new Client(t.app);
    await c.login(u.usrid, u.password);
    const rows = await t.db.read((tx) =>
      tx.many(`SELECT ACTION FROM AUDIT_LOG WHERE ENTITY = 'APP_USER' AND ENTITY_KEY = :k`, {
        k: String(u.userId),
      }),
    );
    expect(rows.map((r) => r.ACTION)).toContain('LOGIN');
  });
});
