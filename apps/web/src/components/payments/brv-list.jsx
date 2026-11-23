'use client';

// BRV lists (PRD 4.6): all BRVs, the verification queue (ENTERED, oldest first, verify per row),
// and the bounce / cancel work lists.
import { BRV_STATUS } from '@dcl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { BRV_TONE, VerifyDialog } from '@/components/payments/brv-form';
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
import { fmtDate, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

/**
 * @param {{ title: string, subtitle: string, crumb: string, icon: any, statuses?: string[],
 *   queue?: boolean, showNew?: boolean }} p
 */
export function BrvList({ title, subtitle, crumb, icon, statuses, queue, showNew }) {
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useQueryStates({
    q: parseAsString.withDefault(''),
    status: parseAsString.withDefault(statuses?.[0] ?? 'all'),
    page: parseAsInteger.withDefault(1),
  });
  const [q, setQ] = useState(f.q);
  const [verifying, setVerifying] = useState(null);
  const params = {
    q: f.q || undefined,
    status: queue || f.status === 'all' ? undefined : f.status,
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.brvs(queue ? 'queue' : 'list', params),
    queryFn: () => api(`/brv${queue ? '/verification-queue' : ''}${qs(params)}`),
    placeholderData: (p) => p,
  });
  const href = (r) => `/payments/brv/${r.brnch}/${r.receiptNo}`;
  const columns = [
    {
      id: 'no',
      header: 'BRV #',
      cell: ({ row }) => (
        <Link
          href={href(row.original)}
          className="font-mono font-medium text-primary hover:underline"
        >
          {row.original.receiptNo}
        </Link>
      ),
    },
    { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.brvDate) },
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
    {
      id: 'i',
      header: 'Instrument',
      cell: ({ row }) => row.original.instrument ?? row.original.instCode,
    },
    { id: 'ch', header: 'Cheque / ref', cell: ({ row }) => row.original.chequeNo ?? '—' },
    { id: 'bk', header: 'Deposited in', cell: ({ row }) => row.original.depositShort ?? '—' },
    {
      id: 'a',
      header: 'Amount',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.amount)}</span>,
    },
    {
      id: 'st',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge tone={BRV_TONE[row.original.status]}>
          {row.original.status.toLowerCase()}
        </StatusBadge>
      ),
    },
    ...(queue
      ? [
          {
            id: 'act',
            header: '',
            cell: ({ row }) => (
              <Button
                size="sm"
                variant="outline"
                aria-label={`Verify ${row.original.receiptNo}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setVerifying(row.original);
                }}
              >
                <ShieldCheck className="size-4" /> Verify
              </Button>
            ),
          },
        ]
      : []),
  ];
  const statusOptions = statuses ?? Object.keys(BRV_STATUS);
  return (
    <>
      <PageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        crumbs={[{ label: 'Payments' }, { label: crumb }]}
        actions={
          showNew &&
          s.can('brv.create') && (
            <Button asChild className="bg-brand-orange hover:bg-brand-orange/90">
              <Link href="/payments/brv/new">
                <Plus className="size-4" /> New BRV
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
              aria-label="Search BRVs"
              placeholder="BRV #, customer, cheque #"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {!queue && (
            <Select value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })}>
              <SelectTrigger className="w-44" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!statuses && <SelectItem value="all">All statuses</SelectItem>}
                {statusOptions.map((st) => (
                  <SelectItem key={st} value={st}>
                    {st.toLowerCase()}
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
          onRowClick={(r) => router.push(href(r))}
          rowKey={(r) => `${r.brnch}|${r.receiptNo}`}
          empty={queue ? 'Nothing waiting for verification.' : 'No BRVs.'}
        />
      </Section>
      <VerifyDialog
        open={!!verifying}
        onOpenChange={(o) => !o && setVerifying(null)}
        brv={verifying}
        onVerify={async (body) => {
          await api(`/brv/${verifying.brnch}/${verifying.receiptNo}/verify`, {
            method: 'POST',
            body,
            headers: { 'if-match': `"${verifying.rowVer}"` },
          });
          toast.success(`BRV ${verifying.receiptNo} verified`);
          qc.invalidateQueries({ queryKey: ['brv'] });
          qc.invalidateQueries({ queryKey: ['customers', 'balance'] });
        }}
      />
    </>
  );
}
