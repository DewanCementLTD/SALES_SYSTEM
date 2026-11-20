// /api/v1/customers (API_SPEC §5, TASKS P1-03).
import {
  CUSTOMER_FIELDS,
  CUSTOMER_STATUS,
  P,
  zBrnch,
  zCreditLimitRequest,
  zCustomerCreate,
  zCustomerPatch,
  zPageQuery,
  zReason,
} from '@dcl/shared';
import { z } from 'zod';
import { resolveListBranches } from '../../lib/branch-scope.js';
import { Errors } from '../../lib/errors.js';
import { etag, ifMatch } from '../../lib/http.js';
import { userRoles } from '../rbac/repo.js';
import * as credit from './credit.js';
import * as lines from './lines.js';
import * as repo from './repo.js';
import * as svc from './service.js';

const zCode = z
  .string()
  .trim()
  .min(1)
  .max(11)
  .regex(/^[A-Za-z0-9-]+$/, 'Not a customer code');
const zParams = z.object({ brnch: zBrnch, code: zCode });
const zFieldValue = z.union([z.string(), z.number(), z.boolean(), z.date(), z.null()]);
const zCustomer = z
  .object({
    brnch: z.number(),
    customerCode: z.string(),
    status: z.string(),
    active: z.boolean(),
    geoCode: z.string().nullable(),
    geoSource: z.string().nullable(),
    geoPath: z.array(z.string().nullable()),
    channelName: z.string().nullable(),
    zoneCode: z.string().nullable(),
    zoneName: z.string().nullable(),
    rowVer: z.number(),
    createdBy: z.string().nullable(),
    createdOn: z.date().nullable(),
    updatedBy: z.string().nullable(),
    updatedOn: z.date().nullable(),
    approvedBy: z.string().nullable(),
    approvedOn: z.date().nullable(),
  })
  .extend(Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.name, zFieldValue])));
const zPending = z
  .object({
    requestId: z.number(),
    action: z.string(),
    requestedBy: z.string(),
    requestedOn: z.date(),
  })
  .nullable();
const zDecision = z.object({ comment: z.string().trim().max(1000).optional() }).optional();
const zBlockBody = z.object({ reason: zReason, stopDispatch: z.boolean().default(false) });

