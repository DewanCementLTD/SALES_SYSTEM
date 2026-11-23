// Plant devices (TASKS P3-01, PERMISSIONS P-6): registry, secret once + encrypted, signed token
// request, device token only for device routes of its branch, switch off, rotate. Rolled back.
import { signTokenRequest } from '@dcl/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
  t.clock.set('2026-11-24T05:00:00Z');
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
const ID = 'KHI-TEST-WB-01';
const token = async (deviceId, secret) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/devices/token',
    payload: await signTokenRequest(deviceId, secret, t.clock.now()),
  });
const asDevice = (tok, url, method = 'GET') =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${tok}` } });

describe('devices (P3-01)', () => {
  it('register → signed token → device routes only, own branch; off and rotate stop the old access', async () => {
    const admin = await as({ 1: ['SYS_ADMIN'], 2: ['SYS_ADMIN'] });
    let r = await admin.post('/api/v1/admin/devices', {
      deviceId: ID,
      brnch: 1,
      deviceType: 'WEIGHBRIDGE',
      deviceName: 'Karachi weighbridge 1',
      config: { port: 'COM3', baud: 9600, profile: 'simulator' },
    });
    expect(r.statusCode, r.body).toBe(201);
    const { secret } = r.json();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await t.db.read((tx) =>
      tx.one('SELECT SECRET_ENC FROM APP_DEVICE WHERE DEVICE_ID = :d', { d: ID }),
    );
    expect(row.SECRET_ENC.startsWith('v1.')).toBe(true);
    expect(row.SECRET_ENC).not.toContain(secret);
    expect(
      (await admin.get('/api/v1/admin/devices')).json().items.map((d) => d.deviceId),
    ).toContain(ID);
    // same id twice
    expect(
      (
        await admin.post('/api/v1/admin/devices', {
          deviceId: ID,
          brnch: 1,
          deviceType: 'GATE',
          deviceName: 'again',
        })
      ).statusCode,
    ).toBe(409);

    // wrong secret → 401, refused attempt audited
    expect((await token(ID, 'not-the-secret-0000000000')).statusCode).toBe(401);
    const refused = await t.db.read((tx) =>
      tx.one(
        "SELECT REASON FROM AUDIT_LOG WHERE ENTITY = 'APP_DEVICE' AND ENTITY_KEY = :d AND ACTION = 'TOKEN_REFUSED'",
        { d: ID },
      ),
    );
    expect(refused.REASON).toBe('bad signature');

    r = await token(ID, secret);
    expect(r.statusCode, r.body).toBe(200);
    const tok = r.json().token;
    expect(r.json()).toMatchObject({ brnch: 1, deviceType: 'WEIGHBRIDGE', expiresIn: 43200 });

    r = await asDevice(tok, '/api/v1/devices/me');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ deviceId: ID, config: { port: 'COM3' } });
    expect(r.json().lastSeenOn).toBeTruthy();
    // P-6: nothing else
    r = await asDevice(tok, '/api/v1/do');
    expect(r.statusCode).toBe(403);
    expect(r.json().detail).toMatch(/plant endpoints/);
    // a device token is never a user session
    r = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { at: tok } });
    expect(r.statusCode).toBe(401);

    // switched off → its token stops working
    r = await admin.put(`/api/v1/admin/devices/${ID}`, {
      deviceName: 'Karachi weighbridge 1',
      active: false,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await asDevice(tok, '/api/v1/devices/me')).statusCode).toBe(401);
    expect((await token(ID, secret)).statusCode).toBe(401);
    await admin.put(`/api/v1/admin/devices/${ID}`, {
      deviceName: 'Karachi weighbridge 1',
      active: true,
    });

    // rotate: old secret refused, new accepted
    r = await admin.post(`/api/v1/admin/devices/${ID}/rotate-secret`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect((await token(ID, secret)).statusCode).toBe(401);
    expect((await token(ID, r.json().secret)).statusCode).toBe(200);
  });

  it('branch scope: an administrator of Hattar cannot manage or list Karachi devices', async () => {
    const khi = await as({ 1: ['SYS_ADMIN'] });
    expect(
      (
        await khi.post('/api/v1/admin/devices', {
          deviceId: ID,
          brnch: 1,
          deviceType: 'GATE',
          deviceName: 'Karachi gate tablet',
        })
      ).statusCode,
    ).toBe(201);
    const isb = await as({ 2: ['SYS_ADMIN'] }, 2);
    const list = (await isb.get('/api/v1/admin/devices')).json();
    expect(list.items.every((d) => d.brnch === 2)).toBe(true);
    expect(
      (await isb.put(`/api/v1/admin/devices/${ID}`, { deviceName: 'x1', active: false }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await isb.post('/api/v1/admin/devices', {
          deviceId: 'KHI-TEST-WB-02',
          brnch: 1,
          deviceType: 'GATE',
          deviceName: 'not mine',
        })
      ).statusCode,
    ).toBe(403);
  });
});
