'use client';

// DO lists (PRD 4.8): all DOs and the outstanding view (R10 live: open DOs with remaining qty).
import { DO_STATUS } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
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

export const DO_TONE = {
  ISSUED: 'info',
  PARTLY_DISPATCHED: 'warning',
  ON_HOLD: 'danger',
  DISPATCHED: 'success',
  CANCELLED: 'neutral',
};
export const doHref = (d) => `/delivery/do/${d.brnch}/${d.doType}/${d.doNo}`;

/** @param {{ title: string, subtitle: string, crumb: string, icon: any, outstanding?: boolean }} p */
export function DoList({ title, subtitle, crumb, icon, outstanding }) {
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
    outstanding: outstanding ? 'true' : undefined,
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.dos(params),
    queryFn: () => api(`/do${qs(params)}`),
    placeholderData: (p) => p,
  });
  const columns = [
    {
      id: 'no',
      header: 'DO #',
      cell: ({ row }) => (
        <Link
          href={doHref(row.original)}
          className="font-mono font-medium text-primary hover:underline"
        >
          {row.original.doNo}
        </Link>
      ),
    },
    { id: 't', header: 'Type', cell: ({ row }) => row.original.doType },
    { id: 'd', header: 'Issued', cell: ({ row }) => fmtDate(row.original.issueDate) },
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
      id: 'r',
      header: 'Remaining (t)',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.remainingTon)}</span>,
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
        <StatusBadge tone={DO_TONE[row.original.status]}>
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
        crumbs={[{ label: 'Delivery' }, { label: crumb }]}
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
              aria-label="Search DOs"
              placeholder="DO #, OC #, customer"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {!outstanding && (
            <Select value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })}>
              <SelectTrigger className="w-48" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.keys(DO_STATUS).map((st) => (
                  <SelectItem key={st} value={st}>
                    {st.toLowerCase().replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
          onRowClick={(r) => router.push(doHref(r))}
          rowKey={(r) => `${r.brnch}|${r.doType}|${r.doNo}`}
          empty={outstanding ? 'No open DOs.' : 'No DOs.'}
        />
      </Section>
    </>
  );
}
