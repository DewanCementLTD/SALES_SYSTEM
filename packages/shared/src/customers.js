// Customer rules shared by API and web (BUSINESS_RULES §2 BR-CUS-*, PRD 4.2, TASKS P1-03).
import { z } from 'zod';
import { masterBodySchema } from './masters.js';

const yesNo = (name, col, label, tab, extra = {}) => ({
  name,
  col,
  kind: 'yn',
  label,
  tab,
  ...extra,
});
const text = (name, col, max, label, tab, extra = {}) => ({
  name,
  col,
  kind: 'text',
  max,
  label,
  tab,
  ...extra,
});
const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));

/** BR-CUS-04 tax profile values as stored by the legacy system. */
export const TAX_TYPES = opts([
  ['R', 'Registered'],
  ['U', 'Un-registered'],
  ['E', 'Exempt'],
  ['C', 'Consumer'],
]);
export const SALES_TAX_STATUSES = opts([
  ['A', 'Active'],
  ['D', 'In-active'],
]);
export const FILER_STATUSES = opts([
  ['F', 'Filer'],
  ['N', 'Non-filer'],
  ['E', 'Exempt'],
]);

export const CUSTOMER_TABS = Object.freeze([
  { id: 'info', label: 'Information' },
  { id: 'tax', label: 'Sales tax' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'group', label: 'Group / link' },
]);

/**
 * Editable CUSTOMER_INFO fields. `approval: true` = on an APPROVED customer a change goes through a
 * change request (BR-CUS-02: tax profile and contact numbers; credit limits have their own document).
 * @type {import('./masters.js').MasterField[]}
 */
export const CUSTOMER_FIELDS = Object.freeze([
  text('customerName', 'CUSTOMER_NAME', 60, 'Customer name', 'info', {
    required: true,
    list: true,
  }),
  text('address1', 'CUSTOMER_ADDRESS1', 60, 'Address line 1', 'info'),
  text('address2', 'CUSTOMER_ADDRESS2', 60, 'Address line 2', 'info'),
  {
    name: 'channelCode',
    col: 'CHANNEL_CODE',
    kind: 'ref',
    ref: 'channels',
    label: 'Channel',
    tab: 'info',
    required: true,
    list: true,
  },
  {
    name: 'categoryCode',
    col: 'CUSTOMER_TYPE',
    kind: 'ref',
    ref: 'categories',
    label: 'Category',
    tab: 'info',
  },
  {
    name: 'cardOpenDate',
    col: 'CARD_OPEN_DATE',
    kind: 'date',
    label: 'Card open date',
    tab: 'info',
  },
  {
    name: 'cardClosedDate',
    col: 'CARD_CLOSED_DATE',
    kind: 'date',
    label: 'Card closed date',
    tab: 'info',
  },
  { name: 'misc', col: 'MISC', kind: 'flag01', label: 'Misc. customer', tab: 'info' },
  yesNo('transporter', 'TRNSP', 'Also a transporter', 'info'),
  text('glCode', 'GL_CODE', 10, 'GL code', 'info'),

  {
    name: 'salesTaxType',
    col: 'SALES_TAX_TYPE',
    kind: 'enum',
    options: TAX_TYPES,
    label: 'Sales tax type',
    tab: 'tax',
    approval: true,
    list: true,
  },
  {
    name: 'salesTaxStatus',
    col: 'SALES_TAX_STATS',
    kind: 'enum',
    options: SALES_TAX_STATUSES,
    label: 'Sales tax status',
    tab: 'tax',
    approval: true,
  },
  text('strn', 'SALES_TAX_NO', 100, 'STRN', 'tax', { format: 'strn', approval: true }),
  {
    name: 'incomeTaxType',
    col: 'INCOM_TAX_TYPE',
    kind: 'enum',
    options: TAX_TYPES,
    label: 'Income tax type',
    tab: 'tax',
    approval: true,
  },
  {
    name: 'filerStatus',
    col: 'INCOM_TAX_STATS',
    kind: 'enum',
    options: FILER_STATUSES,
    label: 'Filer status',
    tab: 'tax',
    approval: true,
  },
  text('ntn', 'NTN', 50, 'NTN', 'tax', { format: 'ntn', approval: true }),
  text('cnic', 'CNIC', 50, 'CNIC', 'tax', { format: 'cnic', approval: true }),
  text('registerName', 'REGISTER_NAME', 60, 'Registered name', 'tax', { approval: true }),
  text('registerNumber', 'REGISTER_NUMBER', 50, 'Register no.', 'tax', { approval: true }),
  text('jurisdiction', 'JURISDICTION', 60, 'Jurisdiction', 'tax', { approval: true }),
  yesNo('taxDeduct', 'TAX_DEDUCT', 'Deducts tax at source', 'tax', { approval: true }),

  text('phone', 'PH_NO', 35, 'Phone', 'contacts', { approval: true }),
  text('mobile', 'MOBILE_NO', 35, 'Mobile', 'contacts', { format: 'mobile', approval: true }),
  text('fax', 'FAX_NO', 35, 'Fax', 'contacts'),
  // CUSTOMER_INFO.EMAIL is 35 on the XE test server (widened to 100 only in production, SCHEMA §2.5)
  text('email', 'EMAIL', 35, 'E-mail 1', 'contacts', { format: 'email', approval: true }),
  text('email2', 'EMAIL2', 100, 'E-mail 2', 'contacts', { format: 'email', approval: true }),
  text('whatsappNo', 'WHATSAPP_NO', 15, 'WhatsApp', 'contacts', {
    format: 'whatsapp',
    approval: true,
  }),
  yesNo('notifySms', 'NOTIFY_SMS', 'Send SMS', 'contacts'),
  yesNo('notifyWa', 'NOTIFY_WA', 'Send WhatsApp', 'contacts'),
  yesNo('notifyEmail', 'NOTIFY_EMAIL', 'Send e-mail', 'contacts'),

  {
    name: 'customerGroup',
    col: 'CUSTOMER_GROUP',
    kind: 'int',
    label: 'Customer group (legacy no.)',
    tab: 'group',
  },
  text('masterCode', 'MCODE', 7, 'Master account (group)', 'group', { upper: true }),
  text('crossRef', 'CROSS_REF', 11, 'Linked customer code', 'group', { upper: true }),
]);

