// /api/v1/approvals (API_SPEC §15) and /api/v1/admin/approval-rules (API_SPEC §3).
import { APPROVAL_DOC_TYPES, P, ROLE_CODES } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { userRoles } from '../rbac/repo.js';
import * as svc from './service.js';

const zReq = z.object({
  reqId: z.number(),
  brnch: z.number(),
  ruleId: z.number(),
  docType: z.string(),
  docKey: z.string(),
  action: z.string(),
  snapshot: z.unknown(),
  amount: z.string().nullable(),
  qty: z.string().nullable(),
  reason: z.string(),
  status: z.string(),
  currentLevel: z.number(),
  levels: z.number(),
  levelRoles: z.array(z.string()),
  requestedBy: z.string(),
  requestedOn: z.date(),
  decidedOn: z.date().nullable(),
  expiresOn: z.date().nullable(),
  rowVer: z.number(),
  sameUserAllowed: z.boolean(),
});
const zHistory = z.array(
  z.object({
    level: z.number(),
    decision: z.string(),
    decidedBy: z.string(),
    decidedOn: z.date(),
    comments: z.string().nullable(),
  }),
);
const zReqId = z.object({ reqId: z.coerce.number().int().positive() });
const zDecision = z.object({ reqId: z.number(), status: z.string(), currentLevel: z.number() });

const zRule = z.object({
  ruleId: z.number(),
  brnch: z.number(),
  docType: z.string(),
  name: z.string(),
  minAmount: z.string().nullable(),
  minQty: z.string().nullable(),
  conditionCode: z.string().nullable(),
  levels: z.number(),
  levelRoles: z.array(z.string()),
  sameUserAllowed: z.boolean(),
  expireHours: z.number().nullable(),
  priority: z.number(),
  active: z.boolean(),
});
const zRuleBody = z
  .object({
    brnch: z.coerce
      .number()
      .int()
      .refine((b) => [0, 1, 2].includes(b)),
    docType: z.enum(APPROVAL_DOC_TYPES),
    name: z.string().trim().min(3).max(100),
    minAmount: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,2})?$/)
      .nullable()
      .default(null),
    minQty: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,3})?$/)
      .nullable()
      .default(null),
    conditionCode: z.string().max(30).nullable().default(null),
    levelRoles: z.array(z.enum(ROLE_CODES)).min(1).max(3),
    sameUserAllowed: z.boolean().default(false),
    expireHours: z.number().int().min(1).max(10000).nullable().default(null),
    priority: z.number().int().min(1).max(999).default(100),
    active: z.boolean().default(true),
  })
  .refine(
    (b) => new Set(b.levelRoles).size === b.levelRoles.length,
    'Use a different role per level',
  );

