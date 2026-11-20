import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
let dir;
const FAKE_PDF = Buffer.from('%PDF-1.7\n% test file\n');

beforeEach(async () => {
  t = await buildTestApp();
  dir = path.resolve(t.app.config.STORAGE_DIR, 'test-files');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'a.pdf'), FAKE_PDF);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await t.close();
});

async function attachment({
  brnch = 1,
  entity = 'DELIVERY_ORDER',
  storagePath = 'test-files/a.pdf',
} = {}) {
  return t.db.withTx(async (tx) => {
    const id = await tx.nextId('SEQ_ATTACHMENT');
    await tx.exec(
      `INSERT INTO ATTACHMENT (ATT_ID, BRNCH, ENTITY, ENTITY_KEY, FILE_NAME, MIME_TYPE, SIZE_BYTES, STORAGE_PATH, SHA256, UPLOADED_BY)
       VALUES (:id, :b, :e, 'TEST-1', 'do test.pdf', 'application/pdf', :sz, :p, 'x', 'test')`,
      { id, b: brnch, e: entity, sz: FAKE_PDF.length, p: storagePath },
    );
    return id;
  });
}

async function login(roles) {
  const u = await createUser(t.db, { roles });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password);
  return c;
}

describe('files (P0-15)', () => {
  it('streams the file to a user with the print permission and audits it', async () => {
    const id = await attachment();
    const c = await login({ 1: ['MARKETING'] }); // has do.print
    const res = await c.get(`/api/v1/files/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('do_test.pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const audit = await t.db.read((tx) =>
      tx.one(
        `SELECT COUNT(*) AS N FROM AUDIT_LOG WHERE ENTITY = 'DELIVERY_ORDER' AND ENTITY_KEY = 'TEST-1' AND ACTION = 'PRINT'`,
      ),
    );
    expect(audit.N).toBe(1);
  });

  it('refuses without the print permission (403) and hides other branches (404)', async () => {
    const id = await attachment();
    const gate = await login({ 1: ['WEIGH_OPERATOR'] });
    expect((await gate.get(`/api/v1/files/${id}`)).statusCode).toBe(403);
    const other = await attachment({ brnch: 2 });
    const mkt = await login({ 1: ['MARKETING'] });
    expect((await mkt.get(`/api/v1/files/${other}`)).statusCode).toBe(404);
  });

  it('never serves paths outside the storage folder', async () => {
    const id = await attachment({ storagePath: '../../package.json' });
    const c = await login({ 1: ['MARKETING'] });
    expect((await c.get(`/api/v1/files/${id}`)).statusCode).toBe(404);
  });

  it('pdf-test queues a PDF_RENDER job in the outbox', async () => {
    const c = await login({ 1: ['SYS_ADMIN'] });
    const res = await c.post('/api/v1/admin/pdf-test');
    expect(res.statusCode).toBe(202);
    const row = await t.db.read((tx) =>
      tx.one('SELECT EVENT_TYPE, CHANNEL, STATUS FROM NOTIFICATION_OUTBOX WHERE OUTBOX_ID = :id', {
        id: res.json().outboxId,
      }),
    );
    expect(row).toEqual({ EVENT_TYPE: 'PDF_RENDER', CHANNEL: 'JOB', STATUS: 'PENDING' });
  });
});
