// Stored files (TASKS P0-15): GET /api/v1/files/:attId streams a PDF/attachment to a signed-in user
// who may see the document's branch and holds the print permission of its entity. Every download
// is audited (BR-AUD-01: print). Public 7-day share links come with P5-08.
// POST /api/v1/admin/pdf-test queues the sample print through the outbox → worker (self-test).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { P } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { enqueue } from '../outbox/service.js';

/** Permission needed to download a file, by owning entity. Extended by each document module. */
export const FILE_PERMISSION = {
  SAMPLE: P.admin.settings,
  DELIVERY_ORDER: P.do.print,
  PERMIT_MST_CITY: P.permit.print,
  SALES_REQUEST_MASTER: P.srf.print,
  ORDER_CONFIRM: P.oc.print,
  CASH_CHEQUE_RECEIPTS: P.brv.print,
  FH_DELIVERY_CHALLAN: P.dc.print,
  SALES_INVOICE: P.invoice.print,
  CREDIT_NOTE: P.note.print,
};

/** @param {import('fastify').FastifyInstance} app */
export default async function fileRoutes(app) {
  app.get(
    '/files/:attId',
    {
      schema: {
        tags: ['files'],
        summary: 'Download a stored file (PDF)',
        params: z.object({ attId: z.coerce.number().int().positive() }),
      },
    },
    async (request, reply) => {
      const att = await app.db.read(
        (tx) =>
          tx.one(
            'SELECT ATT_ID, BRNCH, ENTITY, ENTITY_KEY, FILE_NAME, MIME_TYPE, STORAGE_PATH FROM ATTACHMENT WHERE ATT_ID = :id',
            { id: request.params.attId },
          ),
        request.txOpts('files.get'),
      );
      if (!att || !(await request.authz.allowedBranches()).includes(att.BRNCH))
        throw Errors.notFound('File');
      const perm = FILE_PERMISSION[att.ENTITY];
      if (!perm || !(await request.authz.permissions(att.BRNCH)).has(perm)) {
        throw Errors.forbidden(`You need ${perm ?? 'a print permission'} to open this file`);
      }
      const root = path.resolve(app.config.STORAGE_DIR);
      const abs = path.resolve(root, att.STORAGE_PATH);
      if (!abs.startsWith(root + path.sep)) throw Errors.notFound('File'); // path traversal guard
      const info = await stat(abs).catch(() => null);
      if (!info) throw Errors.notFound('File');
      await app.db.withTx(
        (tx) =>
          recordAudit(tx, request.ctx(), {
            entity: att.ENTITY,
            key: att.ENTITY_KEY,
            action: 'PRINT',
            brnch: att.BRNCH,
            newValues: { attId: att.ATT_ID, fileName: att.FILE_NAME },
          }),
        request.txOpts('files.audit'),
      );
      reply
        .header('content-type', att.MIME_TYPE)
        .header('content-length', info.size)
        .header('cache-control', 'private, no-store')
        .header(
          'content-disposition',
          `inline; filename="${att.FILE_NAME.replace(/[^\w.-]/g, '_')}"`,
        );
      return reply.send(createReadStream(abs));
    },
  );

  app.post(
    '/admin/pdf-test',
    {
      config: { permission: P.admin.settings },
      schema: {
        tags: ['admin'],
        summary: 'Queue a sample PDF (checks outbox → worker → Chromium → storage)',
        response: { 202: z.object({ outboxId: z.number() }) },
      },
    },
    async (request, reply) => {
      const now = app.clock.now();
      const brnch = request.session.brnch;
      const res = await app.db.withTx(
        (tx) =>
          enqueue(tx, {
            brnch,
            eventType: 'PDF_RENDER',
            aggregateType: 'SAMPLE',
            aggregateKey: `sample-${now.getTime()}`,
            channel: 'JOB',
            dedupKey: `PDF_RENDER|SAMPLE|${now.getTime()}|${request.session.userId}`,
            payload: {
              template: 'sample',
              entity: 'SAMPLE',
              entityKey: `sample-${now.getTime()}`,
              fileName: 'dcl-sample.pdf',
              data: {
                brnch,
                docNo: '22746000013',
                customer: 'Layout check customer',
                lines: [
                  { item: 'Ordinary Portland Cement (OPC)', qty: '40.000', amount: '972,000.00' },
                ],
              },
            },
            now,
          }),
        request.txOpts('pdf-test'),
      );
      return reply.status(202).send({ outboxId: res.outboxId });
    },
  );
}
