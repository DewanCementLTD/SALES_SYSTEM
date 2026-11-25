'use client';

// Plant › Plant queue (PRD 4.9, TASKS P3-04): trucks inside the plant with their status and the
// minutes since gate-in (amber after 60, red after 120). Live: every gate-in, weighing, exit or
// cancel of the branch refreshes it over SSE (P3-10); the 15-second poll stays as fallback.
import { useQuery } from '@tanstack/react-query';
import { ListOrdered } from 'lucide-react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_TONE = {
  IN: 'info',
  TARE_DONE: 'info',
  GROSS_DONE: 'warning',
  VARIANCE_BLOCKED: 'danger',
  OVERRIDDEN: 'warning',
  INVOICED: 'success',
  TOKEN: 'neutral',
};

const columns = [
  {
    id: 'gp',
    header: 'Gate pass',
    cell: ({ row }) => <span className="font-mono">{row.original.gpId}</span>,
  },
  {
    id: 'dc',
    header: 'DC',
    cell: ({ row }) => (
      <span className="font-mono">
        {row.original.dcType} {row.original.dcNo}
      </span>
    ),
  },
  { id: 'v', header: 'Vehicle', cell: ({ row }) => row.original.vehicleNo },
  {
    id: 'c',
    header: 'Customer',
    cell: ({ row }) => `${row.original.customerCode ?? ''} ${row.original.customerName ?? ''}`,
  },
  {
    id: 'p',
    header: 'Planned (t)',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">{fmtQty((row.original.plannedKg ?? 0) / 1000)}</span>
    ),
  },
  {
    id: 's',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={STATUS_TONE[row.original.status] ?? 'neutral'}>
        {row.original.status.toLowerCase().replace(/_/g, ' ')}
      </StatusBadge>
    ),
  },
  { id: 'in', header: 'Gate-in', cell: ({ row }) => fmtDateTime(row.original.gateInOn) },
  {
    id: 'w',
    header: 'Waiting',
    meta: { className: 'text-right' },
    cell: ({ row }) => {
      const m = row.original.waitMin;
      return (
        <span
          className={cn(
            'tabular-nums font-medium',
            m >= 120 ? 'text-danger' : m >= 60 ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {m} min
        </span>
      );
    },
  },
];

export default function PlantQueuePage() {
  const q = useQuery({
    queryKey: ['plant', 'board'],
    queryFn: () => api('/plant/board'),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageHeader
        icon={ListOrdered}
        title="Plant queue"
        subtitle="Trucks inside the plant, oldest first."
        crumbs={[{ label: 'Plant' }, { label: 'Plant queue' }]}
      />
      <Section>
        <ProblemAlert error={q.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isLoading}
          rowKey={(r) => r.gpId}
          empty="No trucks inside the plant."
        />
      </Section>
    </>
  );
}
