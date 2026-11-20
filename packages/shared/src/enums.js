// Status values and allowed transitions (BUSINESS_RULES §12).
// Services change a document's DOC_STATUS only through `assertTransition` (CLAUDE.md rule 12).

/** Branch codes (BRNCH). */
export const BRANCH = Object.freeze({ KARACHI: 1, HATTAR: 2 });
export const BRANCHES = Object.freeze([
  { brnch: 1, code: 'KHI', name: 'Karachi', suffix: '.1' },
  { brnch: 2, code: 'HTR', name: 'Islamabad / Hattar', suffix: '.2' },
]);
export const COMPANY_CODE = 1; // COMPC (BUSINESS_RULES §0)

/**
 * Transition table: machine → { fromStatus: [toStatus, …] }.
 * Notes on gaps in §12, filled from the rules they cite:
 * - "Reject" returns a document to DRAFT (BR-OC-04 wording), used for customer/OC/permit/note approvals.
 * - DO/permit may go straight to DISPATCHED when one truck takes the whole remainder (BR-DO-04, BR-PMT-05).
 * - DC and invoice may be cancelled after finalisation until FBR accepts (BR-DC-CXL-02).
 */
export const STATE_MACHINES = Object.freeze({
  CUSTOMER: {
    DRAFT: ['PENDING_APPROVAL'],
    PENDING_APPROVAL: ['APPROVED', 'DRAFT'],
    APPROVED: ['BLOCKED', 'CLOSED'],
    BLOCKED: ['APPROVED'],
    CLOSED: [],
  },
  SRF: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['CONVERTED', 'CANCELLED'],
    CONVERTED: [],
    CANCELLED: [],
  },
  OC: {
    DRAFT: ['REVIEWED', 'CANCELLED'],
    REVIEWED: ['APPROVED', 'DRAFT', 'CANCELLED'],
    APPROVED: ['CONFIRMED', 'DRAFT', 'CANCELLED'],
    CONFIRMED: ['CLOSED', 'CANCELLED'],
    CLOSED: [],
    CANCELLED: [],
  },
  BRV: {
    ENTERED: ['VERIFIED', 'CANCELLED'],
    VERIFIED: ['CLEARED', 'BOUNCED'],
    CLEARED: ['BOUNCED'],
    BOUNCED: [],
    CANCELLED: [],
  },
  PERMIT: {
    DRAFT: ['PENDING_CFO', 'ISSUED', 'CANCELLED'],
    PENDING_CFO: ['ISSUED', 'DRAFT', 'CANCELLED'],
    ISSUED: ['PARTLY_DISPATCHED', 'DISPATCHED', 'CANCELLED'],
    PARTLY_DISPATCHED: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: [],
    CANCELLED: [],
  },
  DO: {
    ISSUED: ['PARTLY_DISPATCHED', 'DISPATCHED', 'ON_HOLD', 'CANCELLED'],
    PARTLY_DISPATCHED: ['DISPATCHED', 'ON_HOLD', 'CANCELLED'],
    ON_HOLD: ['ISSUED', 'PARTLY_DISPATCHED', 'CANCELLED'],
    DISPATCHED: [],
    CANCELLED: [],
  },
  GATE_PASS: {
    TOKEN: ['IN'],
    IN: ['TARE_DONE', 'ABORTED'],
    TARE_DONE: ['GROSS_DONE', 'ABORTED'],
    GROSS_DONE: ['VARIANCE_BLOCKED', 'INVOICED'],
    VARIANCE_BLOCKED: ['OVERRIDDEN', 'GROSS_DONE'], // re-weigh = new gross reading (BR-WGT-05)
    OVERRIDDEN: ['INVOICED'],
    INVOICED: ['EXITED'],
    EXITED: [],
    ABORTED: [],
  },
  DC: {
    ISSUED: ['WEIGHED', 'CANCELLED'],
    WEIGHED: ['INVOICED', 'CANCELLED'],
    INVOICED: ['FBR_PENDING', 'CLOSED', 'CANCELLED'],
    FBR_PENDING: ['FBR_DONE', 'CANCELLED'],
    FBR_DONE: ['CLOSED'],
    CLOSED: [],
    CANCELLED: [],
  },
  INVOICE: {
    FINAL: ['FBR_PENDING', 'CANCELLED'],
    FBR_PENDING: ['FBR_ACCEPTED', 'FBR_REJECTED', 'CANCELLED'],
    FBR_REJECTED: ['FBR_PENDING', 'CANCELLED'],
    FBR_ACCEPTED: [],
    CANCELLED: [],
  },
  NOTE: {
    DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
    PENDING_APPROVAL: ['POSTED', 'DRAFT', 'CANCELLED'],
    POSTED: ['REVERSED'],
    REVERSED: [],
    CANCELLED: [],
  },
  APPROVAL: {
    PENDING: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
    APPROVED: [],
    REJECTED: [],
    CANCELLED: [],
    EXPIRED: [],
  },
});

