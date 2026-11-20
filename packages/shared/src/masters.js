// Simple master registry (TASKS P1-01, API_SPEC §4, PRD 4.3). One description per master drives the
// API (SQL column allow-list, validation) and the web (list columns, forms). Masters are
// deactivated, never deleted (BUSINESS_RULES §1). Every master is per branch (key starts with BRNCH).
import { z } from 'zod';

/**
 * @typedef {'text'|'int'|'decimal'|'flag01'|'enum'|'ref'|'date'} FieldKind
 * @typedef {{
 *   name: string, col: string, kind: FieldKind, label: string,
 *   max?: number, required?: boolean, upper?: boolean, options?: {value: string, label: string}[],
 *   ref?: string, auto?: boolean, list?: boolean, scale?: number, hint?: string
 * }} MasterField
 * @typedef {{
 *   type: string, table: string, title: string, singular: string, group: string,
 *   key: MasterField[], fields: MasterField[], labelField: string, orderBy: string,
 *   readOnly?: boolean, hasActive: boolean, note?: string
 * }} MasterDef
 */

const code = (name, col, max, label = 'Code') => ({
  name,
  col,
  kind: 'text',
  label,
  max,
  required: true,
  upper: true,
  list: true,
});
const autoInt = (name, col, label = 'Code') => ({
  name,
  col,
  kind: 'int',
  label,
  auto: true,
  list: true,
});
const text = (name, col, max, label, extra = {}) => ({
  name,
  col,
  kind: 'text',
  label,
  max,
  ...extra,
});
const int = (name, col, label, extra = {}) => ({ name, col, kind: 'int', label, ...extra });

/** Report R7 groups (REQUIREMENTS_SPEC R7: "from the channel's report group"). */
export const CHANNEL_REPORT_GROUPS = [
  { value: 'DEALER', label: 'Dealer' },
  { value: 'DIRECT_INST', label: 'Direct / Institution' },
  { value: 'DEALER_INST', label: 'Dealer Institution' },
  { value: 'DISTRIBUTOR', label: 'Distributor' },
];

