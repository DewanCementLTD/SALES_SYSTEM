import { ROLES } from '@dcl/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, buildTestApp, createUser } from '../../../test/helpers/app.js';
import { expectNoBranchLeak } from '../../../test/helpers/branch-leak.js';
import { recordAudit } from '../audit/service.js';
import { userPermissions } from './repo.js';

/** @type {Awaited<ReturnType<typeof buildTestApp>>} */
let t;
beforeEach(async () => {
  t = await buildTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('P0-09 RBAC', () => {
  it('role × permission matrix in the database equals PERMISSIONS §3 fixture', async () => {
    for (const role of ROLES) {
      const u = await createUser(t.db, { roles: { 1: [role.code] } });
      const perms = await t.db.read((tx) => userPermissions(tx, u.userId, 1));
      expect([...perms].sort(), role.code).toEqual(role.permissions);
      // no permissions leak into a branch where the user has no role
      const none = await t.db.read((tx) => userPermissions(tx, u.userId, 2));
      expect(none.size).toBe(0);
    }
  });

  it('P-1: endpoint permission is enforced (403 problem+json with the missing key)', async () => {
    const fin = await createUser(t.db, { roles: { 1: ['FINANCE'] } });
    const c = new Client(t.app);
    await c.login(fin.usrid, fin.password);
    const res = await c.get('/api/v1/admin/users');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
    expect(res.json().data.permission).toEqual(['admin.users']);

    const admin = await createUser(t.db, { roles: { 1: ['SYS_ADMIN'] } });
    const a = new Client(t.app);
    await a.login(admin.usrid, admin.password);
    expect((await a.get('/api/v1/admin/users')).statusCode).toBe(200);
  });

  it('BR-BR-04: admin user list does not leak users of other branches', async () => {
    await expectNoBranchLeak(t, {
      url: '/api/v1/admin/users',
      roles: ['BRANCH_ADMIN'],
      seedOtherBranch: async () => {
        await createUser(t.db, { roles: { 2: ['FINANCE'] } });
      },
      // a user row has no single branch: check through its access list
      brnchOf: () => 1,
    }).then(async (items) => {
      for (const item of items) {
        const access = await t.db.read((tx) =>
          tx.many('SELECT BRNCH FROM APP_USER_BRANCH WHERE USER_ID = :u', { u: item.userId }),
        );
        expect(access.map((a) => a.BRNCH)).toContain(1);
      }
    });
  });

  it('BR-BR-04: audit viewer does not leak other-branch events', async () => {
    await expectNoBranchLeak(t, {
      url: '/api/v1/audit',
      roles: ['AUDITOR'],
      allowNull: true,
      seedOtherBranch: () =>
        t.db.withTx((tx) =>
          recordAudit(
            tx,
            { usrid: 'test', brnch: 2 },
            { entity: 'TEST', key: 'x', action: 'CREATE' },
          ),
        ),
      brnchOf: (item) => item.brnch,
    });
  });
});
