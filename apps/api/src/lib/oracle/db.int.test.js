import { afterAll, describe, expect, it } from 'vitest';
import { TEST_SEQ, closeTestDb, getTestDb, inRollback } from '../../../test/helpers/db.js';
import { paginate } from './paginate.js';

afterAll(closeTestDb);

describe('Oracle access layer (P0-03)', () => {
  it('connects and pings', async () => {
    const db = await getTestDb();
    expect(await db.ping()).toBe(true);
  });

  it('withTx rolls back everything when asked (tests leave no rows)', async () => {
    const binds = { b: TEST_SEQ.brnch, y: TEST_SEQ.year, t: 'ZZT' };
    await inRollback(async (tx) => {
      await tx.exec(
        'INSERT INTO DOC_SEQUENCE (BRNCH, YEAR, DOC_TYPE, LAST_NO) VALUES (:b, :y, :t, 41)',
        binds,
      );
      const row = await tx.one(
        'SELECT LAST_NO FROM DOC_SEQUENCE WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t',
        binds,
      );
      // NUMBER(19) can exceed Number.MAX_SAFE_INTEGER, so it is fetched as a string
      expect(row.LAST_NO).toBe('41');
    });
    const db = await getTestDb();
    const after = await db.read((tx) =>
      tx.one(
        'SELECT COUNT(*) AS N FROM DOC_SEQUENCE WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t',
        binds,
      ),
    );
    expect(after.N).toBe(0);
  });

  it('withTx rolls back when the work throws', async () => {
    const db = await getTestDb();
    const binds = { b: TEST_SEQ.brnch, y: TEST_SEQ.year, t: 'ZZE' };
    await expect(
      db.withTx(async (tx) => {
        await tx.exec(
          'INSERT INTO DOC_SEQUENCE (BRNCH, YEAR, DOC_TYPE, LAST_NO) VALUES (:b, :y, :t, 1)',
          binds,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await db.read((tx) =>
      tx.one(
        'SELECT COUNT(*) AS N FROM DOC_SEQUENCE WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t',
        binds,
      ),
    );
    expect(after.N).toBe(0);
  });

  it('paginates with ROWNUM: pages are disjoint and match the full ordered list', async () => {
    const sql = 'SELECT YEAR, BRNCH, DESCR FROM SALES_YEAR ORDER BY YEAR DESC, BRNCH';
    await inRollback(async (tx) => {
      const all = await tx.many(sql);
      const p1 = await paginate(tx, { sql, page: 1, pageSize: 4 });
      const p2 = await paginate(tx, { sql, page: 2, pageSize: 4 });
      expect(p1.total).toBe(all.length);
      expect(p1.items).toEqual(all.slice(0, 4));
      expect(p2.items).toEqual(all.slice(4, 8));
      expect(p1.items[0]).not.toHaveProperty('RN__');
    });
  });

  it('returns decimal NUMBER columns as strings and integers as numbers', async () => {
    await inRollback(async (tx) => {
      const r = await tx.one(
        'SELECT CAST(1234567.85 AS NUMBER(16,2)) AS AMT, CAST(7 AS NUMBER(3)) AS N FROM DUAL',
      );
      expect(r.AMT).toBe('1234567.85');
      expect(r.N).toBe(7);
    });
  });

  it('allocates technical ids from SEQ_ sequences and rejects bad names', async () => {
    await inRollback(async (tx) => {
      const id = await tx.nextId('SEQ_AUDIT_LOG');
      expect(Number.isInteger(id)).toBe(true);
      await expect(tx.nextId('SEQ_X; DROP')).rejects.toThrow();
    });
  });
});
