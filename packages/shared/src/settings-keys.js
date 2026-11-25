// APP_SETTING keys with company defaults (SCHEMA §5). BRNCH 0 = company default; a branch row overrides.
// Open questions (BRD §8) are implemented as settings with the stated default: see `openQ`.

/**
 * @typedef {'STRING'|'NUMBER'|'BOOL'|'JSON'} ValueType
 * @typedef {{ key: string, def: string, type: ValueType, rule: string, descr: string, openQ?: string, secret?: boolean, perBranch?: boolean }} SettingDef
 */

/** @type {SettingDef[]} */
const DEFS = [
  {
    key: 'DO_RATE_LOCK_DAYS',
    def: '14',
    type: 'NUMBER',
    rule: 'BR-PRC-07',
    descr: 'Days a DO keeps its OC rate',
  },
  {
    key: 'CONTRACT_VALID_MONTHS',
    def: '3',
    type: 'NUMBER',
    rule: 'BR-SRF-07',
    descr: 'Contract Review validity (months from SRF date)',
  },
  {
    key: 'WEIGHT_TOLERANCE_KG',
    def: '100',
    type: 'NUMBER',
    rule: 'BR-WGT-05',
    descr: 'Allowed |net − planned| before exit is blocked',
    openQ: 'Q6',
  },
  {
    key: 'WEIGH_STABLE_COUNT',
    def: '5',
    type: 'NUMBER',
    rule: 'BR-WGT-01',
    descr: 'Consecutive readings for a stable weight',
  },
  {
    key: 'WEIGH_STABLE_KG',
    def: '10',
    type: 'NUMBER',
    rule: 'BR-WGT-01',
    descr: 'Max spread (kg) of stable readings',
  },
  {
    key: 'TARE_WARN_KG',
    def: '300',
    type: 'NUMBER',
    rule: 'BR-WGT-03',
    descr: 'Warn when tare differs from last tare by more',
  },
  {
    key: 'BAG_WEIGHT_KG',
    def: '50',
    type: 'NUMBER',
    rule: 'BR-GATE-06',
    descr: 'Weight of one bag',
  },
  {
    key: 'INVOICE_QTY_BASIS',
    def: 'NET_WEIGHT',
    type: 'STRING',
    rule: 'BR-INV-01',
    descr: 'NET_WEIGHT or BAGS',
    openQ: 'Q2',
  },
  {
    key: 'ALLOW_EXIT_WITHOUT_FBR',
    def: 'N',
    type: 'BOOL',
    rule: 'BR-EXIT-02',
    descr: 'Allow exit with supervisor override when FBR is pending',
    openQ: 'Q3',
  },
  {
    key: 'TEMP_TOKEN_ENABLED',
    def: 'N',
    type: 'BOOL',
    rule: 'BR-GATE-05',
    descr: 'Allow temporary tokens for trucks without DO/permit',
    openQ: 'Q4',
  },
  {
    key: 'BILTY_REQUIRED',
    def: 'Y',
    type: 'BOOL',
    rule: 'BR-GATE-02',
    descr: 'Bilty number required at gate-in',
  },
  {
    key: 'PERMIT_CFO_QTY',
    def: '',
    type: 'NUMBER',
    rule: 'BR-PMT-03',
    descr: 'Force CFO approval above this quantity (empty = off)',
  },
  {
    key: 'FURTHER_TAX_PCT',
    def: '0',
    type: 'NUMBER',
    rule: 'BR-TAX-06',
    descr: 'Further tax % for unregistered buyers',
  },
  {
    key: 'EXPORT_EXPENSE_USD_PER_TON',
    def: '7.5',
    type: 'NUMBER',
    rule: 'R12',
    descr: 'Export expense per ton (USD)',
  },
  {
    key: 'EXPORT_FX_RATE',
    def: '105.2',
    type: 'NUMBER',
    rule: 'R12',
    descr: 'USD → PKR rate for export expense',
  },
  {
    key: 'LINK_EXPIRY_DAYS',
    def: '7',
    type: 'NUMBER',
    rule: 'BR-NTF-04',
    descr: 'Shared document links expire after',
  },
  {
    key: 'NTF_MAX_TRIES',
    def: '5',
    type: 'NUMBER',
    rule: 'BR-NTF-02',
    descr: 'Max send attempts per notification',
  },
  {
    key: 'PLANT_WAIT_ALERT_MIN',
    def: '120',
    type: 'NUMBER',
    rule: 'BR-NTF-03',
    descr: 'Alert when a truck waits longer (minutes)',
  },
  {
    key: 'OFFLINE_CACHE_MIN',
    def: '5',
    type: 'NUMBER',
    rule: 'BR-OFF-02',
    descr: 'Offline document cache refresh (minutes)',
  },
  {
    key: 'MAX_FUTURE_DAYS',
    def: '366',
    type: 'NUMBER',
    rule: 'BR-DQ-01',
    descr: 'Reject dates further ahead than this',
  },
  {
    key: 'LOGIN_MAX_FAILS',
    def: '5',
    type: 'NUMBER',
    rule: 'PRD 4.1',
    descr: 'Failed logins before lockout',
  },
  {
    key: 'LOGIN_LOCK_MIN',
    def: '15',
    type: 'NUMBER',
    rule: 'PRD 4.1',
    descr: 'Lockout duration (minutes)',
  },
  {
    key: 'PWD_LIFE_DAYS',
    def: '90',
    type: 'NUMBER',
    rule: 'PRD 4.1',
    descr: 'Password expires after (days)',
  },
  {
    key: 'PWD_HISTORY',
    def: '5',
    type: 'NUMBER',
    rule: 'PRD 4.1',
    descr: 'Last N passwords cannot be reused',
  },
  {
    key: 'PWD_MIN_LENGTH',
    def: '10',
    type: 'NUMBER',
    rule: 'PRD 4.1',
    descr: 'Minimum password length',
  },
  {
    key: 'PRICE_OVERRIDE_APPROVER',
    def: 'SALES_MANAGER',
    type: 'STRING',
    rule: 'BR-OC-02',
    descr: 'Role approving OC price deviations',
    openQ: 'Q8',
  },
  {
    key: 'DC_CANCEL_AFTER_FBR',
    def: 'CREDIT_NOTE',
    type: 'STRING',
    rule: 'BR-DC-CXL-03',
    descr: 'After FBR number: block cancel, use credit note 004',
    openQ: 'Q5',
  },
  {
    key: 'FBR_ENV',
    def: 'SANDBOX',
    type: 'STRING',
    rule: 'BR-FBR-01',
    descr: 'SANDBOX or PRODUCTION',
    perBranch: true,
  },
  {
    key: 'FBR_BASE_URL',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-01',
    descr: 'FBR API base URL',
    perBranch: true,
  },
  {
    key: 'FBR_POS_ID',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-01',
    descr: 'FBR POS / registration id',
    perBranch: true,
  },
  {
    key: 'FBR_TOKEN_ENC',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-01',
    descr: 'FBR token (encrypted)',
    perBranch: true,
    secret: true,
  },
  {
    key: 'FBR_SELLER_NTN',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'Seller NTN',
    perBranch: true,
  },
  {
    key: 'FBR_SELLER_STRN',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'Seller STRN',
    perBranch: true,
  },
  {
    key: 'NOTE_TYPE_SALES_RETURN',
    def: '004',
    type: 'STRING',
    rule: 'BR-NOTE-01',
    descr:
      'Credit note type of a sales return (linked to an invoice). Karachi keeps its own codes: 006 there (migration 019)',
    openQ: 'Q5',
    perBranch: true,
  },
  {
    key: 'NOTE_TYPE_TRANSFER',
    def: '001',
    type: 'STRING',
    rule: 'BR-NOTE-04',
    descr:
      'Note type of a balance transfer (credit note to the receiving customer; 001 = ADJUSTMENTS in both branches)',
    perBranch: true,
  },
  {
    key: 'WORKER_HOST',
    def: '',
    type: 'STRING',
    rule: 'ARCHITECTURE §3',
    descr:
      'Computer name of the only PC allowed to run the background worker (prints, messages, FBR); empty = any',
  },
  {
    key: 'FBR_SELLER_NAME',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'Seller business name as registered with FBR',
    perBranch: true,
  },
  {
    key: 'FBR_SELLER_PROVINCE',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr:
      'Seller province as FBR spells it (e.g. Sindh, Khyber Pakhtunkhwa); also used for buyers without one',
    perBranch: true,
  },
  {
    key: 'FBR_SELLER_ADDRESS',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'Seller address (plant)',
    perBranch: true,
  },
  {
    key: 'FBR_SALE_TYPE',
    def: 'Goods (FED in ST mode)',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'FBR sale type of cement invoices (verify in the FBR sandbox)',
    perBranch: true,
  },
  {
    key: 'FBR_UOM',
    def: 'MT',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'FBR unit of measure for tons (verify against the FBR UoM list)',
    perBranch: true,
  },
  {
    key: 'FBR_HS_CODE',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-02',
    descr: 'HS code of cement for FBR when the invoice has none (e.g. 2523.2900, to confirm)',
    perBranch: true,
  },
  {
    key: 'FBR_SCENARIO_ID',
    def: '',
    type: 'STRING',
    rule: 'BR-FBR-01',
    descr: 'FBR sandbox scenario id (sandbox only)',
    perBranch: true,
  },
];

/** @type {Readonly<Record<string, SettingDef>>} */
export const SETTINGS = Object.freeze(
  Object.fromEntries(DEFS.map((d) => [d.key, Object.freeze(d)])),
);
export const SETTING_KEYS = Object.freeze(Object.keys(SETTINGS));

/**
 * Convert a stored string to its typed value.
 * @param {string|null|undefined} raw
 * @param {ValueType} type
 */
export function parseSettingValue(raw, type) {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (type) {
    case 'NUMBER':
      return raw; // numbers stay strings; callers use dec()/Number() as appropriate
    case 'BOOL':
      return raw === 'Y';
    case 'JSON':
      return JSON.parse(raw);
    default:
      return raw;
  }
}
