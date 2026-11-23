// Admin texts (TASKS P0-16 remainder, P2-09): message templates (MSG_TEMPLATE, per event/channel;
// its PK is (TEMPLATE_CODE, CHANNEL), so a branch variant is stored as '<CODE>@<brnch>') and print texts (PRINT_TEXT: clause texts of prints, e.g.
// CRF_*, DO_TERMS, PERMIT_TERMS; BRNCH 0 = company). Upsert only; a text is switched off with
// active = false, never deleted. `scope` = 0 (company) or a branch.
import { P } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';

const zScope = z
  .number()
  .int()
  .refine((b) => [0, 1, 2].includes(b), 'Scope is 0 (company), 1 or 2');
const zTemplate = z.object({
  templateCode: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  channel: z.enum(['SMS', 'WA', 'EMAIL']),
  scope: zScope,
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().min(1).max(4000),
  active: z.boolean().default(true),
});
const zPrintText = z.object({
  textCode: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  srNo: z.number().int().min(1).max(999),
  scope: zScope,
  body: z.string().min(1).max(4000),
  active: z.boolean().default(true),
});

/** @param {import('fastify').FastifyInstance} app */
export default async function textRoutes(app) {
  const tags = ['admin'];
  const scopeAllowed = async (request, scope, perm) => {
    const branches = scope === 0 ? await request.authz.branchesWith(perm) : [scope];
    for (const b of branches) {
      if (!(await request.authz.permissions(b)).has(perm))
        throw Errors.forbidden(`You need ${perm}`);
    }
    // company-level rows only for administrators of every branch they can see
    if (scope === 0 && !branches.length) throw Errors.forbidden(`You need ${perm}`);
  };

  app.get(
    '/admin/templates',
    {
      config: { permission: P.admin.templates },
      schema: { tags, summary: 'Message templates (all scopes)' },
    },
    async (request) => {
      const rows = await app.db.read(
        (tx) =>
          tx.many(
            `SELECT TEMPLATE_CODE, CHANNEL, SUBJECT, BODY, ACTIVE FROM MSG_TEMPLATE
              ORDER BY TEMPLATE_CODE, CHANNEL`,
          ),
        request.txOpts('texts.templates'),
      );
      return {
        items: rows.map((r) => ({
          templateCode: r.TEMPLATE_CODE.split('@')[0],
          channel: r.CHANNEL,
          scope: Number(r.TEMPLATE_CODE.split('@')[1] ?? 0),
          subject: r.SUBJECT ?? null,
          body: r.BODY,
          active: r.ACTIVE !== 'N',
        })),
      };
    },
  );

  app.put(
    '/admin/templates',
    {
      config: { permission: P.admin.templates },
      schema: {
        tags,
        summary: 'Create or change a message template (placeholders in {BRACES})',
        body: zTemplate,
      },
    },
    async (request) => {
      const b = request.body;
      await scopeAllowed(request, b.scope, P.admin.templates);
      await app.db.withTx(async (tx) => {
        const code = b.scope ? `${b.templateCode}@${b.scope}` : b.templateCode;
        const binds = {
          c: code,
          ch: b.channel,
          sub: b.subject ?? null,
          body: b.body,
          a: b.active ? 'Y' : 'N',
        };
        const n = await tx.exec(
          `UPDATE MSG_TEMPLATE SET SUBJECT = :sub, BODY = :body, ACTIVE = :a
            WHERE TEMPLATE_CODE = :c AND CHANNEL = :ch`,
          binds,
        );
        if (n === 0) {
          await tx.exec(
            `INSERT INTO MSG_TEMPLATE (TEMPLATE_CODE, CHANNEL, SUBJECT, BODY, ACTIVE, BRNCH, COMPC)
             VALUES (:c, :ch, :sub, :body, :a, :s, 1)`,
            { ...binds, s: b.scope || null },
          );
        }
        await recordAudit(tx, request.ctx(), {
          entity: 'MSG_TEMPLATE',
          key: `${b.templateCode}|${b.channel}|${b.scope}`,
          action: n === 0 ? 'CREATE' : 'UPDATE',
          brnch: b.scope || null,
          newValues: b,
        });
      }, request.txOpts('texts.template.save'));
      return { ok: true };
    },
  );

  app.get(
    '/admin/print-texts',
    {
      config: { permission: P.admin.print_texts },
      schema: { tags, summary: 'Print texts (clauses, terms)' },
    },
    async (request) => {
      const rows = await app.db.read(
        (tx) =>
          tx.many(
            'SELECT BRNCH, TEXT_CODE, SR_NO, TEXT_BODY, ACTIVE FROM PRINT_TEXT ORDER BY TEXT_CODE, BRNCH, SR_NO',
          ),
        request.txOpts('texts.print'),
      );
      return {
        items: rows.map((r) => ({
          textCode: r.TEXT_CODE,
          scope: Number(r.BRNCH),
          srNo: Number(r.SR_NO),
          body: r.TEXT_BODY,
          active: r.ACTIVE !== 'N',
        })),
      };
    },
  );

  app.put(
    '/admin/print-texts',
    {
      config: { permission: P.admin.print_texts },
      schema: {
        tags,
        summary:
          'Create or change one paragraph of a print text (CRF_DELIVERY_TIME, DO_TERMS, PERMIT_TERMS …)',
        body: zPrintText,
      },
    },
    async (request) => {
      const b = request.body;
      await scopeAllowed(request, b.scope, P.admin.print_texts);
      await app.db.withTx(async (tx) => {
        const binds = {
          c: b.textCode,
          s: b.scope,
          sr: b.srNo,
          body: b.body,
          a: b.active ? 'Y' : 'N',
          u: request.session.usrid,
          now: app.clock.now(),
        };
        const n = await tx.exec(
          `UPDATE PRINT_TEXT SET TEXT_BODY = :body, ACTIVE = :a, ENTER_BY = :u, ENTER_DATE = :now
            WHERE BRNCH = :s AND TEXT_CODE = :c AND SR_NO = :sr`,
          binds,
        );
        if (n === 0) {
          await tx.exec(
            `INSERT INTO PRINT_TEXT (BRNCH, TEXT_CODE, SR_NO, TEXT_BODY, ACTIVE, ENTER_BY, ENTER_DATE, COMPC)
             VALUES (:s, :c, :sr, :body, :a, :u, :now, 1)`,
            binds,
          );
        }
        await recordAudit(tx, request.ctx(), {
          entity: 'PRINT_TEXT',
          key: `${b.scope}|${b.textCode}|${b.srNo}`,
          action: n === 0 ? 'CREATE' : 'UPDATE',
          brnch: b.scope || null,
          newValues: b,
        });
      }, request.txOpts('texts.print.save'));
      return { ok: true };
    },
  );
}
