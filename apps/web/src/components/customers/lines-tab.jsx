'use client';

// Customer line lists (P1-03): areas served, security deposits (BR-CUS-06), bank accounts.
// Lines are added and deactivated, never deleted.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { GeoPicker } from '@/components/customers/geo-picker';
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
import { fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const COLUMNS = {
  areas: [
    {
      id: 'geo',
      header: 'Area / city',
      cell: ({ row }) =>
        row.original.geoPath.length
          ? row.original.geoPath.slice(-2).join(' › ')
          : `Legacy ${row.original.legacy?.zone ?? ''}/${row.original.legacy?.territory ?? ''}/${row.original.legacy?.area ?? ''}`,
    },
    {
      id: 'code',
      header: 'Code',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.geoCode ?? '—'}</span>,
    },
  ],
  security: [
    { id: 'description', header: 'Description', cell: ({ row }) => row.original.description },
    {
      id: 'amount',
      header: 'Amount',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.amount)}</span>,
    },
  ],
  'bank-accounts': [
    {
      id: 'bank',
      header: 'Bank',
      cell: ({ row }) => `${row.original.bankCode} · ${row.original.bankName ?? ''}`,
    },
    { id: 'account', header: 'Account no.', cell: ({ row }) => row.original.accountNo },
    { id: 'branch', header: 'Bank branch', cell: ({ row }) => row.original.branchName },
  ],
};

function AddForm({ kind, brnch, onAdd, busy }) {
  const [v, setV] = useState({});
  const banks = useQuery({
    queryKey: qk.lookups(brnch, 'banks'),
    queryFn: () => api(`/lookups?types=banks&brnch=${brnch}`),
    enabled: kind === 'bank-accounts',
  });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const submit = (e) => {
    e.preventDefault();
    onAdd(v, () => setV({}));
  };
  return (
    <form onSubmit={submit} className="mb-4 rounded-lg border bg-secondary/40 p-3" noValidate>
      {kind === 'areas' && <GeoPicker value={v.geoCode ?? ''} onChange={set('geoCode')} />}
      {kind === 'security' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sd-desc">Description</Label>
            <Input
              id="sd-desc"
              maxLength={30}
              value={v.description ?? ''}
              onChange={set('description')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sd-amount">Amount (PKR)</Label>
            <Input
              id="sd-amount"
              inputMode="decimal"
              value={v.amount ?? ''}
              onChange={set('amount')}
            />
          </div>
        </div>
      )}
      {kind === 'bank-accounts' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ba-bank">Bank</Label>
            <Select value={v.bankCode ?? ''} onValueChange={set('bankCode')}>
              <SelectTrigger id="ba-bank" className="w-full">
                <SelectValue placeholder="Select bank" />
              </SelectTrigger>
              <SelectContent>
                {(banks.data?.banks ?? [])
                  .filter((b) => b.active)
                  .map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.value} · {b.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ba-acc">Account no.</Label>
            <Input
              id="ba-acc"
              maxLength={12}
              value={v.accountNo ?? ''}
              onChange={set('accountNo')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ba-branch">Bank branch</Label>
            <Input
              id="ba-branch"
              maxLength={100}
              value={v.branchName ?? ''}
              onChange={set('branchName')}
            />
          </div>
        </div>
      )}
      <Button type="submit" size="sm" className="mt-3" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
      </Button>
    </form>
  );
}

/** @param {{ c: any, kind: 'areas'|'security'|'bank-accounts', canEdit: boolean }} props */
export function LinesTab({ c, kind, canEdit }) {
  const qc = useQueryClient();
  const base = `/customers/${c.brnch}/${c.customerCode}/lines/${kind}`;
  const key = ['customers', 'lines', c.brnch, c.customerCode, kind];
  const list = useQuery({ queryKey: key, queryFn: () => api(base) });
  const setData = (d) => qc.setQueryData(key, d);
  const add = useMutation({
    mutationFn: (body) => api(base, { method: 'POST', body }),
    onSuccess: (d) => {
      setData(d);
      toast.success('Added');
    },
  });
  const toggle = useMutation({
    mutationFn: ({ line, on }) =>
      api(`${base}/${encodeURIComponent(line.key)}/${on ? 'activate' : 'deactivate'}`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: setData,
    onError: (e) => toast.error(e.message),
  });

  const columns = [
    ...COLUMNS[kind],
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge tone={row.original.active ? 'success' : 'neutral'}>
          {row.original.active ? 'Active' : 'Inactive'}
        </StatusBadge>
      ),
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            meta: { className: 'w-16 text-right' },
            cell: ({ row }) => (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => toggle.mutate({ line: row.original, on: !row.original.active })}
                aria-label={`${row.original.active ? 'Deactivate' : 'Activate'} line ${row.original.key}`}
              >
                {row.original.active ? (
                  <Ban className="size-4 text-danger" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      {canEdit && (
        <AddForm
          kind={kind}
          brnch={c.brnch}
          busy={add.isPending}
          onAdd={(body, reset) => add.mutate(body, { onSuccess: reset })}
        />
      )}
      <ProblemAlert error={add.error ?? list.error} className="mb-3" />
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        rowKey={(r) => r.key}
      />
      {kind === 'security' && list.data && (
        <p className="mt-3 text-right text-sm">
          Total security deposit (active):{' '}
          <span className="font-semibold tabular-nums">{fmtPKR(list.data.securityTotal)}</span>
        </p>
      )}
    </div>
  );
}
