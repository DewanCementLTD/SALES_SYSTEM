'use client';

// Plant offline store (BUSINESS_RULES BR-OFF-01…04, ARCHITECTURE §6.3; TASKS P3-10): IndexedDB via
// Dexie. `outbox` keeps the events made while the server is unreachable (client UUID, device time),
// pushed in order to POST /plant/sync when the connection is back; `cache` keeps the offline
// document cache (open DOs/permits with their QR signatures) for checking QRs offline (BR-OFF-02).
import Dexie from 'dexie';
import { api } from '@/lib/api';

let db = null;
function store() {
  if (!db) {
    db = new Dexie('dcl-plant');
    db.version(1).stores({ outbox: '++seq, clientId, status', cache: 'brnch' });
  }
  return db;
}

/** Network down (fetch failed) rather than a refusal by the server. */
export const isOffline = (err) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  err instanceof TypeError ||
  /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message ?? ''));

/** Keep an event for later (status PENDING). */
export async function queueEvent(type, payload, clientId = crypto.randomUUID()) {
  await store().outbox.add({
    clientId,
    type,
    payload,
    deviceTime: new Date().toISOString(),
    status: 'PENDING',
  });
  window.dispatchEvent(new Event('dcl-outbox'));
  return clientId;
}

export async function outboxItems() {
  return store().outbox.orderBy('seq').toArray();
}

/**
 * Push PENDING events in order (≤ 50). APPLIED / DUPLICATE leave the outbox; CONFLICT stays with
 * the server's message (the supervisor resolves it on Plant › Offline sync).
 */
let pushing = null;
export function pushOutbox() {
  if (pushing) return pushing;
  pushing = (async () => {
    try {
      const pending = (await outboxItems()).filter((e) => e.status === 'PENDING').slice(0, 50);
      if (!pending.length) return { pushed: 0 };
      const { results } = await api('/plant/sync', {
        method: 'POST',
        body: {
          events: pending.map(({ clientId, type, payload, deviceTime }) => ({
            clientId,
            type,
            payload,
            deviceTime,
          })),
        },
      });
      for (const r of results) {
        const item = pending.find((e) => e.clientId === r.clientId);
        if (!item) continue;
        if (r.status === 'CONFLICT')
          await store().outbox.update(item.seq, {
            status: 'CONFLICT',
            error: r.error?.detail ?? 'Not applied',
            conflictId: r.conflictId ?? null,
          });
        else await store().outbox.delete(item.seq);
      }
      return { pushed: results.length, results };
    } finally {
      pushing = null;
      window.dispatchEvent(new Event('dcl-outbox'));
    }
  })();
  return pushing;
}

/** Remove a conflicted event from this tablet (the supervisor handles it on the server). */
export async function dropEvent(seq) {
  await store().outbox.delete(seq);
  window.dispatchEvent(new Event('dcl-outbox'));
}

/** Offline document cache: refresh when stale (OFFLINE_CACHE_MIN), keep the last copy. */
export async function refreshCache(brnch) {
  const old = await store().cache.get(brnch);
  if (old && Date.now() - old.savedAt < (old.refreshMin ?? 5) * 60000) return old;
  try {
    const fresh = await api('/plant/offline-cache');
    const row = { ...fresh, brnch, savedAt: Date.now() };
    await store().cache.put(row);
    return row;
  } catch {
    return old ?? null;
  }
}

export async function cachedDocs(brnch) {
  return store().cache.get(brnch);
}
