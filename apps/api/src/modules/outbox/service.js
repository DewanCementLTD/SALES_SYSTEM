// Transactional outbox (ADR-6, BR-NTF-02, TASKS P0-13).
// Writer: services call `enqueue(tx, …)` inside the business transaction.
// Relay: the worker claims due rows and hands each to a BullMQ queue with jobId `outbox-<id>`;
// BullMQ ignores a second add with the same jobId, so a crash between "added" and "marked SENT"
// (row recovered and re-added) still delivers exactly once.
import oracledb from 'oracledb';

/** @typedef {import('../../lib/oracle/db.js').Tx} Tx */

export const CHANNELS = Object.freeze(['SMS', 'EMAIL', 'WHATSAPP', 'INAPP', 'JOB']);

/** BullMQ queue for an outbox row. */
export function queueFor(row) {
  switch (row.CHANNEL ?? row.channel) {
    case 'SMS':
      return 'sms';
    case 'EMAIL':
      return 'email';
    case 'WHATSAPP':
      return 'whatsapp';
    default: {
      const ev = row.EVENT_TYPE ?? row.eventType;
      if (ev.startsWith('PDF_')) return 'pdf';
      if (ev.startsWith('EXCEL_')) return 'excel';
      if (ev.startsWith('FBR_')) return 'fbr';
      if (ev.startsWith('LEDGER_')) return 'recon';
      return 'misc';
    }
  }
}

export const QUEUE_NAMES = Object.freeze([
  'pdf',
  'excel',
  'sms',
  'email',
  'whatsapp',
  'fbr',
  'recon',
  'misc',
]);

/**
 * Add an outbox row in the caller's transaction. `dedupKey` = one send per event+recipient+channel;
 * a second enqueue with the same key is ignored (returns the existing id).
 * @param {Tx} tx
 * @param {{ brnch?: number|null, eventType: string, aggregateType?: string, aggregateKey?: string, channel: string,
 *   recipient?: string|null, payload?: unknown, dedupKey: string, now: Date }} m
 */
export async function enqueue(tx, m) {
  if (!CHANNELS.includes(m.channel)) throw new Error(`Bad outbox channel ${m.channel}`);
  const existing = await tx.one('SELECT OUTBOX_ID FROM NOTIFICATION_OUTBOX WHERE DEDUP_KEY = :k', {
    k: m.dedupKey,
  });
  if (existing) return { outboxId: existing.OUTBOX_ID, duplicate: true };
  const id = await tx.nextId('SEQ_NOTIFICATION_OUTBOX');
  await tx.exec(
    `INSERT INTO NOTIFICATION_OUTBOX (OUTBOX_ID, BRNCH, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_KEY, CHANNEL, RECIPIENT,
        PAYLOAD, DEDUP_KEY, STATUS, TRIES, NEXT_TRY_ON, CREATED_ON)
     VALUES (:id, :b, :ev, :at2, :ak, :ch, :rc, :pl, :dk, 'PENDING', 0, :now, :now)`,
    {
      id,
      b: m.brnch ?? null,
      ev: m.eventType,
      at2: m.aggregateType ?? null,
      ak: m.aggregateKey ?? null,
      ch: m.channel,
      rc: m.recipient ?? null,
      pl: { type: oracledb.CLOB, val: JSON.stringify(m.payload ?? null) },
      dk: m.dedupKey.slice(0, 150),
      now: m.now,
    },
  );
  return { outboxId: id, duplicate: false };
}

/** Exponential back-off: 1, 2, 4, 8 … minutes, max 60. */
export const backoffMinutes = (tries) => Math.min(60, 2 ** Math.max(0, tries - 1));

const LEASE_MIN = 5;

/**
 * Claim due rows and push them to their queues. Returns counts.
 * @param {import('../../lib/oracle/db.js').Db} db
 * @param {{ queues: Record<string, { add: (name: string, data: unknown, opts: object) => Promise<unknown> }>,
 *   now: Date, batch?: number, maxTries?: number, log?: { warn: Function } }} o
 */
