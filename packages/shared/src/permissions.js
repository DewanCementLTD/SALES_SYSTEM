// Permission keys (PERMISSIONS.md §1). The seed writes them to APP_PERMISSION; the API enforces,
// the UI only hides/disables.

const MODULE_KEYS = {
  admin: [
    'users',
    'roles',
    'settings',
    'devices',
    'templates',
    'print_texts',
    'gl_map',
    'approval_rules',
  ],
  audit: ['view'],
  masters: ['view', 'create', 'update'],
  pricing: ['view', 'create', 'approve', 'import'],
  tax: ['view', 'update', 'approve'],
  customer: [
    'view',
    'create',
    'update',
    'approve',
    'block',
    'credit_limit',
    'credit_limit_approve',
    'view_balance',
  ],
  srf: ['view', 'create', 'update', 'cancel', 'print', 'share'],
  oc: [
    'view',
    'create',
    'update',
    'review',
    'approve',
    'confirm',
    'cancel',
    'price_override',
    'balance_override',
    'print',
    'share',
  ],
  brv: ['view', 'create', 'update', 'verify', 'bounce', 'cancel', 'print', 'share'],
  permit: [
    'view',
    'create',
    'update',
    'issue',
    'send_cfo',
    'cfo_approve',
    'adjust',
    'cancel',
    'balance_override',
    'print',
    'share',
  ],
  do: ['view', 'cancel', 'adjust', 'hold_release', 'reprice', 'print', 'share', 'resend'],
  gate: ['view', 'in', 'manual_lookup', 'exit', 'abort', 'temp_token', 'exit_override'],
  weigh: ['view', 'capture', 'manual', 'override'],
  dc: ['view', 'update', 'cancel', 'print', 'share'],
  invoice: ['view', 'print', 'share', 'fbr_retry', 'fbr_view'],
  sync: ['push', 'resolve'],
  ledger: ['view', 'print', 'share', 'recon'],
  note: ['view', 'create', 'approve', 'post', 'reverse', 'transfer', 'print', 'share'],
  incentive: ['view', 'run', 'commit'],
  target: ['view', 'update'],
  report: [
    'r1',
    'r2',
    'r3',
    'r4',
    'r5',
    'r6',
    'r7',
    'r8',
    'r9',
    'r10',
    'r11',
    'r12',
    'r13',
    'merge_branches',
    'export',
    'share',
  ],
  dashboard: ['sales', 'plant', 'management'],
  approval: ['inbox'],
};

/** Actions that bypass checks or decide for others (APP_PERMISSION.IS_SENSITIVE). */
const SENSITIVE_ACTION =
  /^(approve|cancel|override|.*_override|verify|bounce|block|cfo_approve|credit_limit_approve|manual|manual_lookup|exit_override|reverse|post|commit|reprice|hold_release|adjust|temp_token|abort|users|roles|settings|devices)$/;

/** `P.oc.confirm === 'oc.confirm'` */
export const P = Object.freeze(
  Object.fromEntries(
    Object.entries(MODULE_KEYS).map(([mod, actions]) => [
      mod,
      Object.freeze(Object.fromEntries(actions.map((a) => [a, `${mod}.${a}`]))),
    ]),
  ),
);

/** @type {ReadonlyArray<{ key: string, module: string, action: string, sensitive: boolean }>} */
export const ALL_PERMISSIONS = Object.freeze(
  Object.entries(MODULE_KEYS).flatMap(([module, actions]) =>
    actions.map((action) => ({
      key: `${module}.${action}`,
      module,
      action,
      sensitive: SENSITIVE_ACTION.test(action),
    })),
  ),
);

const KEY_SET = new Set(ALL_PERMISSIONS.map((p) => p.key));

export const isPermissionKey = (k) => KEY_SET.has(k);

/**
 * Does a permission list grant `key`? Supports `module.*` wildcards (role seed shorthand).
 * @param {Iterable<string>} granted
 * @param {string} key
 */
export function hasPermission(granted, key) {
  const set = granted instanceof Set ? granted : new Set(granted);
  if (set.has(key)) return true;
  const mod = key.split('.')[0];
  return set.has(`${mod}.*`) || set.has('*');
}

/** Expand wildcards (`oc.*`, `*`) into concrete keys. */
export function expandPermissions(patterns) {
  const out = new Set();
  for (const p of patterns) {
    if (p === '*') ALL_PERMISSIONS.forEach((x) => out.add(x.key));
    else if (p.endsWith('.*')) {
      const mod = p.slice(0, -2);
      ALL_PERMISSIONS.filter((x) => x.module === mod).forEach((x) => out.add(x.key));
    } else if (KEY_SET.has(p)) out.add(p);
    else throw new Error(`Unknown permission ${p}`);
  }
  return [...out].sort();
}
