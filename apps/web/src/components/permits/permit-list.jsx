'use client';

// Permit lists (PRD 4.7): all permits, the CFO queue (PENDING_CFO) and issued permits to adjust.
import { PERMIT_STATUS } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { PERMIT_TONE } from '@/components/permits/permit-form';
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
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export const permitHref = (p) => `/permits/${p.brnch}/${p.permitNo}`;

/** @param {{ title: string, subtitle: string, crumb: string, icon: any, statuses?: string[], showNew?: boolean }} p */
export function PermitList({ title, subtitle, crumb, icon, statuses, showNew }) {
  const s = useSession();
  const router = useRouter();
  const [f, setF] = useQueryStates({
    q: parseAsString.withDefault(''),
    status: parseAsString.withDefault(statuses?.[0] ?? 'all'),
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
    queryKey: qk.permits(params),
    queryFn: () => api(`/permits${qs(params)}`),
    placeholderData: (p) => p,
  });
  const columns = [
    {
      id: 'no',
      header: 'Permit #',
      cell: ({ row }) => (
        <Link
          href={permitHref(row.original)}
          className="font-mono font-medium text-primary hover:underline"
        >
          {row.original.permitNo}
        </Link>
      ),
    },
    { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.permitDate) },
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
    { id: 'p', header: 'Product', cell: ({ row }) => row.original.productCode ?? '—' },
    {
      id: 'q',
      header: 'Qty (t)',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.qtyTon)}</span>,
    },
    {
      id: 'v',
      header: 'Value',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.value)}</span>,
    },
    {
      id: 'st',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge tone={PERMIT_TONE[row.original.status]}>
          {row.original.status.toLowerCase().replace('_', ' ')}
        </StatusBadge>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        crumbs={[{ label: 'Permits' }, { label: crumb }]}
        actions={
          showNew &&
          s.can('permit.create') && (
            <Button asChild className="bg-brand-orange hover:bg-brand-orange/90">
              <Link href="/permits/new">
                <Plus className="size-4" /> New permit
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
              aria-label="Search permits"
              placeholder="Permit #, customer"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })}>
            <SelectTrigger className="w-48" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!statuses && <SelectItem value="all">All statuses</SelectItem>}
              {(statuses ?? Object.keys(PERMIT_STATUS)).map((st) => (
                <SelectItem key={st} value={st}>
                  {st.toLowerCase().replace('_', ' ')}
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
          onRowClick={(r) => router.push(permitHref(r))}
          rowKey={(r) => `${r.brnch}|${r.permitNo}`}
          empty="No permits."
        />
      </Section>
    </>
  );
}
