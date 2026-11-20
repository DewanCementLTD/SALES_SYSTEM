'use client';

// Customer list (PRD 4.2, TASKS P1-03): search by name/code/mobile/NTN, status and channel filters.
import { CUSTOMER_STATUS } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { CustomerStatusBadge } from '@/components/customers/status';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, qs } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export default function CustomersPage() {
  const s = useSession();
  const router = useRouter();
  const [f, setF] = useQueryStates({
    q: parseAsString.withDefault(''),
    status: parseAsString.withDefault('all'),
    channel: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
  });
  const [q, setQ] = useState(f.q);
  const params = {
    q: f.q,
    status: f.status === 'all' ? undefined : f.status,
    channel: f.channel === 'all' ? undefined : f.channel,
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.customers(params),
    queryFn: () => api(`/customers${qs(params)}`),
    placeholderData: (p) => p,
  });
  const channels = useQuery({
    queryKey: qk.lookups(s.branch, 'channels'),
    queryFn: () => api('/lookups?types=channels'),
  });

  const columns = [
    {
      id: 'code',
      header: 'Code',
      cell: ({ row }) => (
        <Link
          href={`/customers/${row.original.brnch}/${row.original.customerCode}`}
          className="font-mono font-medium text-brand-teal hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.customerCode}
        </Link>
      ),
    },
    { id: 'name', header: 'Customer', cell: ({ row }) => row.original.customerName },
    {
      id: 'channel',
      header: 'Channel',
      cell: ({ row }) => row.original.channelName ?? row.original.channelCode,
    },
    {
      id: 'geo',
      header: 'Area',
      cell: ({ row }) =>
        row.original.geoPath.length ? (
          row.original.geoPath.slice(-2).join(' › ')
        ) : (
          <span className="text-muted-foreground">not placed</span>
        ),
    },
    { id: 'mobile', header: 'Mobile', cell: ({ row }) => row.original.mobile ?? '—' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <CustomerStatusBadge status={row.original.status} active={row.original.active} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        icon={Users}
        title="Customers"
        subtitle={`Customers of ${s.currentBranch?.name ?? 'this branch'}. A new customer can trade once it is approved (BR-CUS-01).`}
        crumbs={[{ label: 'Customers' }]}
        actions={
          s.can('customer.create') && (
            <Button asChild className="bg-brand-orange hover:bg-brand-orange/90">
              <Link href="/customers/new">
                <Plus className="size-4" /> New customer
              </Link>
            </Button>
          )
        }
      />
      <Section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setF({ q: q.trim(), page: 1 });
            }}
          >
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, code, mobile or NTN"
              aria-label="Search customers"
              className="w-72 pl-8"
            />
          </form>
          <Select value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })}>
            <SelectTrigger className="w-48" aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.keys(CUSTOMER_STATUS).map((st) => (
                <SelectItem key={st} value={st}>
                  {st.replace('_', ' ').toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={f.channel} onValueChange={(v) => setF({ channel: v, page: 1 })}>
            <SelectTrigger className="w-56" aria-label="Channel filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {(channels.data?.channels ?? []).map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          onRowClick={(r) => router.push(`/customers/${r.brnch}/${r.customerCode}`)}
          rowKey={(r) => `${r.brnch}|${r.customerCode}`}
          empty={f.q ? `No customer matches “${f.q}”.` : 'No customers.'}
        />
      </Section>
    </>
  );
}
