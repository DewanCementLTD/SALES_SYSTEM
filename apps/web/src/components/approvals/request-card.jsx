import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '@/components/common/page';
import { ago, fmtPKR, fmtQty } from '@/lib/format';

const ACRONYMS = new Set(['OC', 'DO', 'DC', 'DM', 'FBR', 'CFO', 'BRV', 'SRF', 'WHT', 'FED']);

/** CREDIT_LIMIT → "Credit limit", OC_PRICE_OVERRIDE → "OC price override" */
export const docLabel = (t) =>
  t
    .split('_')
    .map((w, i) => {
      if (ACRONYMS.has(w)) return w;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');

/** Mobile-friendly approval card (PRD 4.15): summary, amount, requester, age. */
export function RequestCard({ r }) {
  return (
    <Link
      href={`/approvals/${r.reqId}`}
      className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-ring/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-brand-navy">{docLabel(r.docType)}</span>
          <StatusBadge status={r.status} />
          {r.levels > 1 && (
            <span className="text-xs text-muted-foreground">
              level {r.currentLevel} of {r.levels}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-sm">
          <span className="font-mono text-xs">{r.docKey}</span> — {r.reason}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {r.requestedBy} · {ago(r.requestedOn)} · branch .{r.brnch}
        </div>
      </div>
      {(r.amount || r.qty) && (
        <div className="text-right">
          {r.amount && <div className="num font-semibold">PKR {fmtPKR(r.amount)}</div>}
          {r.qty && <div className="num text-sm text-muted-foreground">{fmtQty(r.qty)} t</div>}
        </div>
      )}
      <ChevronRight className="size-5 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
