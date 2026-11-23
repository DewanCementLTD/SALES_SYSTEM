// /api/v1/ledger/* and /customers/{brnch}/{code}/balance (API_SPEC §5, §13; TASKS P2-00, P1-08).
// Read-only: ledger rows are posted by the document services in their own transactions.
import { P, businessDate, zBrnch, zIsoDate } from '@dcl/shared';
import { z } from 'zod';
import { Errors } from '../../lib/errors.js';
import * as balance from './balance.js';
import * as ledger from './service.js';

const zCode = z
  .string()
  .trim()
  .min(1)
  .max(11)
  .regex(/^[A-Za-z0-9-]+$/, 'Not a customer code');
const zMoneyS = z.string();

const zLine = z.object({
  ledgerId: z.number(),
  entryDate: z.string(),
  docType: z.string(),
  docYear: z.number().nullable(),
  docNo: z.string(),
  docLine: z.number(),
  entryKind: z.string(),
  narration: z.string(),
  debit: zMoneyS,
  credit: zMoneyS,
  running: zMoneyS,
  qtyTon: z.string().nullable(),
  glCode: z.string().nullable(),
  reversalOf: z.number().nullable(),
});

const zCommitment = z.object({
  kind: z.enum(['DO', 'PERMIT']),
  docNo: z.string(),
  ocNo: z.number().nullable(),
  productCode: z.string().nullable(),
  status: z.string(),
  qtyTon: z.string(),
  dispatchedTon: z.string(),
  rate: zMoneyS,
  value: zMoneyS,
});

/** @param {import('fastify').FastifyInstance} app */
export default async function ledgerRoutes(app) {
  const customerName = async (tx, brnch, code) => {
    const r = await tx.one(
      'SELECT CUSTOMER_NAME FROM CUSTOMER_INFO WHERE BRNCH = :b AND CUSTOMER_CODE = :c',
      { b: brnch, c: code },
    );
    if (!r) throw Errors.notFound('Customer');
    return r.CUSTOMER_NAME;
  };

  app.get(
    '/ledger/:brnch/:customerCode',
    {
      config: { permission: P.ledger.view },
      schema: {
        tags: ['ledger'],
        summary: 'Customer ledger statement: DO based (R1) or DC based (R13), with running balance',
        params: z.object({ brnch: zBrnch, customerCode: zCode }),
        querystring: z
          .object({ type: z.enum(['DO', 'DC']).default('DC'), from: zIsoDate, to: zIsoDate })
          .refine((q) => q.from <= q.to, { message: 'From must be on or before To', path: ['to'] }),
        response: {
          200: z.object({
            brnch: z.number(),
            customerCode: z.string(),
            customerName: z.string().nullable(),
            ledgerType: z.string(),
            from: z.string(),
            to: z.string(),
            opening: zMoneyS,
            lines: z.array(zLine),
            totals: z.object({ debit: zMoneyS, credit: zMoneyS }),
            closing: zMoneyS,
          }),
        },
      },
    },
    async (request) => {
      const { brnch, customerCode } = request.params;
      const { type, from, to } = request.query;
      return app.db.read(
        async (tx) => ({
          customerName: await customerName(tx, brnch, customerCode),
          ...(await ledger.statement(tx, { brnch, customerCode, ledgerType: type, from, to })),
        }),
        request.txOpts('ledger.statement'),
      );
    },
  );

  app.get(
    '/customers/:brnch/:code/balance',
    {
      config: { permission: P.customer.view_balance },
      schema: {
        tags: ['customers', 'ledger'],
        summary:
          'Available balance = − DC ledger − open commitments + unused credit (BR-BAL-01/05/06)',
        params: z.object({ brnch: zBrnch, code: zCode }),
        querystring: z.object({
          value: z
            .string()
            .regex(/^\d{1,14}(\.\d{1,2})?$/)
            .optional(),
        }),
        response: {
          200: z.object({
            brnch: z.number(),
            customerCode: z.string(),
            asOf: z.string(),
            dcLedgerBalance: zMoneyS,
            doLedgerBalance: zMoneyS,
            openCommitments: zMoneyS,
            unusedCredit: zMoneyS,
            available: zMoneyS,
            commitments: z.array(zCommitment),
            credit: z.object({
              hasCreditLimitsRow: z.boolean(),
              legacyCreditLimit: zMoneyS.nullable(),
              types: z.array(
                z.object({
                  creditType: z.string(),
                  current: zMoneyS,
                  availed: zMoneyS,
                  unused: zMoneyS,
                }),
              ),
            }),
            todayCollection: z.object({ total: zMoneyS, receipts: z.number() }),
            value: zMoneyS.optional(),
            shortfall: zMoneyS.optional(),
          }),
        },
      },
    },
    async (request) => {
      const now = app.clock.now();
      return app.db.read(
        async (tx) => ({
          asOf: businessDate(now),
          ...(await balance.available(tx, {
            brnch: request.params.brnch,
            customerCode: request.params.code,
            now,
            value: request.query.value,
          })),
        }),
        request.txOpts('customer.balance'),
      );
    },
  );
}
