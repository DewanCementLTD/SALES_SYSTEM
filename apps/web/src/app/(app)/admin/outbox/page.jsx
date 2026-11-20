'use client';

// Outbox & jobs (TASKS P0-13): notifications and background jobs, failures stay visible.
import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const columns = [
  { accessorKey: 'outboxId', header: '#', meta: { className: 'num' } },
  { accessorKey: 'createdOn', header: 'Created', cell: ({ getValue }) => fmtDateTime(getValue()) },
  { accessorKey: 'eventType', header: 'Event' },
  { accessorKey: 'channel', header: 'Channel' },
  { accessorKey: 'aggregateKey', header: 'Document', cell: ({ getValue }) => getValue() ?? '—' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => <StatusBadge status={getValue()} />,
  },
  { accessorKey: 'tries', header: 'Tries', meta: { className: 'num' } },
  {
    accessorKey: 'lastError',
    header: 'Last error',
    cell: ({ getValue }) => (
      <span className="line-clamp-1 max-w-sm text-danger">{getValue() ?? ''}</span>
    ),
  },
];

export default function OutboxPage() {
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault('all'));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const params = { status: status === 'all' ? undefined : status, page, pageSize: 50 };
  const list = useQuery({
    queryKey: qk.outbox(params),
    queryFn: () => api(`/admin/outbox${qs(params)}`),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader
        icon={Send}
        title="Outbox & jobs"
        subtitle="Dealer notifications and background jobs. Failed and dead items need attention."
        crumbs={[{ label: 'Admin' }, { label: 'Outbox' }]}
      />
      <Section>
        <Tabs
          value={status}
          onValueChange={(v) => {
            setStatus(v === 'all' ? null : v);
            setPage(1);
          }}
          className="mb-4"
        >
          <TabsList>
            {['all', 'PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD'].map((s) => (
              <TabsTrigger key={s} value={s}>
                {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={setPage}
          rowKey={(r) => r.outboxId}
          empty="Nothing here."
        />
      </Section>
    </>
  );
}
