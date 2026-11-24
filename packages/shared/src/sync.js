// Offline plant events (BUSINESS_RULES BR-OFF-01…04, ARCHITECTURE §6.3; TASKS P3-10). The PWA keeps
// them in its local outbox with a client UUID and the device time, then pushes them in order.
import { z } from 'zod';
import { zGateIn } from './gate.js';
import { zReason } from './validators.js';

export const SYNC_EVENT_TYPES = Object.freeze(['GATE_IN', 'TARE', 'GROSS', 'EXIT']);
export const SYNC_BATCH_MAX = 50;

/** Which gate pass a later event belongs to: the server id, or the client id of an offline gate-in. */
const zGpRef = z
  .object({
    gpId: z.number().int().positive().optional(),
    gpClientId: z.string().uuid().optional(),
  })
  .refine((r) => r.gpId || r.gpClientId, 'gpId or gpClientId is required');

const zWeight = z.union([
  z.object({
    deviceId: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/),
    readingId: z.string().regex(/^[A-Za-z0-9-]{8,60}$/),
  }),
  z.object({ weightKg: z.number().int().min(1).max(200000), reason: zReason }),
]);

const base = { clientId: z.string().uuid(), deviceTime: z.string().max(40) };

export const zSyncEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('GATE_IN'), payload: zGateIn }),
  z.object({ ...base, type: z.literal('TARE'), payload: z.intersection(zGpRef, zWeight) }),
  z.object({ ...base, type: z.literal('GROSS'), payload: z.intersection(zGpRef, zWeight) }),
  z.object({ ...base, type: z.literal('EXIT'), payload: zGpRef }),
]);

/** POST /plant/sync */
export const zSyncBatch = z.object({ events: z.array(zSyncEvent).min(1).max(SYNC_BATCH_MAX) });

/** Permission a user needs for an event (devices: gate tablets push GATE_IN and EXIT only). */
export function syncPermission(ev) {
  if (ev.type === 'GATE_IN') return 'gate.in';
  if (ev.type === 'EXIT') return 'gate.exit';
  return 'weightKg' in ev.payload ? 'weigh.manual' : 'weigh.capture';
}
