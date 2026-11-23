'use client';

// Cancellation advices (PRD 4.14, TASKS P2-08): order cancellation advices written when DOs / OCs
// are cancelled, receipt cancellation advices for bounced or cancelled BRVs.
import { useQuery } from '@tanstack/react-query';
import { FileX2 } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const common = [
  {
    id: 'no',
    header: 'Advice #',
    cell: ({ row }) => <span className="font-mono">{row.original.adviceNo}</span>,
  },
  { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.date) },
  {
    id: 'c',
    header: 'Customer',
    cell: ({ row }) => `${row.original.customerCode ?? ''} ${row.original.customerName ?? ''}`,
  },
];
const amount = {
  id: 'a',
  header: 'Amount',
  meta: { className: 'text-right' },
  cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.amount)}</span>,
};

export default function CancellationsPage() {
  const [f, setF] = useQueryStates({
    kind: parseAsString.withDefault('order'),
    page: parseAsInteger.withDefault(1),
  });
  const params = { kind: f.kind, page: f.page, pageSize: 50 };
  const list = useQuery({
    queryKey: qk.cancellations(params),
    queryFn: () => api(`/cancellations${qs(params)}`),
    placeholderData: (p) => p,
  });
  const columns =
    f.kind === 'order'
      ? [
          ...common,
          { id: 'l', header: 'DOs', cell: ({ row }) => row.original.lines },
          {
            id: 'q',
            header: 'Qty (t)',
            meta: { className: 'text-right' },
            cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.qtyTon)}</span>,
          },
          amount,
          { id: 'by', header: 'By', cell: ({ row }) => row.original.createdBy ?? '—' },
        ]
      : [
          ...common,
          {
            id: 'k',
            header: 'Type',
            cell: ({ row }) => (
              <StatusBadge tone={row.original.kind === 'BOUNCE' ? 'danger' : 'neutral'}>
                {row.original.kind === 'BOUNCE' ? 'cheque return' : 'cancelled'}
              </StatusBadge>
            ),
          },
          { id: 'r', header: 'Receipt', cell: ({ row }) => row.original.receiptNo ?? '—' },
          amount,
          { id: 'rem', header: 'Remarks', cell: ({ row }) => row.original.remarks ?? '' },
        ];
  return (
    <>
      <PageHeader
        icon={FileX2}
        title="Cancellation advices"
        subtitle="Written automatically when a DO or OC is cancelled, or a BRV bounces or is cancelled. The reversed value is already in the customer's ledger."
        crumbs={[{ label: 'Orders' }, { label: 'Order cancellation' }]}
      />
      <Section>
        <Tabs value={f.kind} onValueChange={(k) => setF({ kind: k, page: 1 })} className="mb-3">
          <TabsList>
            <TabsTrigger value="order">Orders (DO / OC)</TabsTrigger>
            <TabsTrigger value="receipt">Receipts (BRV)</TabsTrigger>
          </TabsList>
        </Tabs>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          rowKey={(r) => `${r.brnch}|${r.adviceNo}`}
          empty="No cancellation advices."
        />
      </Section>
    </>
  );
}