/** @type {MasterDef[]} */
const DEFS = [
  {
    type: 'product-groups',
    table: 'GROUP_MST',
    title: 'Product groups',
    singular: 'Product group',
    group: 'Products',
    key: [autoInt('grpId', 'GRP_ID', 'Group id')],
    fields: [
      text('name', 'NAME', 255, 'Name', { required: true, list: true }),
      int('sortOrder', 'ORD_BY', 'Sort order', { list: true }),
    ],
    labelField: 'name',
    orderBy: 'ORD_BY, GRP_ID',
  },
  {
    type: 'product-types',
    table: 'PRODUCT_TYPE',
    title: 'Product types',
    singular: 'Product type',
    group: 'Products',
    key: [code('prodId', 'PROD_ID', 20, 'Type code')],
    fields: [
      text('name', 'NAME', 255, 'Name', { required: true, list: true }),
      {
        name: 'groupId',
        col: 'GRP_ID_FK',
        kind: 'ref',
        ref: 'product-groups',
        label: 'Product group',
        list: true,
      },
      int('sortOrder', 'ORD_BY', 'Sort order', { list: true }),
    ],
    labelField: 'name',
    orderBy: 'ORD_BY, PROD_ID',
  },
  {
    type: 'product-periods',
    table: 'PRODUCT_DESC_T',
    title: 'Products & periods',
    singular: 'Product period',
    group: 'Products',
    readOnly: true,
    note: 'Effective period = highest period number with Date from on or before the date (BR-TAX-10). New periods are entered with tax-rate changes (P1-05, approval RATE_CHANGE).',
    key: [
      code('productCode', 'PRODUCT_CODE', 4, 'Product'),
      { name: 'period', col: 'PERIOD#', kind: 'int', label: 'Period', required: true, list: true },
    ],
    fields: [
      text('productName', 'PRODUCT_NAME', 60, 'Product name', { required: true, list: true }),
      {
        name: 'packType',
        col: 'PRODUCT_TYPE',
        kind: 'ref',
        ref: 'product-types',
        label: 'Product type',
        list: true,
      },
      { name: 'dateFrom', col: 'DATE_FROM', kind: 'date', label: 'Date from', list: true },
      { name: 'dateTo', col: 'DATE_TO', kind: 'date', label: 'Date to (not used, BR-TAX-10)' },
      {
        name: 'mrp',
        col: 'CODE',
        kind: 'decimal',
        scale: 2,
        label: 'MRP per ton (tax incl.)',
        list: true,
      },
      {
        name: 'retailPrice',
        col: 'R_PRICE',
        kind: 'decimal',
        scale: 2,
        label: 'Retail price per ton (excl. ST)',
      },
      {
        name: 'companyPrice',
        col: 'COMPANY_PRICE',
        kind: 'decimal',
        scale: 2,
        label: 'Company price per ton',
      },
      {
        name: 'fedPerTon',
        col: 'CED',
        kind: 'decimal',
        scale: 2,
        label: 'FED per ton (BR-TAX-03)',
        list: true,
      },
      {
        name: 'salesTaxPer',
        col: 'P_SALES_TAX_PER',
        kind: 'decimal',
        scale: 2,
        label: 'Sales tax % (BR-TAX-02)',
        list: true,
      },
      {
        name: 'salesTaxAmt',
        col: 'P_SALES_TAX',
        kind: 'decimal',
        scale: 2,
        label: 'Sales tax per ton',
      },
      {
        name: 'avgRate',
        col: 'AVG_RATE',
        kind: 'decimal',
        scale: 2,
        label: 'Average rate (legacy)',
      },
      text('status', 'STATUS', 1, 'Legacy status (O/C)'),
      { name: 'brand', col: 'BRAND', kind: 'ref', ref: 'brands', label: 'Brand' },
      text('hsCode', 'HSCODE', 9, 'HS code'),
    ],
    labelField: 'productName',
    orderBy: 'PRODUCT_CODE, PERIOD# DESC',
  },
  {
    type: 'brands',
    table: 'PROD_BRAND',
    title: 'Brands',
    singular: 'Brand',
    group: 'Products',
    key: [code('brand', 'BRAND', 4, 'Brand code')],
    fields: [text('description', 'DESCR', 100, 'Description', { required: true, list: true })],
    labelField: 'description',
    orderBy: 'BRAND',
  },
  {
    type: 'do-types',
    table: 'DELIVERY_ORDER_TYPE',
    title: 'DO types',
    singular: 'DO type',
    group: 'Orders',
    key: [code('doCode', 'DO_CODE', 10, 'DO code')],
    fields: [
      text('description', 'DO_DESC', 60, 'Description', { required: true, list: true }),
      {
        name: 'productCode',
        col: 'PRODUCT_CODE',
        kind: 'ref',
        ref: 'product-codes',
        label: 'Product',
        required: true,
        list: true,
      },
      text('doType', 'DO_TYPE', 2, 'DO kind', { upper: true }),
      int('code', 'CODE', 'Number code', { auto: true, list: true }),
      text('mgroup', 'MGROUP', 100, 'Report group'),
    ],
    labelField: 'description',
    orderBy: 'DO_CODE',
  },
  {
    type: 'bags',
    table: 'BAG',
    title: 'Bags',
    singular: 'Bag',
    group: 'Products',
    key: [autoInt('bagCode', 'BAG_CD', 'Bag code')],
    fields: [
      text('description', 'BAG_DESC', 200, 'Description', { required: true, list: true }),
      text('productId', 'PRODID', 6, 'Product', { upper: true, list: true }),
    ],
    labelField: 'description',
    orderBy: 'BAG_CD',
  },
  {
    type: 'bag-colours',
    table: 'BAGS_COLOR',
    title: 'Bag colours',
    singular: 'Bag colour',
    group: 'Products',
    key: [autoInt('color', 'COLOR', 'Colour code')],
    fields: [text('description', 'DESCR', 100, 'Description', { required: true, list: true })],
    labelField: 'description',
    orderBy: 'COLOR',
  },
  {
    type: 'channels',
    table: 'CHANNEL_DESC',
    title: 'Channels',
    singular: 'Channel',
    group: 'Customers',
    key: [code('channelCode', 'CHANNEL_CODE', 3, 'Channel code')],
    fields: [
      text('description', 'CHANNEL_DESC', 60, 'Description', { required: true, list: true }),
      {
        name: 'reportGroup',
        col: 'REPORT_GROUP',
        kind: 'enum',
        options: CHANNEL_REPORT_GROUPS,
        label: 'Report group (R7)',
        list: true,
      },
      int('sortOrder', 'SORT_BY', 'Sort order', { list: true }),
      int('legacyGroup', 'GRP', 'Legacy group no.'),
    ],
    labelField: 'description',
    orderBy: 'SORT_BY, CHANNEL_CODE',
  },
  {
    type: 'categories',
    table: 'CATEGORY_TYPE',
    title: 'Customer categories',
    singular: 'Category',
    group: 'Customers',
    key: [code('catCode', 'CAT_CODE', 3)],
    fields: [text('description', 'CAT_DESC', 60, 'Description', { required: true, list: true })],
    labelField: 'description',
    orderBy: 'CAT_CODE',
  },
  {
    type: 'regions',
    table: 'REGION',
    title: 'Regions',
    singular: 'Region',
    group: 'Customers',
    key: [code('region', 'REGION', 3, 'Region code')],
    fields: [text('description', 'DESCRIPTION', 35, 'Description', { required: true, list: true })],
    labelField: 'description',
    orderBy: 'REGION',
  },
  {
    type: 'credit-types',
    table: 'CREDIT_TYPE',
    title: 'Credit types',
    singular: 'Credit type',
    group: 'Customers',
    key: [code('creditCode', 'CREDIT_CODE', 3, 'Credit code')],
    fields: [
      text('description', 'CREDIT_DESC', 40, 'Description', { required: true, list: true }),
      int('legacyType', 'TYPE', 'Legacy type no.'),
    ],
    labelField: 'description',
    orderBy: 'CREDIT_CODE',
  },
  {
    type: 'banks',
    table: 'BANK_DESC',
    title: 'Banks',
    singular: 'Bank',
    group: 'Banks',
    key: [code('bankCode', 'BANK_CODE', 4, 'Bank code')],
    fields: [
      text('name', 'BANK_NAME', 60, 'Bank name', { required: true, list: true }),
      text('bankType', 'BANK_TYPE', 3, 'Bank type', { required: true, upper: true, list: true }),
      text('glAccount', 'ACC_ID', 8, 'GL account'),
    ],
    labelField: 'name',
    orderBy: 'BANK_CODE',
  },
  {
    type: 'company-banks',
    table: 'COMPANY_BANK',
    title: 'Company bank accounts',
    singular: 'Company bank account',
    group: 'Banks',
    key: [code('bankCode', 'BANK_CODE', 6, 'Account code')],
    fields: [
      text('name', 'BANK_DESC', 40, 'Bank', { required: true, list: true }),
      text('branchName', 'BRANCH_NAME', 30, 'Bank branch', { required: true, list: true }),
      text('account', 'ACCOUNT', 20, 'Account no.', { required: true, list: true }),
      text('shortCode', 'ABBR', 6, 'Short code (R4)', { upper: true, list: true }),
      { name: 'isDefault', col: 'DEF', kind: 'flag01', label: 'Default account' },
      {
        name: 'returnCharges',
        col: 'RETURN_CHARGES',
        kind: 'decimal',
        scale: 2,
        label: 'Cheque return charges',
      },
      text('glAccount', 'ACC_ID', 8, 'GL account'),
    ],
    labelField: 'name',
    orderBy: 'BANK_CODE',
  },
  {
    type: 'instruments',
    table: 'INSTRUMENT_TYPE',
    title: 'Instruments',
    singular: 'Instrument',
    group: 'Banks',
    key: [code('instCode', 'INST_CODE', 3)],
    fields: [text('description', 'INST_DESC', 60, 'Description', { required: true, list: true })],
    labelField: 'description',
    orderBy: 'INST_CODE',
  },
  {
    type: 'transporters',
    table: 'TRANSPORTER_DESC',
    title: 'Transporters',
    singular: 'Transporter',
    group: 'Transport',
    key: [code('transpCode', 'TRANSP_CODE', 3, 'Transporter code')],
    fields: [
      text('name', 'TRANSP_NAME', 60, 'Name', { required: true, list: true }),
      text('phone', 'PHONE', 25, 'Phone', { list: true }),
      text('fax', 'FAX', 25, 'Fax'),
      text('address1', 'ADDRESS1', 40, 'Address line 1'),
      text('address2', 'ADDRESS', 40, 'Address line 2'),
      text('email', 'EMAIL', 50, 'E-mail'),
    ],
    labelField: 'name',
    orderBy: 'TRANSP_CODE',
  },
  {
    type: 'transport-modes',
    table: 'MODE_OF_TRANSPORT',
    title: 'Modes of transport',
    singular: 'Mode of transport',
    group: 'Transport',
    key: [code('modeCode', 'MODE_CODE', 3)],
    fields: [text('name', 'MODE_NAME', 60, 'Name', { required: true, list: true })],
    labelField: 'name',
    orderBy: 'MODE_CODE',
  },
  {
    type: 'note-types',
    table: 'CREDIT_NOTE_TYPE',
    title: 'Credit/debit note types',
    singular: 'Note type',
    group: 'Accounts',
    key: [code('code', 'CODE', 3)],
    fields: [text('description', 'DESCRIPTION', 16, 'Description', { required: true, list: true })],
    labelField: 'description',
    orderBy: 'CODE',
  },
].map((d) => ({ hasActive: !d.readOnly, ...d }));