/** @param {import('fastify').FastifyInstance} app */
export default async function approvalRoutes(app) {
  const tags = ['approvals'];

  async function rolesByBranch(request, tx) {
    const all = await userRoles(tx, request.session.userId);
    const branches = await request.authz.allowedBranches();
    return branches.map((b) => ({
      brnch: b,
      roles: all.filter((r) => r.brnch === b).map((r) => r.roleCode),
    }));
  }

  function ctxOf(request, tx) {
    return {
      ...request.ctx(),
      now: app.clock.now(),
      rolesIn: async (brnch) =>
        (await rolesByBranch(request, tx)).find((x) => x.brnch === brnch)?.roles ?? [],
    };
  }

  app.get(
    '/approvals/inbox',
    {
      config: { permission: P.approval.inbox },
      schema: {
        tags,
        summary: 'Requests waiting for my roles',
        querystring: z.object({
          status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
        }),
        response: { 200: z.array(zReq) },
      },
    },
    async (request) =>
      app.db.read(
        async (tx) => svc.inbox(tx, await rolesByBranch(request, tx), request.query),
        request.txOpts('approvals.inbox'),
      ),
  );

  app.get(
    '/approvals/sent',
    { schema: { tags, summary: 'Requests I made', response: { 200: z.array(zReq) } } },
    async (request) =>
      app.db.read((tx) => svc.sentBy(tx, request.session.usrid), request.txOpts('approvals.sent')),
  );

  app.get(
    '/approvals/:reqId',
    {
      schema: {
        tags,
        summary: 'Request with snapshot and history',
        params: zReqId,
        response: { 200: zReq.extend({ history: zHistory }) },
      },
    },
    async (request) =>
      app.db.read(async (tx) => {
        const req = await svc.loadRequest(tx, request.params.reqId);
        if (!req || !(await request.authz.allowedBranches()).includes(req.brnch))
          throw Errors.notFound('Approval request');
        const hist = await svc.history(tx, req.reqId);
        const roles =
          (await rolesByBranch(request, tx)).find((x) => x.brnch === req.brnch)?.roles ?? [];
        const involved =
          req.requestedBy === request.session.usrid ||
          hist.some((h) => h.decidedBy === request.session.usrid) ||
          req.levelRoles.some((r) => roles.includes(r));
        if (!involved && !(await request.authz.permissions(req.brnch)).has(P.audit.view))
          throw Errors.notFound('Approval request');
        return { ...req, history: hist };
      }, request.txOpts('approvals.get')),
  );

  for (const [path, decision] of [
    ['approve', 'APPROVED'],
    ['reject', 'REJECTED'],
  ]) {
    app.post(
      `/approvals/:reqId/${path}`,
      {
        config: { permission: P.approval.inbox },
        schema: {
          tags,
          summary: `${decision === 'APPROVED' ? 'Approve' : 'Reject'} the current level`,
          params: zReqId,
          body: z
            .object({
              comment:
                decision === 'REJECTED'
                  ? z.string().trim().min(3).max(1000)
                  : z.string().trim().max(1000).optional(),
            })
            .default({}),
          response: { 200: zDecision },
        },
      },
      async (request) => {
        const res = await app.db.withTx(
          async (tx) =>
            svc.decide(tx, ctxOf(request, tx), {
              reqId: request.params.reqId,
              decision,
              comment: request.body?.comment ?? null,
            }),
          request.txOpts(`approvals.${path}`),
        );
        for (const userId of res.notifiedUserIds)
          app.sse.publish('notifications', { userId }, { kind: 'approval', reqId: res.reqId });
        app.sse.publish('approvals', {}, { reqId: res.reqId, status: res.status });
        return { reqId: res.reqId, status: res.status, currentLevel: res.currentLevel };
      },
    );
  }

  app.post(
    '/approvals/:reqId/cancel',
    {
      schema: {
        tags,
        summary: 'Withdraw my pending request',
        params: zReqId,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await app.db.withTx(
        (tx) => svc.cancelRequest(tx, ctxOf(request, tx), request.params.reqId),
        request.txOpts('approvals.cancel'),
      );
      return { ok: true };
    },
  );

  // ---- rules admin ----
  const ruleTags = ['admin'];
  const loadRules = (tx) =>
    tx
      .many(`SELECT ${svc.RULE_COLS} FROM APPROVAL_RULE ORDER BY DOC_TYPE, PRIORITY, RULE_ID`)
      .then((r) => r.map(svc.toRule));

  app.get(
    '/admin/approval-rules',
    {
      config: { permission: P.admin.approval_rules },
      schema: { tags: ruleTags, summary: 'Approval rules', response: { 200: z.array(zRule) } },
    },
    async (request) => app.db.read(loadRules, request.txOpts('rules.list')),
  );

  async function saveRule(request, tx, ruleId) {
    const b = request.body;
    const binds = {
      b: b.brnch,
      d: b.docType,
      n: b.name,
      minA: b.minAmount,
      minQ: b.minQty,
      cc: b.conditionCode,
      lv: b.levelRoles.length,
      r1: b.levelRoles[0],
      r2: b.levelRoles[1] ?? null,
      r3: b.levelRoles[2] ?? null,
      su: b.sameUserAllowed ? 'Y' : 'N',
      eh: b.expireHours,
      pr: b.priority,
      ac: b.active ? 'Y' : 'N',
    };
    if (ruleId) {
      const before = (await loadRules(tx)).find((r) => r.ruleId === ruleId);
      if (!before) throw Errors.notFound('Approval rule');
      await tx.exec(
        `UPDATE APPROVAL_RULE SET BRNCH = :b, DOC_TYPE = :d, RULE_NAME = :n, MIN_AMOUNT = :minA, MIN_QTY = :minQ,
           CONDITION_CODE = :cc, LEVELS = :lv, LEVEL1_ROLE = :r1, LEVEL2_ROLE = :r2, LEVEL3_ROLE = :r3,
           SAME_USER_ALLOWED = :su, EXPIRE_HOURS = :eh, PRIORITY = :pr, ACTIVE = :ac WHERE RULE_ID = :id`,
        { ...binds, id: ruleId },
      );
      await recordAudit(tx, request.ctx(), {
        entity: 'APPROVAL_RULE',
        key: ruleId,
        action: 'UPDATE',
        oldValues: before,
        newValues: b,
      });
      return ruleId;
    }
    const id = await tx.nextId('SEQ_APPROVAL_RULE');
    await tx.exec(
      `INSERT INTO APPROVAL_RULE (RULE_ID, BRNCH, DOC_TYPE, RULE_NAME, MIN_AMOUNT, MIN_QTY, CONDITION_CODE, LEVELS,
         LEVEL1_ROLE, LEVEL2_ROLE, LEVEL3_ROLE, SAME_USER_ALLOWED, EXPIRE_HOURS, PRIORITY, ACTIVE)
       VALUES (:id, :b, :d, :n, :minA, :minQ, :cc, :lv, :r1, :r2, :r3, :su, :eh, :pr, :ac)`,
      { ...binds, id },
    );
    await recordAudit(tx, request.ctx(), {
      entity: 'APPROVAL_RULE',
      key: id,
      action: 'CREATE',
      newValues: b,
    });
    return id;
  }

  app.post(
    '/admin/approval-rules',
    {
      config: { permission: P.admin.approval_rules },
      schema: {
        tags: ruleTags,
        summary: 'Create a rule',
        body: zRuleBody,
        response: { 201: zRule },
      },
    },
    async (request, reply) => {
      const rule = await app.db.withTx(async (tx) => {
        const id = await saveRule(request, tx, null);
        return (await loadRules(tx)).find((r) => r.ruleId === id);
      }, request.txOpts('rules.create'));
      return reply.status(201).send(rule);
    },
  );

  app.put(
    '/admin/approval-rules/:ruleId',
    {
      config: { permission: P.admin.approval_rules },
      schema: {
        tags: ruleTags,
        summary: 'Update a rule',
        params: z.object({ ruleId: z.coerce.number().int() }),
        body: zRuleBody,
        response: { 200: zRule },
      },
    },
    async (request) =>
      app.db.withTx(async (tx) => {
        await saveRule(request, tx, request.params.ruleId);
        return (await loadRules(tx)).find((r) => r.ruleId === request.params.ruleId);
      }, request.txOpts('rules.update')),
  );
}
