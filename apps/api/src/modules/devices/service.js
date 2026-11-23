// Plant devices (TASKS P3-01, ARCHITECTURE §7, PERMISSIONS P-6): APP_DEVICE registry. The secret
// is generated here, shown once, stored encrypted (AES-256-GCM, APP_ENC_KEY) and used to check the
// device's HMAC signatures. Devices are bound to one branch; switched off, never deleted.
import { newDeviceSecret, verifyDeviceSignature, verifyTokenRequest } from '@dcl/shared';
import { branchFilter } from '../../lib/branch-scope.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { signDeviceToken, DEVICE_TTL_SEC } from '../auth/tokens.js';

const ENTITY = 'APP_DEVICE';
const COLS = `DEVICE_ID, BRNCH, DEVICE_TYPE, DEVICE_NAME, CONFIG_JSON, ACTIVE, LAST_SEEN_ON, CREATED_ON`;

function mapDevice(r) {
  let config = {};
  try {
    config = r.CONFIG_JSON ? JSON.parse(r.CONFIG_JSON) : {};
  } catch {
    config = {};
  }
  return {
    deviceId: r.DEVICE_ID,
    brnch: Number(r.BRNCH),
    deviceType: r.DEVICE_TYPE,
    deviceName: r.DEVICE_NAME,
    config,
    active: r.ACTIVE === 'Y',
    lastSeenOn: r.LAST_SEEN_ON ?? null,
    createdOn: r.CREATED_ON ?? null,
  };
}

export async function list(tx, branches) {
  const bf = branchFilter('BRNCH', branches);
  const rows = await tx.many(
    `SELECT ${COLS} FROM APP_DEVICE WHERE ${bf.sql} ORDER BY BRNCH, DEVICE_TYPE, DEVICE_ID`,
    bf.binds,
  );
  return rows.map(mapDevice);
}

export async function get(tx, deviceId) {
  const r = await tx.one(`SELECT ${COLS} FROM APP_DEVICE WHERE DEVICE_ID = :d`, { d: deviceId });
  if (!r) throw Errors.notFound(`Device ${deviceId}`);
  return mapDevice(r);
}

/** Create: returns the device and its secret (shown once). */
export async function create(tx, actor, encKey, body) {
  const exists = await tx.one('SELECT DEVICE_ID FROM APP_DEVICE WHERE DEVICE_ID = :d', {
    d: body.deviceId,
  });
  if (exists) throw Errors.duplicate(`Device ${body.deviceId} already exists`);
  const secret = newDeviceSecret();
  await tx.exec(
    `INSERT INTO APP_DEVICE (DEVICE_ID, BRNCH, DEVICE_TYPE, DEVICE_NAME, SECRET_ENC, CONFIG_JSON, ACTIVE, CREATED_ON)
     VALUES (:d, :b, :t, :n, :s, :c, 'Y', :now)`,
    {
      d: body.deviceId,
      b: body.brnch,
      t: body.deviceType,
      n: body.deviceName,
      s: encryptSecret(secret, encKey),
      c: JSON.stringify(body.config ?? {}),
      now: actor.now,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: body.deviceId,
    action: 'CREATE',
    brnch: body.brnch,
    newValues: { ...body }, // never the secret
  });
  return { device: await get(tx, body.deviceId), secret };
}

export async function update(tx, actor, deviceId, body) {
  const old = await get(tx, deviceId);
  await tx.exec(
    `UPDATE APP_DEVICE SET DEVICE_NAME = :n, ACTIVE = :a, CONFIG_JSON = :c WHERE DEVICE_ID = :d`,
    {
      n: body.deviceName,
      a: body.active ? 'Y' : 'N',
      c: JSON.stringify(body.config ?? old.config),
      d: deviceId,
    },
  );
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: deviceId,
    action: old.active && !body.active ? 'DEACTIVATE' : 'UPDATE',
    brnch: old.brnch,
    oldValues: { deviceName: old.deviceName, active: old.active, config: old.config },
    newValues: body,
  });
  return get(tx, deviceId);
}

/** New secret (the old one stops working at once; tokens already issued expire within 12 h). */
export async function rotateSecret(tx, actor, encKey, deviceId) {
  const d = await get(tx, deviceId);
  const secret = newDeviceSecret();
  await tx.exec('UPDATE APP_DEVICE SET SECRET_ENC = :s WHERE DEVICE_ID = :d', {
    s: encryptSecret(secret, encKey),
    d: deviceId,
  });
  await recordAudit(tx, actor.audit, {
    entity: ENTITY,
    key: deviceId,
    action: 'ROTATE_SECRET',
    brnch: d.brnch,
  });
  return { device: d, secret };
}

async function secretOf(tx, encKey, deviceId) {
  const r = await tx.one(
    'SELECT SECRET_ENC, BRNCH, DEVICE_TYPE, ACTIVE FROM APP_DEVICE WHERE DEVICE_ID = :d',
    { d: deviceId },
  );
  if (!r) return null;
  return {
    secret: decryptSecret(r.SECRET_ENC, encKey),
    brnch: Number(r.BRNCH),
    deviceType: r.DEVICE_TYPE,
    active: r.ACTIVE === 'Y',
  };
}

/**
 * POST /devices/token: signed request → device token (12 h). Every failure answers the same
 * 401 (no hint whether the device exists); the reason goes to the audit log.
 */
export async function issueToken(tx, ctx, { encKey, jwtSecret, now }, req) {
  const s = await secretOf(tx, encKey, req.deviceId);
  const check = s && s.active ? await verifyTokenRequest(req, s.secret, now) : null;
  if (!check?.ok) {
    await recordAudit(tx, ctx, {
      entity: ENTITY,
      key: req.deviceId,
      action: 'TOKEN_REFUSED',
      brnch: s?.brnch ?? null,
      reason: !s ? 'unknown device' : !s.active ? 'device switched off' : check.reason,
    });
    return null;
  }
  await tx.exec('UPDATE APP_DEVICE SET LAST_SEEN_ON = :now WHERE DEVICE_ID = :d', {
    now,
    d: req.deviceId,
  });
  const token = await signDeviceToken(
    { deviceId: req.deviceId, brnch: s.brnch, deviceType: s.deviceType },
    jwtSecret,
    now,
  );
  return { token, expiresIn: DEVICE_TTL_SEC, brnch: s.brnch, deviceType: s.deviceType };
}

/** Check a signature made by a device over `text` (weigh readings, BR-WGT-01). */
export async function verifySignedBy(tx, encKey, deviceId, text, signature) {
  const s = await secretOf(tx, encKey, deviceId);
  return Boolean(s?.active && (await verifyDeviceSignature(s.secret, text, signature)));
}