const FIELD_DEF = { key: [], fields: CUSTOMER_FIELDS };

/** Create body: fields + where the customer sits (geography decides the code, BR-CUS-03). */
export const zCustomerCreate = masterBodySchema(FIELD_DEF, 'update').extend({
  geoCode: z.string().trim().max(50),
  // customer zone (ZONE_DESC); default = the geography zone when ZONE_DESC has it (Hattar)
  zoneCode: z
    .string()
    .trim()
    .max(10)
    .nullable()
    .optional()
    .transform((v) => v || null),
});
/** Update body: only the fields that changed. */
export const zCustomerPatch = masterBodySchema(FIELD_DEF, 'patch');

/**
 * Customer status. Legacy rows have no DOC_STATUS: they traded in the old system, so they count as
 * APPROVED unless closed (decision 20 Nov 2026, BRD log).
 */
export function customerStatus({ docStatus, closed }) {
  if (docStatus) return docStatus;
  return closed === 'Y' ? 'CLOSED' : 'APPROVED';
}

/**
 * BR-CUS-01 / BR-CUS-08: may a new SRF, OC, permit or DO be raised?
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canTrade({ status, active }) {
  if (status === 'BLOCKED') return { ok: false, reason: 'Customer is blocked' };
  if (status === 'CLOSED') return { ok: false, reason: 'Customer account is closed' };
  if (status !== 'APPROVED') return { ok: false, reason: 'Customer is not approved yet' };
  if (active === false) return { ok: false, reason: 'Customer is inactive' };
  return { ok: true };
}

const pad2 = (code, what) => {
  const c = String(code);
  if (!/^[A-Z0-9]{1,2}$/.test(c))
    throw new Error(`${what} code ${c} cannot be used in a customer code`);
  return c.padStart(2, '0');
};

/**
 * BR-CUS-03 customer code prefix (decision 20 Nov 2026): `Z-TT-AA-` for a one-character zone,
 * `ZZTT-AA-` for a two-character zone (the legacy Hattar form, e.g. 1001-21-001), so every code is
 * 11 characters (CUSTOMER_INFO.CUSTOMER_CODE VARCHAR2(11)). The channel is a field, not part of the code.
 * @param {{ zone: string, territory: string, area: string }} g geography codes (area level or deeper)
 */
export function customerCodePrefix({ zone, territory, area }) {
  const z1 = String(zone);
  if (!/^[A-Z0-9]{1,2}$/.test(z1))
    throw new Error(`Zone code ${z1} cannot be used in a customer code`);
  const t = pad2(territory, 'Territory');
  const a = pad2(area, 'Area');
  return z1.length === 1 ? `${z1}-${t}-${a}-` : `${z1}${t}-${a}-`;
}

/** Code for sequence `n` (1–999) under a prefix. */
export function customerCode(prefix, n) {
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new Error(`No customer number left under ${prefix} (max 999)`);
  }
  return `${prefix}${String(n).padStart(3, '0')}`;
}

/** Next sequence after the existing codes that share the prefix (non-numeric tails ignored). */
export function nextCustomerSeq(prefix, existingCodes) {
  let max = 0;
  for (const c of existingCodes) {
    if (!c.startsWith(prefix)) continue;
    const tail = c.slice(prefix.length);
    if (/^\d{1,3}$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return max + 1;
}

/** Fields of a patch that need approval on an approved customer (BR-CUS-02). */
export function approvalFieldsIn(patch) {
  return CUSTOMER_FIELDS.filter((f) => f.approval && f.name in patch).map((f) => f.name);
}
