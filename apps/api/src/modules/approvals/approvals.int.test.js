import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { matchRule, onApproved, requestApproval } from './service.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
let runs = 0;
onApproved('TEST_ACTION', async (tx, req) => {
  runs += 1;
  // proves the handler runs inside the approval transaction
  await tx.one('SELECT 1 FROM DUAL');
  expect(req.status).toBe('APPROVED');
});

beforeEach(async () => {
  t = await buildTestApp();
  runs = 0;
});
afterEach(async () => {
  await t.close();
});

async function twoLevelRule() {
  return t.db.withTx(async (tx) => {
    const id = await tx.nextId('SEQ_APPROVAL_RULE');
    await tx.exec(
      `INSERT INTO APPROVAL_RULE (RULE_ID, BRNCH, DOC_TYPE, RULE_NAME, LEVELS, LEVEL1_ROLE, LEVEL2_ROLE, SAME_USER_ALLOWED, PRIORITY, ACTIVE)
       VALUES (:id, 1, 'CREDIT_LIMIT', 'test two levels', 2, 'FINANCE_MANAGER', 'CFO', 'N', 1, 'Y')`,
      { id },
    );
    return id;
  });
}

async function login(u) {
  const c = new Client(t.app);
  await c.login(u.usrid, u.password);
  return c;
}

describe('BR-APR approval engine (P0-12)', () => {
  it('BR-APR-01: rule matching picks lowest priority, branch rule over all-branch, thresholds', () => {
    const base = { active: true, docType: 'X', minAmount: null, minQty: null, conditionCode: null };
    const rules = [
      { ...base, ruleId: 1, brnch: 0, priority: 100 },
      { ...base, ruleId: 2, brnch: 1, priority: 100 },
      { ...base, ruleId: 3, brnch: 0, priority: 50, minAmount: '1000000' },
    ];
    expect(matchRule(rules, { docType: 'X', brnch: 1, amount: '10' }).ruleId).toBe(2);
    expect(matchRule(rules, { docType: 'X', brnch: 2, amount: '10' }).ruleId).toBe(1);
    expect(matchRule(rules, { docType: 'X', brnch: 2, amount: '1000000.00' }).ruleId).toBe(3);
    expect(matchRule(rules, { docType: 'Y', brnch: 1 })).toBeNull();
  });

  it('2-level rule approves in order; requester cannot approve; handler runs once on double click', async () => {
    await twoLevelRule();
    const maker = await createUser(t.db, { roles: { 1: ['FINANCE_MANAGER'] } });
    const fm = await createUser(t.db, { roles: { 1: ['FINANCE_MANAGER'] } });
    const cfo = await createUser(t.db, { roles: { 1: ['CFO'] } });

    const { requestId } = await t.db.withTx((tx) =>
      requestApproval(
        tx,
        { userId: maker.userId, usrid: maker.usrid, now: t.clock.now() },
        {
          brnch: 1,
          docType: 'CREDIT_LIMIT',
          docKey: 'CL|1|TEST',
          action: 'TEST_ACTION',
          snapshot: { limit: '5000000.00' },
          amount: '5000000.00',
          reason: 'Raise credit limit for test',
        },
      ),
    );

    // a second request for the same document is refused while one is pending
    await expect(
      t.db.withTx((tx) =>
        requestApproval(
          tx,
          { userId: maker.userId, usrid: maker.usrid, now: t.clock.now() },
          {
            brnch: 1,
            docType: 'CREDIT_LIMIT',
            docKey: 'CL|1|TEST',
            action: 'TEST_ACTION',
            snapshot: {},
            reason: 'Duplicate request test',
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'duplicate' });

    const makerC = await login(maker);
    const own = await makerC.post(`/api/v1/approvals/${requestId}/approve`, {});
    expect(own.statusCode).toBe(403);
    expect(own.json().code).toBe('maker_checker');

    const cfoC = await login(cfo);
    expect((await cfoC.get('/api/v1/approvals/inbox')).json().map((r) => r.reqId)).not.toContain(
      requestId,
    );
    expect((await cfoC.post(`/api/v1/approvals/${requestId}/approve`, {})).statusCode).toBe(403); // not level 1 role

    const fmC = await login(fm);
    expect((await fmC.get('/api/v1/approvals/inbox')).json().map((r) => r.reqId)).toContain(
      requestId,
    );
    const l1 = await fmC.post(`/api/v1/approvals/${requestId}/approve`, { comment: 'ok' });
    expect(l1.json()).toEqual({ reqId: requestId, status: 'PENDING', currentLevel: 2 });
    expect(runs).toBe(0);

    expect((await cfoC.get('/api/v1/approvals/inbox')).json().map((r) => r.reqId)).toContain(
      requestId,
    );
    const l2 = await cfoC.post(`/api/v1/approvals/${requestId}/approve`, {});
    expect(l2.json().status).toBe('APPROVED');
    expect(runs).toBe(1);

    const again = await cfoC.post(`/api/v1/approvals/${requestId}/approve`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('invalid_state');
    expect(runs).toBe(1);

    const detail = (await makerC.get(`/api/v1/approvals/${requestId}`)).json();
    expect(detail.history.map((h) => [h.level, h.decision])).toEqual([
      [1, 'APPROVED'],
      [2, 'APPROVED'],
    ]);
    // requester was notified of the final decision
    const bell = (await makerC.get('/api/v1/notifications')).json();
    expect(bell.items[0].title).toContain('approved');
  });

  it('reject needs a comment and ends the request; requester may cancel only own pending requests', async () => {
    await twoLevelRule();
    const maker = await createUser(t.db, { roles: { 1: ['FINANCE'] } });
    const fm = await createUser(t.db, { roles: { 1: ['FINANCE_MANAGER'] } });
    const mk = (key) =>
      t.db.withTx((tx) =>
        requestApproval(
          tx,
          { userId: maker.userId, usrid: maker.usrid, now: t.clock.now() },
          {
            brnch: 1,
            docType: 'CREDIT_LIMIT',
            docKey: key,
            action: 'TEST_ACTION',
            snapshot: {},
            reason: 'Testing reject and cancel',
          },
        ),
      );
    const a = await mk('CL|1|A');
    const b = await mk('CL|1|B');
    const fmC = await login(fm);
    expect((await fmC.post(`/api/v1/approvals/${a.requestId}/reject`, {})).statusCode).toBe(400);
    expect(
      (
        await fmC.post(`/api/v1/approvals/${a.requestId}/reject`, { comment: 'Not justified' })
      ).json().status,
    ).toBe('REJECTED');
    expect((await fmC.post(`/api/v1/approvals/${b.requestId}/cancel`)).statusCode).toBe(403);
    const makerC = await login(maker);
    expect((await makerC.post(`/api/v1/approvals/${b.requestId}/cancel`)).statusCode).toBe(200);
    expect(runs).toBe(0);
  });
});
