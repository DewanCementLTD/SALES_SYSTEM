'use client';

// DO adjustment advices (PRD 4.8, BR-DO-06): quantity changes of DOs, raised from the DO screen,
// approved by the Finance Manager (DO_ADJUST), with the difference posted to the DO ledger.
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const TONE = { PENDING_APPROVAL: 'warning', APPROVED: 'success', REJECTED: 'neutral' };
const signed = (v, fmt) =>
  String(v).startsWith('-') ? `− ${fmt(String(v).slice(1))}` : `+ ${fmt(v)}`;

const columns = [
  {
    id: 'no',
    header: 'Advice #',
    cell: ({ row }) => <span className="font-mono">{row.original.adviceNo}</span>,
  },
  { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.adviceDate) },
  {
    id: 'do',
    header: 'DO #',
    cell: ({ row }) =>
      row.original.doNo && row.original.doType ? (
        <Link
          href={`/delivery/do/${row.original.brnch}/${row.original.doType}/${row.original.doNo}`}
          className="font-mono text-primary hover:underline"
        >
          {row.original.doNo}
        </Link>
      ) : (
        <span className="font-mono">{row.original.doNo ?? '—'}</span>
      ),
  },
  {
    id: 'c',
    header: 'Customer',
    cell: ({ row }) => `${row.original.customerCode} ${row.original.customerName ?? ''}`,
  },
  {
    id: 'q',
    header: 'Qty (t)',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">{signed(row.original.deltaTon, fmtQty)}</span>
    ),
  },
  {
    id: 'a',
    header: 'Amount',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">{signed(row.original.deltaValue, fmtPKR)}</span>
    ),
  },
  {
    id: 's',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={TONE[row.original.status] ?? 'neutral'}>
        {row.original.status.toLowerCase().replace('_', ' ')}
      </StatusBadge>
    ),
  },
  { id: 'r', header: 'Reason', cell: ({ row }) => row.original.reason ?? '' },
  {
    id: 'by',
    header: 'By / approved',
    cell: ({ row }) =>
      `${row.original.createdBy ?? '—'}${row.original.authorisedBy ? ` / ${row.original.authorisedBy}` : ''}`,
  },
];

export default function DoAdjustmentPage() {
  const [f, setF] = useQueryStates({
    status: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
  });
  const params = {
    ...(f.status !== 'all' ? { status: f.status } : {}),
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.doAdjustments(params),
    queryFn: () => api(`/do-adjustments${qs(params)}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        icon={Scale}
        title="DO adjustment advices"
        subtitle="Quantity changes of delivery orders. Raise one from the DO screen (Adjust quantity); the Finance Manager approves it in My approvals."
        crumbs={[{ label: 'Delivery' }, { label: 'DO adjustment' }]}
      />
      <Section>
        <Tabs value={f.status} onValueChange={(s) => setF({ status: s, page: 1 })} className="mb-3">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="PENDING_APPROVAL">Waiting for approval</TabsTrigger>
            <TabsTrigger value="APPROVED">Approved</TabsTrigger>
            <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          rowKey={(r) => `${r.brnch}|${r.year}|${r.adviceNo}`}
          empty="No DO adjustment advices."
        />
      </Section>
    </>
  );
}
