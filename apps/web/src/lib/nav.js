// Navigation = PRD §3 information architecture (user decision: follow PRD nav exactly).
// `perm`: any of these keys shows the item (PERMISSIONS P-8). `phase`: release that builds the
// screen; items of later phases open a "planned" page so the structure is visible from day one.
import {
  Banknote,
  BarChart3,
  ClipboardCheck,
  Factory,
  FileText,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';

/**
 * @typedef {{ label: string, href: string, perm?: string[], phase: string }} NavItem
 * @typedef {{ id: string, label: string, icon: any, items: NavItem[] }} NavGroup
 */

const REPORT_KEYS = Array.from({ length: 13 }, (_, i) => `report.r${i + 1}`);

/** @type {NavGroup[]} */
export const NAV = [
  {
    id: 'home',
    label: 'Home',
    icon: LayoutDashboard,
    items: [{ label: 'Dashboard', href: '/', phase: 'P0' }],
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: FileText,
    items: [
      { label: 'SRF', href: '/orders/srf', perm: ['srf.view'], phase: 'P2', built: true },
      {
        label: 'Order confirmation',
        href: '/orders/oc',
        perm: ['oc.view'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'Re-pricing',
        href: '/orders/repricing',
        perm: ['do.reprice'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'Order cancellation',
        href: '/orders/cancellations',
        perm: ['oc.cancel', 'do.cancel'],
        phase: 'P2',
        built: true,
      },
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    icon: Banknote,
    items: [
      { label: 'BRV', href: '/payments/brv', perm: ['brv.view'], phase: 'P2', built: true },
      {
        label: 'Verification queue',
        href: '/payments/verification',
        perm: ['brv.verify'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'Bounce',
        href: '/payments/bounce',
        perm: ['brv.bounce'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'BRV cancel',
        href: '/payments/cancel',
        perm: ['brv.cancel'],
        phase: 'P2',
        built: true,
      },
    ],
  },
  {
    id: 'permits',
    label: 'Permits',
    icon: ClipboardCheck,
    items: [
      {
        label: 'Permits',
        href: '/permits',
        perm: ['permit.view'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'Adjust quantity',
        href: '/permits/adjust',
        perm: ['permit.adjust'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'CFO queue',
        href: '/permits/cfo',
        perm: ['permit.cfo_approve'],
        phase: 'P2',
        built: true,
      },
    ],
  },
  {
    id: 'delivery',
    label: 'Delivery',
    icon: Truck,
    items: [
      {
        label: 'Delivery orders',
        href: '/delivery/do',
        perm: ['do.view'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'Outstanding DOs',
        href: '/delivery/outstanding',
        perm: ['do.view'],
        phase: 'P2',
        built: true,
      },
      {
        label: 'DO adjustment',
        href: '/delivery/adjustment',
        perm: ['do.adjust'],
        phase: 'P2',
        built: true,
      },
    ],
  },
  {
    id: 'plant',
    label: 'Plant',
    icon: Factory,
    items: [
      { label: 'Plant queue', href: '/plant/queue', perm: ['gate.view'], phase: 'P3', built: true },
      { label: 'Gate-in', href: '/plant/gate-in', perm: ['gate.in'], phase: 'P3', built: true },
      {
        label: 'Weighing',
        href: '/plant/weighing',
        perm: ['weigh.view'],
        phase: 'P3',
        built: true,
      },
      { label: 'Delivery challans', href: '/plant/dc', perm: ['dc.view'], phase: 'P3' },
      { label: 'Exit', href: '/plant/exit', perm: ['gate.exit'], phase: 'P3' },
      { label: 'Offline sync', href: '/plant/sync', perm: ['sync.resolve'], phase: 'P3' },
    ],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: Wallet,
    items: [
      {
        label: 'Customer ledger',
        href: '/accounts/ledger',
        perm: ['ledger.view'],
        phase: 'P3',
        built: true,
      },
      { label: 'Credit / debit notes', href: '/accounts/notes', perm: ['note.view'], phase: 'P4' },
      {
        label: 'Balance transfers',
        href: '/accounts/transfers',
        perm: ['note.transfer'],
        phase: 'P4',
      },
      {
        label: 'Incentive runs',
        href: '/accounts/incentives',
        perm: ['incentive.view'],
        phase: 'P4',
      },
      { label: 'Targets', href: '/accounts/targets', perm: ['target.view'], phase: 'P4' },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    icon: Users,
    items: [
      {
        label: 'Customers',
        href: '/customers',
        perm: ['customer.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Approval requests',
        href: '/customers/requests',
        perm: ['customer.approve'],
        phase: 'P1',
      },
      {
        label: 'Credit limits',
        href: '/customers/credit-limits',
        perm: ['customer.credit_limit', 'customer.credit_limit_approve'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Security deposits',
        href: '/customers/security',
        perm: ['customer.view'],
        phase: 'P1',
      },
      { label: 'Blocks', href: '/customers/blocks', perm: ['customer.block'], phase: 'P1' },
    ],
  },
  {
    id: 'masters',
    label: 'Masters',
    icon: Warehouse,
    items: [
      {
        label: 'Geography',
        href: '/masters/geography',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Products & periods',
        href: '/masters/products',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'DO types',
        href: '/masters/do-types',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      { label: 'Bags', href: '/masters/bags', perm: ['masters.view'], phase: 'P1', built: true },
      {
        label: 'Channels',
        href: '/masters/channels',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      { label: 'Banks', href: '/masters/banks', perm: ['masters.view'], phase: 'P1', built: true },
      {
        label: 'Instruments',
        href: '/masters/instruments',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Transporters',
        href: '/masters/transporters',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Trade prices',
        href: '/masters/trade-prices',
        perm: ['pricing.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'City rate sheets',
        href: '/masters/rate-sheets',
        perm: ['pricing.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Freight sheets',
        href: '/masters/freight',
        perm: ['pricing.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Tax rates',
        href: '/masters/tax-rates',
        perm: ['tax.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Credit types',
        href: '/masters/credit-types',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Note types',
        href: '/masters/note-types',
        perm: ['masters.view'],
        phase: 'P1',
        built: true,
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    items: [
      { label: 'Reports R1–R13', href: '/reports', perm: REPORT_KEYS, phase: 'P5' },
      { label: 'Share log', href: '/reports/share-log', perm: ['report.share'], phase: 'P5' },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: ShieldCheck,
    items: [
      { label: 'My inbox', href: '/approvals', perm: ['approval.inbox'], phase: 'P0' },
      { label: 'Sent by me', href: '/approvals/sent', phase: 'P0' },
      { label: 'Rules', href: '/approvals/rules', perm: ['admin.approval_rules'], phase: 'P0' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Settings2,
    items: [
      { label: 'Users & branch access', href: '/admin/users', perm: ['admin.users'], phase: 'P0' },
      { label: 'Roles', href: '/admin/roles', perm: ['admin.roles'], phase: 'P0' },
      { label: 'Settings', href: '/admin/settings', perm: ['admin.settings'], phase: 'P0' },
      {
        label: 'Print texts',
        href: '/admin/print-texts',
        perm: ['admin.print_texts'],
        phase: 'P1',
        built: true,
      },
      {
        label: 'Message templates',
        href: '/admin/templates',
        perm: ['admin.templates'],
        phase: 'P2',
        built: true,
      },
      { label: 'GL map', href: '/admin/gl-map', perm: ['admin.gl_map'], phase: 'P3' },
      {
        label: 'Devices',
        href: '/admin/devices',
        perm: ['admin.devices'],
        phase: 'P3',
        built: true,
      },
      { label: 'Audit log', href: '/admin/audit', perm: ['audit.view'], phase: 'P0' },
      { label: 'Outbox & jobs', href: '/admin/outbox', perm: ['admin.settings'], phase: 'P0' },
    ],
  },
];

/** Items of a later phase that are already built carry `built: true`. */
export const BUILT_PHASES = new Set(['P0']);

export const PHASE_NAMES = {
  P0: 'Foundation',
  P1: 'Masters, customers and pricing',
  P2: 'Order cycle (head office)',
  P3: 'Plant dispatch',
  P4: 'Notes, transfers, incentives',
  P5: 'Reports, sharing, dashboards',
};

/** Groups and items the user may see. */
export function visibleNav(permissions) {
  const has = (keys) => !keys || keys.some((k) => permissions.has(k));
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => has(i.perm)) })).filter(
    (g) => g.items.length,
  );
}

/** Nav item for a path (longest prefix match). */
export function navItemFor(pathname) {
  let best = null;
  for (const g of NAV) {
    for (const i of g.items) {
      const match =
        i.href === '/'
          ? pathname === '/'
          : pathname === i.href || pathname.startsWith(`${i.href}/`);
      if (match && (!best || i.href.length > best.item.href.length)) best = { group: g, item: i };
    }
  }
  return best;
}
