'use client';

// Customer ledger (PRD Accounts, reports R1 DO-based / R13 DC-based; API_SPEC §13, TASKS P2-00):
// opening balance before the range, lines with the running amount, totals, closing balance.
// Positive = receivable; negative = advance in brackets.
import { businessDate } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { EmptyState, PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { LedgerAmount } from '@/components/customers/balance-panel';
import { CustomerPicker } from '@/components/customers/customer-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

/** First day of the fiscal year (1 July) of a YYYY-MM-DD date. */
const fyStart = (d) => {
  const [y, m] = d.split('-').map(Number);
  return `${m >= 7 ? y : y - 1}-07-01`;
};

const money = (k) => ({
  id: k,
  header: k === 'debit' ? 'Debit' : 'Credit',
  meta: { className: 'text-right' },
  cell: ({ row }) =>
    Number(row.original[k]) ? <span className="tabular-nums">{fmtPKR(row.original[k])}</span> : '',
});

const COLUMNS = [
  { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.entryDate) },
  {
    id: 'doc',
    header: 'Document',
    cell: ({ row }) => (
      <span className="whitespace-nowrap font-mono text-xs">
        {row.original.docType} {row.original.docNo}
      </span>
    ),
  },
  {
    id: 'n',
    header: 'Narration',
    cell: ({ row }) => (
      <span>
        {row.original.narration}
        {row.original.reversalOf ? (
          <span className="ml-1 text-xs text-muted-foreground">(reversal)</span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'q',
    header: 'Qty (t)',
    meta: { className: 'text-right' },
    cell: ({ row }) =>
      row.original.qtyTon ? (
        <span className="tabular-nums">{fmtQty(row.original.qtyTon)}</span>
      ) : (
        ''
      ),
  },
  money('debit'),
  money('credit'),
  {
    id: 'r',
    header: 'Balance',
    meta: { className: 'text-right' },
    cell: ({ row }) => <LedgerAmount value={row.original.running} />,
  },
];

export default function LedgerPage() {
  const s = useSession();
  const today = businessDate(new Date());
  const [brnch] = useQueryState('brnch', parseAsInteger.withDefault(s.branch));
  const [code, setCode] = useQueryState('customer', parseAsString);
  const [type, setType] = useQueryState('type', parseAsString.withDefault('DC'));
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(fyStart(today)));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(today));
  const [picked, setPicked] = useState(null);
  const params = { type, from, to };
  const q = useQuery({
    queryKey: qk.ledger(brnch, code, params),
    queryFn: () => api(`/ledger/${brnch}/${encodeURIComponent(code)}${qs(params)}`),
    enabled: !!code && !!from && !!to && from <= to,
  });
  const st = q.data;
  return (
    <>
      <PageHeader
        icon={BookOpen}
        title="Customer ledger"
        subtitle="DO based (R1: orders issued) or DC based (R13: goods dispatched). Running balance = previous + debit − credit; advances in brackets."
        crumbs={[{ label: 'Accounts' }, { label: 'Customer ledger' }]}
      />
      <Section className="mb-4">
        <div className="grid gap-3 md:grid-cols-[minmax(260px,1fr)_auto_160px_160px] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="ledger-customer">Customer</Label>
            <CustomerPicker
              id="ledger-customer"
              brnch={brnch}
              value={
                code
                  ? { customerCode: code, customerName: picked?.customerName ?? st?.customerName }
                  : null
              }
              onChange={(c) => {
                setPicked(c);
                setCode(c.customerCode);
              }}
            />
          </div>
          <Tabs value={type} onValueChange={setType}>
            <TabsList aria-label="Ledger type">
              <TabsTrigger value="DC">DC based (R13)</TabsTrigger>
              <TabsTrigger value="DO">DO based (R1)</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-1.5">
            <Label htmlFor="ledger-from">From</Label>
            <Input
              id="ledger-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ledger-to">To</Label>
            <Input id="ledger-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Section>
      <ProblemAlert error={q.error} className="mb-3" />
      {!code ? (
        <EmptyState icon={BookOpen} title="Choose a customer">
          The statement shows the opening balance on the from-date and every posting in the range.
        </EmptyState>
      ) : (
        <Section
          title={st ? `${st.customerCode} · ${st.customerName ?? ''}` : 'Statement'}
          actions={
            st && (
              <span className="text-sm text-muted-foreground">
                Opening {fmtDate(st.from)}: <LedgerAmount value={st.opening} />
              </span>
            )
          }
        >
          <DataTable
            columns={COLUMNS}
            data={st?.lines ?? []}
            loading={q.isLoading}
            rowKey={(l) => l.ledgerId}
            empty="No postings in this range."
          />
          {st && (
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-md border p-2">
                <dt className="text-muted-foreground">Total debit</dt>
                <dd className="text-right font-semibold tabular-nums">{fmtPKR(st.totals.debit)}</dd>
              </div>
              <div className="rounded-md border p-2">
                <dt className="text-muted-foreground">Total credit</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {fmtPKR(st.totals.credit)}
                </dd>
              </div>
              <div className="rounded-md border bg-secondary/50 p-2">
                <dt className="text-muted-foreground">Closing balance {fmtDate(st.to)}</dt>
                <dd className="text-right font-semibold">
                  <LedgerAmount value={st.closing} />
                </dd>
              </div>
            </dl>
          )}
        </Section>
      )}
    </>
  );
}
