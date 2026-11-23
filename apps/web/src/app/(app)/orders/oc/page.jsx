'use client';

// OC list (PRD 4.5, TASKS P2-03). OCs are created by submitting an SRF.
import { OC_STATUS } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { FileCheck2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { OC_TONE } from '@/components/orders/oc-view';
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

export default function OcListPage() {
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
    queryKey: qk.ocs(params),
    queryFn: () => api(`/oc${qs(params)}`),
    placeholderData: (p) => p,
  });
  const href = (r) => `/orders/oc/${r.brnch}/${r.ocNo}`;
  const columns = [
    {
      id: 'no',
      header: 'OC #',
      cell: ({ row }) => (
        <Link
          href={href(row.original)}
          className="font-mono font-medium text-primary hover:underline"
        >
          {row.original.ocNo}
        </Link>
      ),
    },
    { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.orderDate) },
    { id: 'srf', header: 'SRF #', cell: ({ row }) => row.original.srfNo ?? '—' },
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
        <span className="flex items-center gap-1">
          <StatusBadge tone={OC_TONE[row.original.status]}>
            {row.original.status.toLowerCase()}
          </StatusBadge>
          {row.original.priceOverride === 'Y' && <StatusBadge tone="warning">override</StatusBadge>}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        icon={FileCheck2}
        title="Order confirmations"
        subtitle="Created from submitted SRFs. Review, approve, then confirm against the customer's balance to issue the DOs."
        crumbs={[{ label: 'Orders' }, { label: 'Order confirmation' }]}
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
              aria-label="Search OCs"
              placeholder="OC #, SRF #, customer"
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
              {Object.keys(OC_STATUS).map((st) => (
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
          rowKey={(r) => `${r.brnch}|${r.ocNo}`}
          empty="No order confirmations."
        />
      </Section>
    </>
  );
}
