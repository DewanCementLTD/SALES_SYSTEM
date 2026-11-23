// Weighbridge readings from the agent (ARCHITECTURE §6.4, BR-WGT-01/07, TASKS P3-02). The agent
// captures a stable reading, signs it with its device secret and uploads it (now or later from its
// buffer). Stored once per (device, reading id): a resend of the same reading is a no-op, a
// different weight under the same id is refused. The weighing screen then uses the reading id for
// the tare or gross (P3-05).
import { DEVICE_CLOCK_SKEW_SEC, readingText } from '@dcl/shared';
import { Errors } from '../../lib/errors.js';
import { verifySignedBy } from '../devices/service.js';

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {{ deviceId: string, brnch: number, deviceType: string }} device the calling device
 * @param {{ deviceId: string, readingId: string, weightKg: number, stable: boolean, readOn: string, signature: string }} r
 */
export async function receiveReading(tx, { encKey, now }, device, r) {
  if (r.deviceId !== device.deviceId)
    throw Errors.forbidden('A device can only upload its own readings');
  if (device.deviceType !== 'WEIGHBRIDGE')
    throw Errors.forbidden('Only weighbridge agents upload readings');
  if (!(await verifySignedBy(tx, encKey, r.deviceId, readingText(r), r.signature)))
    throw Errors.rule('BR-WGT-01', 'The reading signature does not match this device');
  if (!r.stable) throw Errors.rule('BR-WGT-01', 'Only a stable reading can be captured');
  const readOn = new Date(r.readOn);
  if (Number.isNaN(readOn.getTime())) throw Errors.validation('readOn is not a date');
  if (readOn.getTime() - now.getTime() > DEVICE_CLOCK_SKEW_SEC * 1000)
    throw Errors.rule('BR-WGT-01', 'The reading time is in the future: check the agent PC clock');

  const old = await tx.one(
    `SELECT WEIGHT_KG, RECEIVED_ON FROM DEVICE_READING WHERE DEVICE_ID = :d AND READING_ID = :r`,
    { d: r.deviceId, r: r.readingId },
  );
  if (old) {
    if (Number(old.WEIGHT_KG) !== r.weightKg)
      throw Errors.duplicate(`Reading ${r.readingId} was already received with another weight`);
    return { readingId: r.readingId, receivedOn: old.RECEIVED_ON, duplicate: true };
  }
  await tx.exec(
    `INSERT INTO DEVICE_READING (DEVICE_ID, READING_ID, BRNCH, WEIGHT_KG, STABLE, READ_ON, RECEIVED_ON, SIGNATURE)
     VALUES (:d, :r, :b, :kg, 'Y', :ro, :now, :sig)`,
    {
      d: r.deviceId,
      r: r.readingId,
      b: device.brnch,
      kg: r.weightKg,
      ro: readOn,
      now,
      sig: r.signature,
    },
  );
  return { readingId: r.readingId, receivedOn: now, duplicate: false };
}

/** A reading of a branch, for the tare/gross commands (P3-05). */
export async function getReading(tx, brnch, deviceId, readingId) {
  const r = await tx.one(
    `SELECT DEVICE_ID, READING_ID, BRNCH, WEIGHT_KG, STABLE, READ_ON, RECEIVED_ON FROM DEVICE_READING
      WHERE DEVICE_ID = :d AND READING_ID = :r AND BRNCH = :b`,
    { d: deviceId, r: readingId, b: brnch },
  );
  return r
    ? {
        deviceId: r.DEVICE_ID,
        readingId: r.READING_ID,
        brnch: Number(r.BRNCH),
        weightKg: Number(r.WEIGHT_KG),
        stable: r.STABLE === 'Y',
        readOn: r.READ_ON,
        receivedOn: r.RECEIVED_ON,
      }
    : null;
}
