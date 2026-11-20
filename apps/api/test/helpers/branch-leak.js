// Branch-leak harness (BR-BR-04, TASKS P0-09). Every list endpoint gets a test built with this:
// a user allowed only on branch 1 must never receive branch-2 rows, and asking for branch 2 is refused.
import { expect } from 'vitest';
import { Client, createUser } from './app.js';

/**
 * @param {{ app: any, db: any }} t test app
 * @param {{ url: string, roles: string[], brnchOf: (item: any) => number|null, seedOtherBranch: () => Promise<void>, supportsBrnchParam?: boolean, allowNull?: boolean }} spec
 *   seedOtherBranch must create at least one branch-2 row the endpoint would return if unscoped.
 */
export async function expectNoBranchLeak(t, spec) {
  await spec.seedOtherBranch();
  const u = await createUser(t.db, { roles: { 1: spec.roles } });
  const c = new Client(t.app);
  await c.login(u.usrid, u.password, { brnch: 1 });

  const res = await c.get(`${spec.url}${spec.url.includes('?') ? '&' : '?'}pageSize=200`);
  expect(res.statusCode, res.body).toBe(200);
  const items = res.json().items ?? res.json();
  for (const item of items) {
    const b = spec.brnchOf(item);
    if (b === null && spec.allowNull) continue;
    expect(b, `leaked row ${JSON.stringify(item).slice(0, 200)}`).toBe(1);
  }

  if (spec.supportsBrnchParam) {
    const other = await c.get(`${spec.url}${spec.url.includes('?') ? '&' : '?'}brnch=2`);
    expect(other.statusCode).toBe(403);
  }
  return items;
}
