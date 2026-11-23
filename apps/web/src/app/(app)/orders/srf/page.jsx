'use client';

// SRF list (PRD 4.4, TASKS P2-01): search by number / customer, status filter, newest first.
import { SRF_STATUS } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { SRF_TONE } from '@/components/orders/srf-form';
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
import { fmtDate, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export default function SrfListPage() {
  const s = useSession();
  const router = useRouter();
  const [f, setF] = useQueryStates({
    q: parseAsString.withDefault(''),
    status: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
  });
  const [q, setQ] = useState(f.q);
  const params = {
    q: f.q || undefined,
    status: f.status === 'all' ? undefined : f.status,
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.srfs(params),
    queryFn: () => api(`/srf${qs(params)}`),
    placeholderData: (p) => p,
  });
  const href = (r) => `/orders/srf/${r.brnch}/${r.srfNo}`;
  const columns = [
    {
      id: 'no',
      header: 'SRF #',
      cell: ({ row }) => (
        <Link
          href={href(row.original)}
          className="font-mono font-medium text-primary hover:underline"
        >
          {row.original.srfNo}
        </Link>
      ),
    },
    { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.srfDate) },
    {
      id: 'c',
      header: 'Customer',
      cell: ({ row }) => (
        <span>
          <span className="font-mono text-xs">{row.original.customerCode}</span>{' '}
          {row.original.customerName}
        </span>
      ),
    },
    { id: 'p', header: 'Product', cell: ({ row }) => row.original.productCode },
    {
      id: 'q',
      header: 'Qty (t)',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.qtyTon)}</span>,
    },
    { id: 'dest', header: 'Destination', cell: ({ row }) => row.original.destName ?? '—' },
    { id: 'oc', header: 'OC', cell: ({ row }) => row.original.ocNo ?? '—' },
    {
      id: 'st',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge tone={SRF_TONE[row.original.status]}>
          {row.original.status.toLowerCase()}
        </StatusBadge>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        icon={FileText}
        title="Sales Request Forms"
        subtitle="What the customer wants: product, quantity, schedule and terms. Submitting an SRF creates its draft order confirmation."
        crumbs={[{ label: 'Orders' }, { label: 'SRF' }]}
        actions={
          s.can('srf.create') && (
            <Button asChild className="bg-brand-orange hover:bg-brand-orange/90">
              <Link href="/orders/srf/new">
                <Plus className="size-4" /> New SRF
              </Link>
            </Button>
          )
        }
      />
      <Section>
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setF({ q, page: 1 });
          }}
        >
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search SRFs"
              placeholder="SRF #, customer code or name"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })}>
            <SelectTrigger className="w-44" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.keys(SRF_STATUS).map((st) => (
                <SelectItem key={st} value={st}>
                  {st.toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          onRowClick={(r) => router.push(href(r))}
          rowKey={(r) => `${r.brnch}|${r.srfNo}`}
          empty="No SRFs."
        />
      </Section>
    </>
  );
}
