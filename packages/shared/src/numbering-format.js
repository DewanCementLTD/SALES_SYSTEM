// Display format of document numbers (BR-NUM-03): number + "." + branch suffix where the
// business prints it (permit, DO, DC, DM, invoice). Allocation itself is in the API (DOC_SEQUENCE).

export const SUFFIXED_DOC_TYPES = Object.freeze(['PMT', 'DO', 'DC', 'DM', 'INV']);

/**
 * @param {string|number} no
 * @param {number} brnch 1 or 2
 * @param {string} [docType] suffix only for SUFFIXED_DOC_TYPES; omit to always add it
 */
export function formatDocNo(no, brnch, docType) {
  if (no === null || no === undefined || no === '') return '';
  if (docType && !SUFFIXED_DOC_TYPES.includes(docType)) return String(no);
  if (![1, 2].includes(Number(brnch))) throw new Error(`Bad branch ${brnch}`);
  return `${no}.${Number(brnch)}`;
}

/** Parse "2027746.1" → { no: '2027746', brnch: 1 }; plain numbers return brnch null. */
export function parseDocNo(text) {
  const m = /^\s*(\d+)(?:\.([12]))?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return { no: m[1], brnch: m[2] ? Number(m[2]) : null };
}