export async function relayOnce(db, { queues, now, batch = 20, maxTries = 5, log }) {
  const lease = new Date(now.getTime() + LEASE_MIN * 60_000);
  const rows = await db.withTx(
    async (tx) => {
      // FOR UPDATE SKIP LOCKED lets several workers claim different rows (works on 11g)
      const due = await tx.many(
        `SELECT OUTBOX_ID, BRNCH, EVENT_TYPE, AGGREGATE_TYPE, AGGREGATE_KEY, CHANNEL, RECIPIENT, PAYLOAD, DEDUP_KEY, TRIES
           FROM NOTIFICATION_OUTBOX
          WHERE STATUS = 'PENDING' AND NEXT_TRY_ON <= :now
          ORDER BY OUTBOX_ID
          FOR UPDATE SKIP LOCKED`,
        { now },
        { maxRows: batch },
      );
      for (const r of due) {
        await tx.exec(
          `UPDATE NOTIFICATION_OUTBOX SET STATUS = 'PROCESSING', TRIES = TRIES + 1, NEXT_TRY_ON = :lease WHERE OUTBOX_ID = :id`,
          { id: r.OUTBOX_ID, lease },
        );
      }
      return due;
    },
    { usrid: 'worker', action: 'outbox.claim' },
  );

  const res = { claimed: rows.length, sent: 0, retry: 0, dead: 0 };
  for (const r of rows) {
    const tries = Number(r.TRIES) + 1;
    try {
      const queue = queues[queueFor(r)];
      if (!queue) throw new Error(`No queue for ${queueFor(r)}`);
      await queue.add(
        r.EVENT_TYPE,
        {
          outboxId: r.OUTBOX_ID,
          brnch: r.BRNCH,
          eventType: r.EVENT_TYPE,
          aggregateType: r.AGGREGATE_TYPE,
          aggregateKey: r.AGGREGATE_KEY,
          channel: r.CHANNEL,
          recipient: r.RECIPIENT,
          payload: r.PAYLOAD ? JSON.parse(r.PAYLOAD) : null,
          dedupKey: r.DEDUP_KEY,
        },
        { jobId: `outbox-${r.OUTBOX_ID}` },
      );
      await db.withTx(
        (tx) =>
          tx.exec(
            `UPDATE NOTIFICATION_OUTBOX SET STATUS = 'SENT', SENT_ON = :now, LAST_ERROR = NULL WHERE OUTBOX_ID = :id`,
            {
              id: r.OUTBOX_ID,
              now,
            },
          ),
        { usrid: 'worker', action: 'outbox.sent' },
      );
      res.sent += 1;
    } catch (err) {
      const dead = tries >= maxTries;
      log?.warn({ err, outboxId: r.OUTBOX_ID }, 'outbox relay failed');
      await db.withTx(
        (tx) =>
          tx.exec(
            `UPDATE NOTIFICATION_OUTBOX SET STATUS = :s, NEXT_TRY_ON = :next, LAST_ERROR = :e WHERE OUTBOX_ID = :id`,
            {
              id: r.OUTBOX_ID,
              s: dead ? 'DEAD' : 'PENDING',
              next: new Date(now.getTime() + backoffMinutes(tries) * 60_000),
              e: String(err?.message ?? err).slice(0, 2000),
            },
          ),
        { usrid: 'worker', action: 'outbox.fail' },
      );
      if (dead) res.dead += 1;
      else res.retry += 1;
    }
  }
  return res;
}

/** Rows whose worker died while PROCESSING (lease expired) go back to PENDING. */
export function recoverStuck(db, now) {
  return db.withTx(
    (tx) =>
      tx.exec(
        `UPDATE NOTIFICATION_OUTBOX SET STATUS = 'PENDING' WHERE STATUS = 'PROCESSING' AND NEXT_TRY_ON <= :now`,
        {
          now,
        },
      ),
    { usrid: 'worker', action: 'outbox.recover' },
  );
}

/** A delivery attempt by a queue processor failed for good: make it visible (DEAD). */
export function markDeliveryFailed(db, outboxId, error) {
  return db.withTx(
    (tx) =>
      tx.exec(
        `UPDATE NOTIFICATION_OUTBOX SET STATUS = 'FAILED', LAST_ERROR = :e WHERE OUTBOX_ID = :id`,
        {
          id: outboxId,
          e: String(error).slice(0, 2000),
        },
      ),
    { usrid: 'worker', action: 'outbox.failed' },
  );
}
