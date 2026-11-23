'use client';

// Customer 360 balance card (PRD 4.2, BR-BAL-05): available balance and its parts — DC ledger
// balance, open commitments by document, unused credit, today's verified collection.
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Wallet } from 'lucide-react';
import Link from 'next/link';
import { ProblemAlert, Section } from '@/components/common/page';
import { api } from '@/lib/api';
import { fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

/** Debit balance positive = receivable; negative = advance in brackets (R1/R7). */
export function LedgerAmount({ value, className }) {
  const neg = Number(value) < 0;
  return (
    <span className={cn('tabular-nums', neg && 'text-emerald-700', className)}>
      {fmtPKR(value, { brackets: true })}
    </span>
  );
}

export function BalancePanel({ brnch, code, canLedger }) {
  const q = useQuery({
    queryKey: qk.customerBalance(brnch, code),
    queryFn: () => api(`/customers/${brnch}/${code}/balance`),
  });
  const b = q.data;
  const rows = b
    ? [
        ['DC ledger balance', <LedgerAmount key="dc" value={b.dcLedgerBalance} />],
        ['DO ledger balance', <LedgerAmount key="do" value={b.doLedgerBalance} />],
        [
          'Open commitments',
          <span key="oc" className="tabular-nums">
            {fmtPKR(b.openCommitments)}
          </span>,
        ],
        [
          'Unused credit',
          <span key="uc" className="tabular-nums">
            {fmtPKR(b.unusedCredit)}
          </span>,
        ],
        [
          'Collected today',
          <span key="tc" className="tabular-nums">
            {fmtPKR(b.todayCollection.total)}
            {b.todayCollection.receipts ? ` (${b.todayCollection.receipts})` : ''}
          </span>,
        ],
      ]
    : [];
  return (
    <Section title="Balance" icon={Wallet}>
      <ProblemAlert error={q.error} />
      {b && (
        <>
          <div className="mb-3 rounded-lg bg-secondary/60 p-3 text-center">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Available balance
            </div>
            <div
              className={cn(
                'text-2xl font-semibold tabular-nums',
                Number(b.available) < 0 ? 'text-destructive' : 'text-brand-navy',
              )}
            >
              {fmtPKR(b.available, { brackets: true })}
            </div>
            <div className="text-[11px] text-muted-foreground">
              − DC ledger − open commitments + unused credit
            </div>
          </div>
          <dl className="space-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {!b.credit.hasCreditLimitsRow && (
            <p className="mt-2 text-xs text-muted-foreground">
              No credit-limit record: the customer card limit applies (BR-BAL-06).
            </p>
          )}
          {b.commitments.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {b.commitments.length} open document{b.commitments.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-1">
                {b.commitments.map((c) => (
                  <li key={`${c.kind}${c.docNo}`} className="flex justify-between gap-2">
                    <span>
                      {c.kind} {c.docNo}
                    </span>
                    <span className="tabular-nums">{fmtPKR(c.value)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {canLedger && (
            <Link
              href={`/accounts/ledger?brnch=${brnch}&customer=${encodeURIComponent(code)}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <BookOpen className="size-4" /> Open ledger
            </Link>
          )}
        </>
      )}
    </Section>
  );
}