/** @param {import('fastify').FastifyInstance} app */
export default async function customerRoutes(app) {
  const tags = ['customers'];
  const actor = (request) => ({
    userId: request.session.userId,
    usrid: request.session.usrid,
    audit: request.ctx(),
    now: app.clock.now(),
  });
  /** Context for the approval engine (roles per branch for the level check). */
  const decideCtx = (request, tx) => ({
    ...request.ctx(),
    now: app.clock.now(),
    rolesIn: async (brnch) =>
      (await userRoles(tx, request.session.userId))
        .filter((r) => r.brnch === brnch)
        .map((r) => r.roleCode),
  });
  const withEtag = (reply, c) => {
    reply.header('etag', etag(c.rowVer));
    return c;
  };

  app.get(
    '/customers',
    {
      config: { permission: P.customer.view },
      schema: {
        tags,
        summary: 'Customers of my branches (search by name, code, mobile, NTN)',
        querystring: zPageQuery.extend({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          channel: z.string().max(3).optional(),
          status: z.enum(/** @type {[string, ...string[]]} */ (CUSTOMER_STATUS)).optional(),
          geoCode: z.string().max(50).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(zCustomer),
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
          allowedBranches: await request.authz.branchesWith(P.customer.view),
        },
        brnch,
      );
      return app.db.read(
        (tx) => repo.listCustomers(tx, { branches, ...rest }),
        request.txOpts('customers.list'),
      );
    },
  );

  app.get(
    '/customers/code-preview',
    {
      config: { permission: P.customer.create },
      schema: {
        tags,
        summary: 'Code the next customer in this area/city would get (BR-CUS-03; nothing reserved)',
        querystring: z.object({
          geoCode: z.string().max(50),
          brnch: z.coerce.number().int().optional(),
        }),
        response: { 200: z.object({ code: z.string() }) },
      },
    },
    async (request) =>
      app.db.read(
        (tx) =>
          svc.previewCode(tx, request.query.brnch ?? request.session.brnch, request.query.geoCode),
        request.txOpts('customers.preview'),
      ),
  );

  app.get(
    '/customers/:brnch/:code',
    {
      config: { permission: P.customer.view },
      schema: {
        tags,
        summary: 'Customer with all tab fields, pending approval and blocks (ETag)',
        params: zParams,
        response: {
          200: zCustomer.extend({
            pendingApproval: zPending,
            blocks: z.object({
              history: z.array(
                z.object({
                  blockId: z.number(),
                  action: z.string(),
                  stopDispatch: z.boolean(),
                  reason: z.string(),
                  by: z.string(),
                  on: z.date(),
                }),
              ),
              legacyGroups: z.array(
                z.object({
                  group: z.string().nullable(),
                  name: z.string().nullable(),
                  remarks: z.string().nullable(),
                }),
              ),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { brnch, code } = request.params;
      const out = await app.db.read(async (tx) => {
        const c = await repo.getCustomer(tx, brnch, code);
        if (!c) throw Errors.notFound('Customer');
        return {
          ...c,
          pendingApproval: await repo.pendingRequest(tx, brnch, code),
          blocks: await repo.blocks(tx, brnch, code),
        };
      }, request.txOpts('customers.get'));
      return withEtag(reply, out);
    },
  );

  const zResult = z.object({
    customer: zCustomer,
    requestId: z.number().nullable(),
    pendingFields: z.array(z.string()).optional(),
  });

  app.post(
    '/customers',
    {
      config: { permission: P.customer.create },
      schema: {
        tags,
        summary: 'Create a customer: code generated (BR-CUS-03), status PENDING_APPROVAL',
        body: zCustomerCreate.extend({ brnch: zBrnch.optional() }),
        response: { 201: zResult },
      },
    },
    async (request, reply) => {
      const { brnch = request.session.brnch, ...body } = request.body;
      const res = await app.db.withTx(
        (tx) => svc.createCustomer(tx, actor(request), brnch, body),
        request.txOpts('customers.create'),
      );
      reply.header('etag', etag(res.customer.rowVer));
      return reply.status(201).send(res);
    },
  );

  app.put(
    '/customers/:brnch/:code',
    {
      config: { permission: P.customer.update },
      schema: {
        tags,
        summary:
          'Change fields (only those sent). Approved customer: tax/contact changes become a change request (202)',
        params: zParams,
        body: zCustomerPatch,
        response: { 200: zResult, 202: zResult },
      },
    },
    async (request, reply) => {
      const { brnch, code } = request.params;
      const ver = ifMatch(request);
      const res = await app.db.withTx(
        (tx) => svc.updateCustomer(tx, actor(request), brnch, code, ver, request.body),
        request.txOpts('customers.update'),
      );
      reply.header('etag', etag(res.customer.rowVer));
      return reply.status(res.requestId ? 202 : 200).send(res);
    },
  );

  for (const [cmd, decision] of [
    ['approve', 'APPROVED'],
    ['reject', 'REJECTED'],
  ]) {
    app.post(
      `/customers/:brnch/:code/${cmd}`,
      {
        config: { permission: P.customer.approve },
        schema: {
          tags,
          summary: `${cmd === 'approve' ? 'Approve' : 'Reject'} the new customer or pending change (maker ≠ checker)`,
          params: zParams,
          body: zDecision,
          response: { 200: z.object({ customer: zCustomer, request: z.unknown().nullable() }) },
        },
      },
      async (request) => {
        const { brnch, code } = request.params;
        return app.db.withTx(
          async (tx) =>
            svc.decideCustomer(
              tx,
              decideCtx(request, tx),
              brnch,
              code,
              decision,
              request.body?.comment ?? null,
            ),
          request.txOpts(`customers.${cmd}`),
        );
      },
    );
  }

  app.post(
    '/customers/:brnch/:code/submit',
    {
      config: { permission: P.customer.update },
      schema: {
        tags,
        summary: 'Send a draft (rejected) customer for approval again (If-Match)',
        params: zParams,
        response: { 200: zResult },
      },
    },
    async (request, reply) => {
      const { brnch, code } = request.params;
      const ver = ifMatch(request);
      const res = await app.db.withTx(
        (tx) => svc.submitCustomer(tx, actor(request), brnch, code, ver),
        request.txOpts('customers.submit'),
      );
      reply.header('etag', etag(res.customer.rowVer));
      return res;
    },
  );

  for (const [cmd, block] of [
    ['block', true],
    ['unblock', false],
  ]) {
    app.post(
      `/customers/:brnch/:code/${cmd}`,
      {
        config: { permission: P.customer.block },
        schema: {
          tags,
          summary: `${block ? 'Block' : 'Unblock'} a customer with a reason (BR-CUS-08, If-Match)`,
          params: zParams,
          body: block ? zBlockBody : zBlockBody.pick({ reason: true }),
          response: { 200: zCustomer },
        },
      },
      async (request, reply) => {
        const { brnch, code } = request.params;
        const ver = ifMatch(request);
        const c = await app.db.withTx(
          (tx) =>
            svc.setBlocked(tx, actor(request), brnch, code, ver, block, {
              reason: request.body.reason,
              stopDispatch: request.body.stopDispatch ?? false,
            }),
          request.txOpts(`customers.${cmd}`),
        );
        return withEtag(reply, c);
      },
    );
  }

  // --- areas / security deposits / bank accounts (add + deactivate, never delete) ---
  const zKind = z.enum(/** @type {[string, ...string[]]} */ (lines.LINE_KINDS));
  const zLinesOut = z.object({
    items: z.array(z.record(z.string(), z.unknown())),
    securityTotal: z.string().optional(),
  });
  const linesOf = async (tx, kind, brnch, code) => {
    const items = await lines.listLines(tx, kind, brnch, code);
    return kind === 'security' ? { items, securityTotal: lines.securityTotal(items) } : { items };
  };

  app.get(
    '/customers/:brnch/:code/lines/:kind',
    {
      config: { permission: P.customer.view },
      schema: {
        tags,
        summary: 'Areas served, security deposits (with total, BR-CUS-06) or bank accounts',
        params: zParams.extend({ kind: zKind }),
        response: { 200: zLinesOut },
      },
    },
    async (request) => {
      const { brnch, code, kind } = request.params;
      return app.db.read(async (tx) => {
        if (!(await repo.getCustomer(tx, brnch, code))) throw Errors.notFound('Customer');
        return linesOf(tx, kind, brnch, code);
      }, request.txOpts('customers.lines'));
    },
  );

  app.post(
    '/customers/:brnch/:code/lines/:kind',
    {
      config: { permission: P.customer.update },
      schema: {
        tags,
        summary: 'Add an area ({ geoCode }), deposit ({ description, amount }) or bank account',
        params: zParams.extend({ kind: zKind }),
        body: z.object({}).catchall(z.unknown()),
        response: { 201: zLinesOut },
      },
    },
    async (request, reply) => {
      const { brnch, code, kind } = request.params;
      const parsed = lines.LINE_BODIES[kind].safeParse(request.body);
      if (!parsed.success) {
        throw Errors.validation(
          'Please correct the marked fields',
          parsed.error.issues.map((i) => ({
            path: ['body', ...i.path].join('.'),
            message: i.message,
          })),
        );
      }
      const out = await app.db.withTx(async (tx) => {
        await lines.addLine(tx, actor(request), kind, brnch, code, parsed.data);
        return linesOf(tx, kind, brnch, code);
      }, request.txOpts('customers.line.add'));
      return reply.status(201).send(out);
    },
  );

  for (const [cmd, active] of [
    ['deactivate', false],
    ['activate', true],
  ]) {
    app.post(
      `/customers/:brnch/:code/lines/:kind/:key/${cmd}`,
      {
        config: { permission: P.customer.update },
        schema: {
          tags,
          summary: `${cmd === 'activate' ? 'Activate' : 'Deactivate'} a line (never deleted)`,
          params: zParams.extend({ kind: zKind, key: z.string().min(1).max(40) }),
          response: { 200: zLinesOut },
        },
      },
      async (request) => {
        const { brnch, code, kind, key } = request.params;
        return app.db.withTx(
          async (tx) => {
            await lines.setLineActive(tx, actor(request), kind, brnch, code, key, active);
            return linesOf(tx, kind, brnch, code);
          },
          request.txOpts(`customers.line.${cmd}`),
        );
      },
    );
  }

  // --- credit limits (BR-CUS-07, P1-04) ---
  const zMoneyN = z.string().nullable();
  const zDoc = z.object({
    brnch: z.number(),
    serno: z.number(),
    customerCode: z.string(),
    customerName: z.string().nullable(),
    date: z.date().nullable(),
    creditType: z.string().nullable(),
    lastApproved: zMoneyN,
    amount: zMoneyN,
    ocBalance: zMoneyN,
    remark: z.string().nullable(),
    status: z.string(),
    createdBy: z.string().nullable(),
    rowVer: z.number(),
  });

  app.get(
    '/customers/:brnch/:code/credit-limits',
    {
      config: { permission: P.customer.view },
      schema: {
        tags,
        summary:
          'Initial / current / availed / unused per credit type A–J, and Credit Limit documents',
        params: zParams,
        response: {
          200: z.object({
            hasCreditLimitsRow: z.boolean(),
            legacyCreditLimit: zMoneyN,
            totalCurrent: z.string(),
            types: z.array(
              z.object({
                creditType: z.string(),
                description: z.string(),
                initial: zMoneyN,
                current: zMoneyN,
                availed: zMoneyN,
                unused: z.string(),
              }),
            ),
            documents: z.array(zDoc),
          }),
        },
      },
    },
    async (request) =>
      app.db.read(
        (tx) => credit.creditOverview(tx, request.params.brnch, request.params.code),
        request.txOpts('credit.overview'),
      ),
  );

  app.post(
    '/customers/:brnch/:code/credit-limits',
    {
      config: { permission: P.customer.credit_limit },
      schema: {
        tags,
        summary: 'New Credit Limit document (number CLM) → approval CREDIT_LIMIT (BR-CUS-07)',
        params: zParams,
        body: zCreditLimitRequest,
        response: { 201: z.object({ document: zDoc, requestId: z.number().nullable() }) },
      },
    },
    async (request, reply) => {
      const { brnch, code } = request.params;
      const res = await app.db.withTx(
        (tx) =>
          credit.requestCreditLimit(
            tx,
            { ...actor(request), fiscalYear: request.session.fiscalYear },
            brnch,
            code,
            request.body,
          ),
        request.txOpts('credit.request'),
      );
      return reply.status(201).send(res);
    },
  );

  app.get(
    '/credit-limits',
    {
      config: { permission: P.customer.view },
      schema: {
        tags,
        summary: 'Credit Limit documents of my branches (newest 200)',
        querystring: z.object({
          brnch: z.union([z.literal('all'), z.coerce.number().int()]).optional(),
          status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
        }),
        response: { 200: z.object({ items: z.array(zDoc) }) },
      },
    },
    async (request) => {
      const branches = resolveListBranches(
        {
          brnch: request.session.brnch,
          allowedBranches: await request.authz.branchesWith(P.customer.view),
        },
        request.query.brnch,
      );
      return app.db.read(
        async (tx) => ({
          items: await credit.documents(tx, { branches, status: request.query.status }),
        }),
        request.txOpts('credit.list'),
      );
    },
  );

  for (const [cmd, decision] of [
    ['approve', 'APPROVED'],
    ['reject', 'REJECTED'],
  ]) {
    app.post(
      `/credit-limits/:brnch/:serno/${cmd}`,
      {
        config: { permission: P.customer.credit_limit_approve },
        schema: {
          tags,
          summary: `${cmd === 'approve' ? 'Approve' : 'Reject'} a Credit Limit document (maker ≠ checker)`,
          params: z.object({ brnch: zBrnch, serno: z.coerce.number().int().positive() }),
          body: zDecision,
          response: { 200: zDoc },
        },
      },
      async (request) =>
        app.db.withTx(
          async (tx) =>
            credit.decideCreditLimit(
              tx,
              decideCtx(request, tx),
              request.params.brnch,
              request.params.serno,
              decision,
              request.body?.comment ?? null,
            ),
          request.txOpts(`credit.${cmd}`),
        ),
    );
  }
}
