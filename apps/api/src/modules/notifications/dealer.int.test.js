// Dealer notifications (TASKS P2-09, BR-NTF-01/02). SALES_NEW, rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/helpers/app.js';
import { notifyDealer, renderTemplate } from './dealer.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('dealer notifications (P2-09)', () => {
  it('renders placeholders; unknown ones stay visible', () => {
    expect(renderTemplate('DO {DO_NO} for {X}', { DO_NO: '1.1' })).toBe('DO 1.1 for {X}');
  });

  it('BR-NTF-01/02: one outbox row per accepted channel, text from the template, no duplicates', async () => {
    const now = new Date('2026-11-23T05:00:00Z');
    const rows = await t.db.withTx(async (tx) => {
      await tx.exec(
        `UPDATE CUSTOMER_INFO SET NOTIFY_SMS = 'Y', NOTIFY_WA = 'N', NOTIFY_EMAIL = 'Y',
           MOBILE_NO = '03001234567', EMAIL = 'dealer@example.com'
         WHERE BRNCH = 1 AND CUSTOMER_CODE = '102-04'`,
      );
      const e = {
        brnch: 1,
        event: 'DO_ISSUED',
        docKey: '1|OS|22799000009',
        customerCode: '102-04',
        vars: { DO_NO: '22799000009.1', QTY: '35.00', PRODUCT: 'OPC', OC_NO: '227000999' },
        now,
      };
      const first = await notifyDealer(tx, e);
      const again = await notifyDealer(tx, e); // same event + document → nothing new
      const out = await tx.many(
        `SELECT CHANNEL, RECIPIENT, PAYLOAD FROM NOTIFICATION_OUTBOX WHERE EVENT_TYPE = 'DO_ISSUED'
           AND AGGREGATE_KEY = '1|OS|22799000009' ORDER BY CHANNEL`,
      );
      return { first, again, out };
    });
    expect(rows.first).toHaveLength(2);
    expect(rows.again).toEqual([]);
    expect(rows.out.map((r) => [r.CHANNEL, r.RECIPIENT])).toEqual([
      ['EMAIL', 'dealer@example.com'],
      ['SMS', '03001234567'],
    ]);
    const sms = JSON.parse(rows.out[1].PAYLOAD);
    expect(sms.text).toBe(
      'DCL: DO 22799000009.1 issued, 35.00 t OPC. Show the DO at the plant gate.',
    );
    expect(JSON.parse(rows.out[0].PAYLOAD).subject).toBe('Delivery Order 22799000009.1');
  });
});

describe('admin texts (P2-09)', () => {
  it('templates and print texts: upsert, company scope, audit', async () => {
    const { Client, createUser } = await import('../../../test/helpers/app.js');
    const u = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'], 2: ['SYS_ADMIN'] } });
    const c = new Client(t.app);
    await c.login(u.usrid, u.password, { brnch: 1 });
    const tpl = (await c.get('/api/v1/admin/templates')).json();
    expect(tpl.items.some((x) => x.templateCode === 'DO_ISSUED' && x.channel === 'SMS')).toBe(true);
    const put = await c.put('/api/v1/admin/templates', {
      templateCode: 'DO_ISSUED',
      channel: 'SMS',
      scope: 2,
      body: 'Hattar: DO {DO_NO} issued.',
    });
    expect(put.statusCode, put.body).toBe(200);
    const pt = await c.put('/api/v1/admin/print-texts', {
      textCode: 'DO_TERMS',
      srNo: 1,
      scope: 0,
      body: 'Lift the cement as per company policy.',
    });
    expect(pt.statusCode, pt.body).toBe(200);
    const texts = (await c.get('/api/v1/admin/print-texts')).json();
    expect(texts.items).toContainEqual({
      textCode: 'DO_TERMS',
      scope: 0,
      srNo: 1,
      body: 'Lift the cement as per company policy.',
      active: true,
    });
  });
});