/** Status names of a machine, as a frozen object `{ DRAFT: 'DRAFT', … }`. */
export function statusesOf(machine) {
  const table = STATE_MACHINES[machine];
  if (!table) throw new Error(`Unknown state machine ${machine}`);
  return Object.freeze(Object.fromEntries(Object.keys(table).map((s) => [s, s])));
}

export const CUSTOMER_STATUS = statusesOf('CUSTOMER');
export const SRF_STATUS = statusesOf('SRF');
export const OC_STATUS = statusesOf('OC');
export const BRV_STATUS = statusesOf('BRV');
export const PERMIT_STATUS = statusesOf('PERMIT');
export const DO_STATUS = statusesOf('DO');
export const GATE_PASS_STATUS = statusesOf('GATE_PASS');
export const DC_STATUS = statusesOf('DC');
export const INVOICE_STATUS = statusesOf('INVOICE');
export const NOTE_STATUS = statusesOf('NOTE');
export const APPROVAL_STATUS = statusesOf('APPROVAL');

/** @returns {boolean} */
export function canTransition(machine, from, to) {
  const table = STATE_MACHINES[machine];
  if (!table) throw new Error(`Unknown state machine ${machine}`);
  return Array.isArray(table[from]) && table[from].includes(to);
}

/** Terminal = no outgoing transitions. */
export function isTerminal(machine, status) {
  const next = STATE_MACHINES[machine]?.[status];
  return Array.isArray(next) && next.length === 0;
}

/**
 * Result object for services: `{ ok: true }` or `{ ok: false, code, detail }`.
 * The API maps a failure to AppError('INVALID_STATE', 409).
 */
export function checkTransition(machine, from, to) {
  if (canTransition(machine, from, to)) return { ok: true };
  return {
    ok: false,
    code: 'INVALID_STATE',
    detail: `${machine} cannot change from ${from} to ${to}`,
  };
}

/** Document types for DOC_SEQUENCE (BR-NUM-02 ∪ SCHEMA §4). */
export const DOC_TYPES = Object.freeze([
  'SRF',
  'OC',
  'BRV',
  'DO',
  'PMT',
  'GP',
  'DC',
  'DM',
  'INV',
  'CN',
  'DN',
  'CXL',
  'OCA',
  'RCX',
  'DOA',
  'INC',
]);

/** Approval document types seeded by default (BR-APR-04). */
export const APPROVAL_DOC_TYPES = Object.freeze([
  'CUSTOMER_APPROVE',
  'CREDIT_LIMIT',
  'RATE_CHANGE',
  'OC_PRICE_OVERRIDE',
  'OC_BALANCE_OVERRIDE',
  'PERMIT_CFO',
  'PERMIT_BALANCE_OVERRIDE',
  'DO_CANCEL',
  'WEIGHT_OVERRIDE',
  'DC_CANCEL',
  'NOTE_POST',
  'EXIT_WITHOUT_FBR',
]);
