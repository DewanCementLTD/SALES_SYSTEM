// Weighbridge reading upload (TASKS P3-02, BR-WGT-01). SALES_NEW, rolled back.
import { deviceHmac, readingText, signTokenRequest } from '@dcl/shared';
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

async function register(deviceId, deviceType = 'WEIGHBRIDGE') {
  const u = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch: 1 });
  const r = await c.post('/api/v1/admin/devices', {
    deviceId,
    brnch: 1,
    deviceType,
    deviceName: `Test ${deviceType}`,
  });
  const secret = r.json().secret;
  const tok = await t.app.inject({
    method: 'POST',
    url: '/api/v1/devices/token',
    payload: await signTokenRequest(deviceId, secret, t.clock.now()),
  });
  return { secret, token: tok.json().token };
}
const upload = (token, body) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/plant/weigh-readings',
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
const signed = async (secret, r) => ({ ...r, signature: await deviceHmac(secret, readingText(r)) });

describe('weighbridge readings (P3-02)', () => {
  it('BR-WGT-01: a signed stable reading is stored once; resend is a no-op; tampering is refused', async () => {
    const { secret, token } = await register('KHI-TEST-WB-01');
    const base = {
      deviceId: 'KHI-TEST-WB-01',
      readingId: '0193f1c2-aaaa-7000-8000-000000000001',
      weightKg: 41250,
      stable: true,
      readOn: '2026-11-24T04:59:30.000Z',
    };
    const body = await signed(secret, base);
    let r = await upload(token, body);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ readingId: base.readingId, duplicate: false });
    const row = await t.db.read((tx) =>
      tx.one('SELECT BRNCH, WEIGHT_KG, STABLE FROM DEVICE_READING WHERE READING_ID = :r', {
        r: base.readingId,
      }),
    );
    expect(row).toMatchObject({ BRNCH: 1, WEIGHT_KG: 41250, STABLE: 'Y' });

    r = await upload(token, body); // agent retry after a lost response
    expect(r.statusCode).toBe(200);
    expect(r.json().duplicate).toBe(true);

    // weight changed after signing
    r = await upload(token, { ...body, weightKg: 41000 });
    expect(r.statusCode).toBe(422);
    expect(r.json().ruleId).toBe('BR-WGT-01');
    // same id, another (correctly signed) weight
    r = await upload(token, await signed(secret, { ...base, weightKg: 41000 }));
    expect(r.statusCode).toBe(409);
    // unstable or from the future
    r = await upload(
      token,
      await signed(secret, { ...base, readingId: 'reading-0002', stable: false }),
    );
    expect(r.json().detail).toMatch(/stable/);
    r = await upload(
      token,
      await signed(secret, {
        ...base,
        readingId: 'reading-0003',
        readOn: '2026-11-24T05:30:00.000Z',
      }),
    );
    expect(r.json().detail).toMatch(/future/);
  });

  it('P-6: only the weighbridge itself; not another device, a gate tablet or a user', async () => {
    const wb = await register('KHI-TEST-WB-01');
    const gate = await register('KHI-TEST-GT-01', 'GATE');
    const base = {
      deviceId: 'KHI-TEST-WB-01',
      readingId: 'reading-0001',
      weightKg: 15000,
      stable: true,
      readOn: '2026-11-24T04:59:00.000Z',
    };
    const body = await signed(wb.secret, base);
    expect((await upload(gate.token, body)).statusCode).toBe(403);
    const r = await upload(
      gate.token,
      await signed(gate.secret, { ...base, deviceId: 'KHI-TEST-GT-01' }),
    );
    expect(r.statusCode).toBe(403);
    expect(r.json().detail).toMatch(/weighbridge/);
    const u = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
    const c = new Client(t.app);
    await c.login(u.usrid, u.password, { brnch: 1 });
    expect((await c.post('/api/v1/plant/weigh-readings', body)).statusCode).toBe(403);
  });
});
