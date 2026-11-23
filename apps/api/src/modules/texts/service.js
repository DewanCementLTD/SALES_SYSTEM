// Print texts (PRINT_TEXT): clause/terms paragraphs of a print. The branch's own paragraphs win
// over the company ones (BRNCH 0); switched-off paragraphs are skipped. Never invented: an empty
// list means "not set up" and the template says so.

/**
 * @param {import('../../lib/oracle/db.js').Tx} tx
 * @param {number} brnch
 * @param {string} code e.g. DO_TERMS, PERMIT_TERMS, OC_TERMS
 * @returns {Promise<string[]>}
 */
export async function printTexts(tx, brnch, code) {
  const rows = await tx.many(
    `SELECT TEXT_BODY FROM PRINT_TEXT WHERE TEXT_CODE = :c AND NVL(ACTIVE, 'Y') = 'Y'
        AND BRNCH = (SELECT MAX(x.BRNCH) FROM PRINT_TEXT x WHERE x.TEXT_CODE = :c AND x.BRNCH IN (0, :b))
      ORDER BY SR_NO`,
    { c: code, b: brnch },
  );
  return rows.map((r) => r.TEXT_BODY);
}
