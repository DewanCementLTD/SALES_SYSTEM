// PDF rendering (TASKS P0-15): HTML template → Chromium (Playwright) → A4 PDF → file + ATTACHMENT.
// Templates are self-contained: JavaScript is disabled and every network request is blocked.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderTemplate } from '@dcl/pdf-templates';
import { chromium } from 'playwright';

let browserPromise = null;

export function getBrowser() {
  browserPromise ??= chromium.launch({
    executablePath: process.env.PDF_CHROMIUM_PATH || undefined,
    args: ['--disable-gpu'],
  });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

/**
 * @param {{ html: string, footer?: string }} doc
 * @returns {Promise<Buffer>}
 */
export async function renderPdf({ html, footer }) {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: Boolean(footer),
      headerTemplate: '<span></span>',
      footerTemplate: footer ?? '<span></span>',
    });
  } finally {
    await context.close();
  }
}

/**
 * Save a PDF under STORAGE_DIR/pdf/YYYY/MM/<uuid>.pdf and record it in ATTACHMENT.
 * @param {import('@dcl/api/lib/oracle/db').Db} db
 */
export async function storePdf(
  db,
  { buffer, brnch, entity, entityKey, fileName, storageDir, by, now },
) {
  const rel = path.join(
    'pdf',
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    `${randomUUID()}.pdf`,
  );
  const abs = path.resolve(storageDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer, { flag: 'wx' });
  const sha = createHash('sha256').update(buffer).digest('hex');
  return db.withTx(
    async (tx) => {
      const id = await tx.nextId('SEQ_ATTACHMENT');
      await tx.exec(
        `INSERT INTO ATTACHMENT (ATT_ID, BRNCH, ENTITY, ENTITY_KEY, FILE_NAME, MIME_TYPE, SIZE_BYTES, STORAGE_PATH, SHA256, UPLOADED_BY, UPLOADED_ON)
         VALUES (:id, :b, :e, :k, :f, 'application/pdf', :sz, :p, :sha, :ub, :now)`,
        {
          id,
          b: brnch,
          e: entity,
          k: String(entityKey),
          f: fileName,
          sz: buffer.length,
          p: rel.replace(/\\/g, '/'),
          sha,
          ub: by, // :by is reserved in Oracle (ORA-01745)
          now,
        },
      );
      return id;
    },
    { usrid: by, action: 'pdf.store' },
  );
}

/**
 * BullMQ processor for the `pdf` queue. Outbox payload: { template, data, entity, entityKey, fileName }.
 */
export function createPdfProcessor({ db, storageDir, qrSecret, clock, log }) {
  return async (job) => {
    const { payload, brnch, outboxId } = job.data;
    const now = clock.now();
    const doc = await renderTemplate(payload.template, payload.data, { runAt: now, qrSecret });
    const buffer = await renderPdf(doc);
    const attId = await storePdf(db, {
      buffer,
      brnch,
      entity: payload.entity,
      entityKey: payload.entityKey,
      fileName: payload.fileName ?? `${payload.template}-${payload.entityKey}.pdf`,
      storageDir,
      by: 'worker',
      now,
    });
    log.info({ outboxId, attId, bytes: buffer.length }, 'pdf rendered');
    return { attId };
  };
}