/** @type {Record<string, MasterDef>} */
export const MASTERS = Object.freeze(Object.fromEntries(DEFS.map((d) => [d.type, d])));
export const MASTER_TYPES = Object.freeze(DEFS.map((d) => d.type));

/** Lookup lists that are not masters themselves. */
export const DERIVED_LOOKUPS = Object.freeze(['product-codes']);

/** Separator of composite keys in URLs (`/masters/product-periods/1/OPC~57`). */
export const KEY_SEP = '~';

/** @param {MasterDef} def @param {Record<string, unknown>} row API row → URL key */
export const masterKeyOf = (def, row) => def.key.map((k) => String(row[k.name])).join(KEY_SEP);

/**
 * Parse a URL key into key field values (validated by kind).
 * @param {MasterDef} def
 * @param {string} raw
 * @returns {Record<string, string|number>|null} null when malformed
 */
export function parseMasterKey(def, raw) {
  const parts = String(raw).split(KEY_SEP);
  if (parts.length !== def.key.length) return null;
  /** @type {Record<string, string|number>} */
  const out = {};
  for (const [i, k] of def.key.entries()) {
    const p = parts[i];
    if (k.kind === 'int') {
      if (!/^-?\d{1,9}$/.test(p)) return null;
      out[k.name] = Number(p);
    } else {
      if (!p || p.length > (k.max ?? 30)) return null;
      out[k.name] = p;
    }
  }
  return out;
}

