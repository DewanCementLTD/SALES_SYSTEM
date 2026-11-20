import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, inRollback } from '../../../test/helpers/db.js';
import { nextNumber } from './service.js';

// Uses the real seeded row (BRNCH 1, current FY 2027, GP = gate pass, unused until P3).
// Every transaction rolls back, so the counter is unchanged afterwards (user decision: rollback-only).
const KEY = { brnch: 1, year: 2027, docType: 'GP' };

async function currentLastNo() {
  const db = await getTestDb();
  const r = await db.read((tx) =>
    tx.one(
      'SELECT TO_CHAR(LAST_NO) AS N FROM DOC_SEQUENCE WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t',
      { b: KEY.brnch, y: KEY.year, t: KEY.docType },
    ),
  );
  if (!r) throw new Error('Run pnpm db:seed first (DOC_SEQUENCE row missing)');
  return BigInt(r.N);
}

afterAll(closeTestDb);

describe('numbering service (P0-07, BR-NUM)', () => {
  it('BR-NUM-01: consecutive numbers inside one transaction; rollback gives them back', async () => {
    const before = await currentLastNo();
    const got = await inRollback(async (tx) => [
      await nextNumber(tx, KEY),
      await nextNumber(tx, KEY),
      await nextNumber(tx, KEY),
    ]);
    expect(got).toEqual([before + 1n, before + 2n, before + 3n].map(String));
    expect(await currentLastNo()).toBe(before);
  });

  it('BR-NUM-01: 50 parallel allocations are serialised by the row lock (no two hold it at once)', async () => {
    const db = await getTestDb();
    const before = await currentLastNo();
    const windows = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        db.withTx(
          async (tx) => {
            const no = await nextNumber(tx, KEY); // blocks until the previous holder ends
            const start = process.hrtime.bigint();
            await sleep(5);
            const end = process.hrtime.bigint();
            return { i, no, start, end };
          },
          { usrid: 'vitest', action: 'num-concurrency', rollback: true },
        ),
      ),
    );
    windows.sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let k = 1; k < windows.length; k += 1) {
      expect(windows[k].start >= windows[k - 1].end, `overlap at ${k}`).toBe(true);
    }
    // every holder saw the committed value (+1) because each predecessor rolled back
    expect(new Set(windows.map((w) => w.no))).toEqual(new Set([String(before + 1n)]));
    expect(await currentLastNo()).toBe(before);
  });

  it('BR-NUM-04: refuses to start a series that was not seeded', async () => {
    await inRollback(async (tx) => {
      await expect(nextNumber(tx, { brnch: 1, year: 2099, docType: 'GP' })).rejects.toMatchObject({
        code: 'numbering_not_set_up',
      });
    });
  });

  it('rejects unknown document types', async () => {
    await inRollback(async (tx) => {
      await expect(nextNumber(tx, { ...KEY, docType: 'XYZ' })).rejects.toThrow(
        /Unknown document type/,
      );
    });
  });
});
