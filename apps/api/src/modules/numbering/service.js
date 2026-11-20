// Gap-free document numbers (BR-NUM-01..05, ADR-4).
// The number is read and incremented with SELECT … FOR UPDATE inside the caller's business
// transaction: commit makes it permanent, rollback gives it back. Never Oracle sequences.
import { DOC_TYPES } from '@dcl/shared';
import { AppError } from '../../lib/errors.js';

/**
 * BR-NUM-01: allocate the next number for (branch, fiscal year, document type).
 * Lock order (ARCHITECTURE §4): call this AFTER locking the customer/document rows.
 * @param {import('../../lib/oracle/db.js').Tx} tx business transaction
 * @param {{ brnch: number, year: number, docType: string }} key
 * @returns {Promise<string>} the new number (string: NUMBER(19) exceeds JS safe integers)
 */
export async function nextNumber(tx, { brnch, year, docType }) {
  if (!DOC_TYPES.includes(docType)) throw new Error(`Unknown document type ${docType}`);
  if (!Number.isInteger(brnch) || !Number.isInteger(year))
    throw new Error('brnch and year must be integers');
  const binds = { b: brnch, y: year, t: docType };
  const row = await tx.one(
    `SELECT TO_CHAR(LAST_NO) AS LAST_NO FROM DOC_SEQUENCE
      WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t
      FOR UPDATE`,
    binds,
  );
  if (!row) {
    // BR-NUM-04: numbering must be seeded so it continues the legacy series; never restart at 1 silently.
    throw new AppError(
      'NUMBERING_NOT_SET_UP',
      409,
      `Document numbering for ${docType} is not set up for branch ${brnch}, year ${year}. Ask an administrator to run the numbering seed.`,
      { ruleId: 'BR-NUM-04', data: binds },
    );
  }
  const next = (BigInt(row.LAST_NO) + 1n).toString();
  await tx.exec(
    `UPDATE DOC_SEQUENCE SET LAST_NO = TO_NUMBER(:n) WHERE BRNCH = :b AND YEAR = :y AND DOC_TYPE = :t`,
    { ...binds, n: next },
  );
  return next;
}
