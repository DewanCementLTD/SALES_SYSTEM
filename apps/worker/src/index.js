// Background worker (TASKS P0-13): outbox relay → BullMQ queues → processors.
// Processors are idempotent per outbox id (jobId `outbox-<id>`); retries with exponential back-off;
// a job that fails its last attempt marks the outbox row FAILED so it shows on the admin screen.
import { Queue, Worker } from 'bullmq';
import pino from 'pino';
import { loadConfig } from '@dcl/api/config';
import { createDb } from '@dcl/api/lib/oracle/db';
import { expireOverdue } from '@dcl/api/modules/approvals/service';
import {
  QUEUE_NAMES,
  markDeliveryFailed,
  recoverStuck,
  relayOnce,
} from '@dcl/api/modules/outbox/service';
import { systemClock } from '@dcl/shared';
import { createSmsDriver } from './drivers/sms.js';
import { closeBrowser, createPdfProcessor } from './pdf.js';

const config = loadConfig({ ...process.env, DB_POOL_MAX: process.env.WORKER_DB_POOL_MAX ?? '6' });
const log = pino({
  level: config.LOG_LEVEL === 'silent' ? 'info' : config.LOG_LEVEL,
  base: { app: 'worker' },
});
const db = await createDb(config);
const redisUrl = new URL(config.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null,
};

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: false,
};
const queues = Object.fromEntries(
  QUEUE_NAMES.map((n) => [n, new Queue(n, { connection, defaultJobOptions })]),
);

const sms = createSmsDriver(process.env, log);

/** @type {Record<string, (job: import('bullmq').Job) => Promise<unknown>>} */
const processors = {
  pdf: createPdfProcessor({
    db,
    storageDir: config.STORAGE_DIR,
    qrSecret: config.QR_SECRET,
    clock: systemClock,
    log,
  }),
  sms: async (job) => {
    const { recipient, payload, eventType } = job.data;
    const text = payload?.text ?? `DCL: ${eventType}`;
    return sms.send(recipient, text);
  },
  // P2-09 implements e-mail (company SMTP for system mail) and WhatsApp link messages.
  email: async (job) =>
    log.info({ outboxId: job.data.outboxId }, 'email processor not implemented yet (P2-09)'),
  whatsapp: async (job) =>
    log.info(
      { outboxId: job.data.outboxId },
      'whatsapp link processor not implemented yet (P2-09)',
    ),
};

const workers = Object.entries(processors).map(([name, fn]) => {
  const w = new Worker(name, fn, { connection, concurrency: 4 });
  w.on('failed', async (job, err) => {
    log.warn(
      { queue: name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message },
      'job failed',
    );
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1) && job.data?.outboxId) {
      await markDeliveryFailed(db, job.data.outboxId, err.message).catch(() => {});
    }
  });
  return w;
});

let stopping = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function relayLoop() {
  while (!stopping) {
    try {
      const res = await relayOnce(db, { queues, now: systemClock.now(), log });
      if (res.claimed) log.info(res, 'outbox relayed');
      if (res.claimed < 20) await sleep(2000);
    } catch (err) {
      log.error({ err }, 'relay loop error');
      await sleep(5000);
    }
  }
}

async function housekeepingLoop() {
  while (!stopping) {
    try {
      const now = systemClock.now();
      const recovered = await recoverStuck(db, now);
      if (recovered) log.warn({ recovered }, 'outbox rows recovered after worker crash');
      const expired = await db.withTx((tx) => expireOverdue(tx, now), {
        usrid: 'worker',
        action: 'approvals.expire',
      });
      if (expired) log.info({ expired }, 'approval requests expired');
    } catch (err) {
      log.error({ err }, 'housekeeping error');
    }
    await sleep(60_000);
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'worker stopping');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(Object.values(queues).map((q) => q.close()));
  await closeBrowser().catch(() => {});
  await db.close(10);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

log.info({ queues: QUEUE_NAMES, sms: sms.name }, 'worker started');
relayLoop();
housekeepingLoop();
