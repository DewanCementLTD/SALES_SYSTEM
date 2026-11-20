'use client';

// Credit limits (BR-CUS-07, TASKS P1-04): per-type limits, Credit Limit documents and their approval.
import { CREDIT_TYPES } from '@dcl/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { ProblemAlert, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';
import { useSession } from '@/lib/session';

const TONE = { PENDING_APPROVAL: 'warning', APPROVED: 'success', REJECTED: 'danger' };
const amt = (v) => (v === null || v === undefined ? '—' : fmtPKR(v));

/** Credit Limit documents with approve/reject for a checker who is not the maker. */
export function CreditDocuments({ docs, showCustomer = false, onChanged }) {
  const s = useSession();
  const decide = useMutation({
    mutationFn: ({ d, cmd }) =>
      api(`/credit-limits/${d.brnch}/${d.serno}/${cmd}`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast.success(`Document ${r.serno} ${r.status.toLowerCase()}`);
      onChanged?.();
    },
    onError: (e) => toast.error(e.message),
  });
  const canDecide = s.can('customer.credit_limit_approve');
  const columns = [
    {
      id: 'serno',
      header: 'No.',
      cell: ({ row }) => <span className="font-mono">{row.original.serno}</span>,
    },
    { id: 'date', header: 'Date', cell: ({ row }) => fmtDate(row.original.date) },
    ...(showCustomer
      ? [
          {
            id: 'customer',
            header: 'Customer',
            cell: ({ row }) => (
              <Link
                className="text-brand-teal hover:underline"
                href={`/customers/${row.original.brnch}/${row.original.customerCode}?tab=credit`}
              >
                {row.original.customerCode} {row.original.customerName ?? ''}
              </Link>
            ),
          },
        ]
      : []),
    { id: 'type', header: 'Type', cell: ({ row }) => row.original.creditType ?? '—' },
    {
      id: 'last',
      header: 'Last approved',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{amt(row.original.lastApproved)}</span>,
    },
    {
      id: 'amount',
      header: 'New limit',
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{amt(row.original.amount)}</span>
      ),
    },
    { id: 'remark', header: 'Remark', cell: ({ row }) => row.original.remark ?? '' },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge tone={TONE[row.original.status] ?? 'neutral'}>
          {row.original.status.replace('_', ' ').toLowerCase()}
        </StatusBadge>
      ),
    },
    ...(canDecide
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            cell: ({ row }) => {
              const d = row.original;
              if (d.status !== 'PENDING_APPROVAL') return null;
              if (d.createdBy === s.usrid)
                return <span className="text-xs text-muted-foreground">your request</span>;
              return (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() => decide.mutate({ d, cmd: 'approve' })}
                    disabled={decide.isPending}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-danger"
                    onClick={() => decide.mutate({ d, cmd: 'reject' })}
                    disabled={decide.isPending}
                    aria-label={`Reject document ${d.serno}`}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              );
            },
          },
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      data={docs}
      rowKey={(d) => `${d.brnch}|${d.serno}`}
      empty="No documents."
    />
  );
}

/** Customer tab: limits per type + request form + documents. */
export function CreditTab({ c }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ['customers', 'credit', c.brnch, c.customerCode];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api(`/customers/${c.brnch}/${c.customerCode}/credit-limits`),
  });
  const [v, setV] = useState({ creditType: 'A', amount: '', remark: '' });
  const req = useMutation({
    mutationFn: () =>
      api(`/customers/${c.brnch}/${c.customerCode}/credit-limits`, { method: 'POST', body: v }),
    onSuccess: (r) => {
      toast.success(`Credit Limit document ${r.document.serno} sent for approval`);
      setV({ creditType: v.creditType, amount: '', remark: '' });
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const d = q.data;
  const columns = [
    {
      id: 't',
      header: 'Type',
      cell: ({ row }) => `${row.original.creditType} · ${row.original.description}`,
    },
    ...['initial', 'current', 'availed', 'unused'].map((k) => ({
      id: k,
      header: k[0].toUpperCase() + k.slice(1),
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{amt(row.original[k])}</span>,
    })),
  ];
  return (
    <div className="space-y-5">
      <ProblemAlert error={q.error} />
      {d && !d.hasCreditLimitsRow && (
        <p className="rounded-md bg-secondary px-3 py-2 text-sm">
          No per-type limits yet. Until one is approved the customer&apos;s single credit limit
          applies: <span className="font-medium">{amt(d.legacyCreditLimit ?? '0')}</span>{' '}
          (BR-BAL-06).
        </p>
      )}
      <DataTable
        columns={columns}
        data={d?.types ?? []}
        loading={q.isLoading}
        rowKey={(r) => r.creditType}
      />
      {s.can('customer.credit_limit') && c.status !== 'CLOSED' && (
        <form
          className="grid gap-3 rounded-lg border bg-secondary/40 p-3 sm:grid-cols-[140px_180px_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            req.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cl-type">Credit type</Label>
            <Select value={v.creditType} onValueChange={(x) => setV({ ...v, creditType: x })}>
              <SelectTrigger id="cl-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDIT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t} · {d?.types.find((x) => x.creditType === t)?.description ?? ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-amount">New limit (PKR)</Label>
            <Input
              id="cl-amount"
              inputMode="decimal"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-remark">Remark</Label>
            <Input
              id="cl-remark"
              maxLength={200}
              value={v.remark}
              onChange={(e) => setV({ ...v, remark: e.target.value })}
            />
          </div>
          <Button type="submit" disabled={req.isPending}>
            {req.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Request
          </Button>
          <ProblemAlert error={req.error} className="sm:col-span-4" />
        </form>
      )}
      <div>
        <h3 className="mb-2 font-semibold text-brand-navy">Credit Limit documents</h3>
        <CreditDocuments
          docs={d?.documents ?? []}
          onChanged={() => qc.invalidateQueries({ queryKey: key })}
        />
      </div>
    </div>
  );
}
