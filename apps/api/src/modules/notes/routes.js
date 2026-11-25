// /api/v1/notes (API_SPEC §14, TASKS P4-01): credit / debit notes. Approve / reject go through
// the approvals inbox (`/approvals/{reqId}/approve|reject`, rule NOTE_POST).
import { P, zBrnch, zIsoDate, zNoteCreate, zPageQuery, zReason } from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { etag, ifMatch } from '../../lib/http.js';
import * as svc from './service.js';

const tags = ['notes'];
const zN = z.string().nullable();
const zParams = z.object({
  brnch: zBrnch,
  kind: z.enum(['C', 'D']),
  srlNo: z.string().regex(/^\d{1,8}$/, 'Not a note number'),
});
const zNoteRow = z.object({
  brnch: z.number(),
  kind: z.enum(['C', 'D']),
  srlNo: z.string(),
  noteType: z.string(),
  typeName: zN,
  date: z.string(),
  customerCode: z.string(),
  customerName: zN,
  remarks: zN,
  gross: z.string(),
  wht: z.string(),
  net: z.string(),
  status: z.string(),
  rowVer: z.number(),
  createdBy: zN,
  createdOn: z.date().nullable(),
  postedBy: zN,
  postedOn: z.date().nullable(),
  requestId: z.number().nullable(),
  reversalOf: zN,
  reversedBy: zN,
  invoiceId: z.number().nullable(),
  invoiceNo: zN,
  cancelReason: zN,
  transferCustomer: zN,
  sourceRun: zN,
});
const zNote = zNoteRow.extend({
  lines: z.array(
    z.object({ srNo: z.number(), particular: z.string(), amount: z.string(), whtPct: zN }),
  ),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function noteRoutes(app) {
  const actor = (request) => ({
    usrid: request.session.usrid,
    now: app.clock.now(),
    audit: request.ctx(),
  });

  app.get(
    '/notes/types',
    {
      config: { permission: P.note.view },
      schema: {
        tags,
        summary: 'Note types of my branch (CREDIT_NOTE_TYPE; salesReturn = needs an invoice)',
        response: {
          200: z.object({
            items: z.array(
              z.object({ code: z.string(), name: z.string(), salesReturn: z.boolean() }),
            ),
          }),
        },
      },
    },
    async (request) => ({
      items: await app.db.read(
        (tx) => svc.noteTypes(tx, request.session.brnch),
        request.txOpts('notes.types'),
      ),
    }),
  );

  app.get(
    '/notes',
    {
      config: { permission: P.note.view },
      schema: {
        tags,
        summary: 'Credit and debit notes of my branches, newest first',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          kind: z.enum(['C', 'D']).optional(),
          type: z
            .string()
            .regex(/^\d{3}$/)
            .optional(),
          customer: z.string().max(11).optional(),
          status: z
            .enum(['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'CANCELLED'])
            .optional(),
          from: zIsoDate.optional(),
          to: zIsoDate.optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zNoteRow),
            page: z.number(),
            pageSize: z.number(),
            total: z.number(),
          }),
        },
      },
    },
    async (request) => {
      const { brnch, ...rest } = request.query;
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.note.view),
        },
        brnch,
      );
      return app.db.read(
        (tx) => svc.listNotes(tx, { branches, ...rest }),
        request.txOpts('notes.list'),
      );
    },
  );

  app.get(
    '/notes/:brnch/:kind/:srlNo',
    {
      config: { permission: P.note.view },
      schema: {
        tags,
        summary: 'One note with its lines',
        params: zParams,
        response: { 200: zNote },
      },
    },
    async (request, reply) => {
      const { brnch, kind, srlNo } = request.params;
      const n = await app.db.read(
        (tx) => svc.getNote(tx, brnch, kind, srlNo),
        request.txOpts('notes.get'),
      );
      reply.header('etag', etag(n.rowVer));
      return n;
    },
  );

  app.post(
    '/notes',
    {
      config: { permission: P.note.create },
      schema: {
        tags,
        summary:
          'New DRAFT credit (C) or debit (D) note of my branch; number from the CN / DN counter (BR-NOTE-01/02)',
        body: zNoteCreate,
        response: { 201: zNote },
      },
    },
    async (request, reply) => {
      const n = await app.db.withTx(
        (tx) => svc.createNote(tx, actor(request), request.session.brnch, request.body),
        request.txOpts('notes.create'),
      );
      reply.header('etag', etag(n.rowVer));
      return reply.status(201).send(n);
    },
  );

  const command = (path, perm, body, summary, fn, response) =>
    app.post(
      `/notes/:brnch/:kind/:srlNo/${path}`,
      {
        config: { permission: perm },
        schema: { tags, summary, params: zParams, body, response: { 200: response } },
      },
      async (request) => {
        const { brnch, kind, srlNo } = request.params;
        return app.db.withTx(
          async (tx) => fn(tx, actor(request), brnch, kind, srlNo, request),
          request.txOpts(`notes.${path}`),
        );
      },
    );

  command(
    'submit',
    P.note.create,
    z.object({}).optional(),
    'Submit a draft (If-Match): NOTE_POST approval; with no rule it posts at once (needs note.post). Posting: Cr/Dr net in the DO and DC ledger (BR-NOTE-03)',
    async (tx, a, b, k, n, r) =>
      svc.submitNote(tx, a, b, k, n, ifMatch(r), {
        canPost: (await r.authz.permissions(b)).has(P.note.post),
      }),
    z.object({ note: zNote, requestId: z.number().nullable() }),
  );
  command(
    'cancel',
    P.note.create,
    z.object({ reason: zReason }),
    'Cancel a draft or a note waiting for approval (If-Match; the number stays used)',
    (tx, a, b, k, n, r) => svc.cancelNote(tx, a, b, k, n, ifMatch(r), r.body.reason),
    zNote,
  );
  command(
    'reverse',
    P.note.reverse,
    z.object({ reason: zReason }),
    'Reverse a posted note (If-Match, BR-NOTE-05): a note of the other kind, posted at once; the original becomes REVERSED',
    (tx, a, b, k, n, r) => svc.reverseNote(tx, a, b, k, n, ifMatch(r), r.body.reason),
    z.object({ note: zNote, reversal: zNote }),
  );
}