const KEY_TEXT = /^[A-Za-z0-9_./&-]+$/;

/** Zod schema for one field value as sent by the client. */
function fieldSchema(f, { forKey = false } = {}) {
  let s;
  switch (f.kind) {
    case 'text':
    case 'ref':
    case 'enum': {
      let t = z
        .string()
        .trim()
        .max(f.max ?? 30);
      if (forKey) t = t.min(1).regex(KEY_TEXT, 'Use letters, digits and - _ . / & only');
      if (f.upper || forKey) t = t.toUpperCase();
      if (f.kind === 'enum') {
        const values = f.options.map((o) => o.value);
        s = z.enum(/** @type {[string, ...string[]]} */ (values));
      } else s = t;
      break;
    }
    case 'int':
      s = z.coerce.number().int().min(0).max(999999999);
      break;
    case 'decimal':
      s = z
        .string()
        .trim()
        .regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${f.scale ?? 2}})?$`), 'Enter a number');
      break;
    case 'flag01':
      s = z.boolean();
      break;
    case 'date':
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
      break;
    default:
      throw new Error(`Unknown field kind ${f.kind}`);
  }
  return s;
}

/** Empty strings from forms mean "no value". */
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

/**
 * Body schema for create (key + fields) or update (fields only).
 * @param {MasterDef} def
 * @param {'create'|'update'} mode
 */
export function masterBodySchema(def, mode) {
  /** @type {Record<string, z.ZodTypeAny>} */
  const shape = {};
  if (mode === 'create') {
    for (const k of def.key) {
      const base = fieldSchema(k, { forKey: true });
      shape[k.name] = k.auto
        ? z.preprocess(emptyToNull, base.nullable().optional())
        : z.preprocess(emptyToNull, base);
    }
  }
  for (const f of def.fields) {
    const base = fieldSchema(f);
    shape[f.name] =
      f.required && !(f.auto && mode === 'create')
        ? z.preprocess(emptyToNull, base)
        : z.preprocess(emptyToNull, base.nullable().optional());
  }
  return z.object(shape);
}
