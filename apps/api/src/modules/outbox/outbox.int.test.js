import { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/helpers/app.js';
import { enqueue, queueFor, recoverStuck, relayOnce } from './service.js';

const REDIS = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const connection = { host: REDIS.hostname, port: Number(REDIS.port || 6379) };

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
/** @type {Queue} */
let q;

beforeEach(async () => {
  t = await buildTestApp();
  q = new Queue(`test-outbox-${Date.now()}`, { connection });
});
afterEach(async () => {
  await q.obliterate({ force: true });
  await q.close();
  await t.close();
});

const status = (id) =>
  t.db.read((tx) =>
    tx.one('SELECT STATUS, TRIES FROM NOTIFICATION_OUTBOX WHERE OUTBOX_ID = :id', { id }),
  );

async function addRow(key) {
  return t.db.withTx((tx) =>
    enqueue(tx, {
      brnch: 1,
      eventType: 'DO_ISSUED',
      channel: 'SMS',
      recipient: '03001234567',
      payload: { doNo: '123' },
      dedupKey: key,
      now: t.clock.now(),
    }),
  );
}

async function jobCount() {
  const c = await q.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'prioritized',
  );
  return Object.values(c).reduce((a, b) => a + b, 0);
}

describe('outbox + relay (P0-13, BR-NTF-02)', () => {
  it('maps rows to queues', () => {
    expect(queueFor({ CHANNEL: 'SMS', EVENT_TYPE: 'DO_ISSUED' })).toBe('sms');
    expect(queueFor({ CHANNEL: 'JOB', EVENT_TYPE: 'PDF_RENDER' })).toBe('pdf');
    expect(queueFor({ CHANNEL: 'JOB', EVENT_TYPE: 'FBR_SUBMIT' })).toBe('fbr');
  });

  it('dedup key: a second enqueue of the same event is ignored', async () => {
    const key = `test-dedup-${Date.now()}`;
    const a = await addRow(key);
    const b = await addRow(key);
    expect(b).toEqual({ outboxId: a.outboxId, duplicate: true });
  });

  it('crash after the job was added but before SENT was recorded → still exactly one job', async () => {
    const { outboxId } = await addRow(`test-crash1-${Date.now()}`);
    let crash = true;
    const flaky = {
      add: async (...args) => {
        await q.add(...args);
        if (crash) throw new Error('worker crashed after add');
      },
    };
    const r1 = await relayOnce(t.db, { queues: { sms: flaky }, now: t.clock.now() });
    expect(r1).toMatchObject({ claimed: 1, retry: 1 });
    expect((await status(outboxId)).STATUS).toBe('PENDING');

    crash = false;
    t.clock.advance(2 * 60_000); // past the back-off
    const r2 = await relayOnce(t.db, { queues: { sms: flaky }, now: t.clock.now() });
    expect(r2).toMatchObject({ sent: 1 });
    expect(await status(outboxId)).toMatchObject({ STATUS: 'SENT', TRIES: 2 });
    expect(await jobCount()).toBe(1);
    expect((await q.getJob(`outbox-${outboxId}`)).data.payload).toEqual({ doNo: '123' });
  });

  it('crash after claim (row stuck PROCESSING) → recovered after the lease, sent once', async () => {
    const { outboxId } = await addRow(`test-crash2-${Date.now()}`);
    // state a claim leaves behind when the worker process dies before adding the job
    // (the single-connection test harness cannot run a hanging relay concurrently)
    await t.db.withTx((tx) =>
      tx.exec(
        `UPDATE NOTIFICATION_OUTBOX SET STATUS = 'PROCESSING', TRIES = TRIES + 1, NEXT_TRY_ON = :lease WHERE OUTBOX_ID = :id`,
        { id: outboxId, lease: new Date(t.clock.now().getTime() + 5 * 60_000) },
      ),
    );

    expect(await recoverStuck(t.db, t.clock.now())).toBe(0); // lease not over yet
    t.clock.advance(6 * 60_000);
    expect(await recoverStuck(t.db, t.clock.now())).toBeGreaterThanOrEqual(1);
    const r = await relayOnce(t.db, { queues: { sms: q }, now: t.clock.now() });
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect((await status(outboxId)).STATUS).toBe('SENT');
    expect(await jobCount()).toBeGreaterThanOrEqual(1);
    expect(await q.getJob(`outbox-${outboxId}`)).toBeTruthy();
  });

  it('gives up after max tries (DEAD) and keeps it visible', async () => {
    const { outboxId } = await addRow(`test-dead-${Date.now()}`);
    const broken = { add: async () => Promise.reject(new Error('redis down')) };
    for (let i = 0; i < 3; i += 1) {
      await relayOnce(t.db, { queues: { sms: broken }, now: t.clock.now(), maxTries: 3 });
      t.clock.advance(61 * 60_000);
    }
    expect(await status(outboxId)).toMatchObject({ STATUS: 'DEAD', TRIES: 3 });
  });
});
