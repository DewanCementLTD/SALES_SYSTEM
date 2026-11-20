'use client';

// City rate sheets for permit clients (TASKS P1-07, BR-PRC-02/05): new sheet = copy of the previous
// one; lines edited while OPEN (BR-PRC-05 chain recalculated by the API); Set MRP per product;
// submit → approval (RATE_CHANGE) in Approvals. Permits use the latest APPROVED sheet.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Map, Plus, Send } from 'lucide-react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const TONE = { OPEN: 'info', PENDING_APPROVAL: 'warning', APPROVED: 'success' };
const badge = (s) => (
  <StatusBadge tone={TONE[s] ?? 'neutral'}>{s.replace('_', ' ').toLowerCase()}</StatusBadge>
);
const EDITABLE = ['booking', 'freight', 'rebate', 'tax236'];
const COLS = [
  ['booking', 'Booking'],
  ['freight', 'Freight'],
  ['netBook', 'Net booking'],
  ['rebate', 'Rebate'],
  ['exFactory', 'Ex-factory'],
  ['tax236', 'Tax 236'],
  ['fed', 'FED'],
  ['salesTax', 'Sales tax'],
  ['netRet', 'Net retention'],
  ['mrp', 'MRP'],
];

function Cell({ line, k, editable, onSave }) {
  const [v, setV] = useState(line[k] ?? '');
  if (!editable) return <span className="tabular-nums">{line[k] ?? '—'}</span>;
  return (
    <Input
      value={v}
      inputMode="decimal"
      aria-label={`${k} ${line.city ?? line.areaDoc}`}
      className="h-8 w-24 text-right tabular-nums"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== (line[k] ?? '') && v !== '') onSave({ [k]: v });
      }}
    />
  );
}

function SheetView({ brnch, serno }) {
  const s = useSession();
  const qc = useQueryClient();
  const key = ['pricing', 'rate-sheet', brnch, serno];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api(`/pricing/rate-sheets/${brnch}/${serno}`),
  });
  const sheet = q.data;
  const editable = sheet?.status === 'OPEN' && s.can('pricing.create') && brnch === s.branch;
  const base = `/pricing/rate-sheets/${brnch}/${serno}`;
  const saveLine = useMutation({
    mutationFn: ({ lnkno, patch }) => api(`${base}/lines/${lnkno}`, { method: 'PUT', body: patch }),
    onSuccess: (line) =>
      qc.setQueryData(key, (old) => ({
        ...old,
        lines: old.lines.map((l) => (l.lnkno === line.lnkno ? { ...l, ...line } : l)),
      })),
    onError: (e) => toast.error(e.message),
  });
  const [mrp, setMrp] = useState({ productCode: '', mrp: '' });
  const setAll = useMutation({
    mutationFn: () => api(`${base}/set-mrp`, { method: 'POST', body: mrp }),
    onSuccess: (r) => {
      toast.success(`MRP set on ${r.updated} lines`);
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const submit = useMutation({
    mutationFn: () => api(`${base}/submit`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast.success(r.requestId ? 'Sent for approval' : 'Approved');
      qc.invalidateQueries({ queryKey: ['pricing'] });
    },
    onError: (e) => toast.error(e.message),
  });
  if (q.isLoading) return <Loader2 className="mx-auto size-5 animate-spin" aria-label="Loading" />;
  if (!sheet) return <ProblemAlert error={q.error} />;
  const products = [...new Set(sheet.lines.map((l) => l.productCode))];
  const columns = [
    { id: 'p', header: 'Product', cell: ({ row }) => row.original.productCode },
    {
      id: 'city',
      header: 'City',
      cell: ({ row }) =>
        row.original.city ??
        `${row.original.zone}/${row.original.territory}/${row.original.areaDoc}`,
    },
    ...COLS.map(([k, h]) => ({
      id: k,
      header: h,
      meta: { className: cn('text-right', !EDITABLE.includes(k) && 'bg-secondary/40') },
      cell: ({ row }) => (
        <Cell
          key={`${row.original.lnkno}-${row.original[k]}`}
          line={row.original}
          k={k}
          editable={editable && EDITABLE.includes(k)}
          onSave={(patch) => saveLine.mutate({ lnkno: row.original.lnkno, patch })}
        />
      ),
    })),
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-brand-navy">
          Sheet {sheet.serno} · {fmtDate(sheet.date)}
        </h2>
        {badge(sheet.status)}
        <span className="text-sm text-muted-foreground">{sheet.lines.length} lines</span>
        <div className="flex-1" />
        {editable && (
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            <Send className="size-4" /> Submit for approval
          </Button>
        )}
      </div>
      {editable && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border bg-secondary/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setAll.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="mrp-product">Product</Label>
            <select
              id="mrp-product"
              className="h-9 rounded-md border bg-card px-2 text-sm"
              value={mrp.productCode}
              onChange={(e) => setMrp({ ...mrp, productCode: e.target.value })}
            >
              <option value="">Select…</option>
              {products.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mrp-value">MRP / ton</Label>
            <Input
              id="mrp-value"
              inputMode="decimal"
              className="w-32"
              value={mrp.mrp}
              onChange={(e) => setMrp({ ...mrp, mrp: e.target.value })}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={!mrp.productCode || !mrp.mrp || setAll.isPending}
          >
            Set MRP for all lines
          </Button>
          <ProblemAlert error={setAll.error} />
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Booking − freight = net booking; − rebate = ex-factory; − tax 236 − FED − sales tax = net
        retention (BR-PRC-05). FED and sales tax % come from the product period on the sheet date;
        sales tax = the tax inside the MRP.
      </p>
      <DataTable columns={columns} data={sheet.lines} rowKey={(l) => l.lnkno} />
    </div>
  );
}

export default function RateSheetsPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [sel, setSel] = useQueryState('sheet', parseAsInteger);
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 20 };
  const list = useQuery({
    queryKey: ['pricing', 'rate-sheets', params],
    queryFn: () => api(`/pricing/rate-sheets${qs(params)}`),
    placeholderData: (p) => p,
  });
  const [date, setDate] = useState('');
  const create = useMutation({
    mutationFn: () => api('/pricing/rate-sheets', { method: 'POST', body: { date } }),
    onSuccess: (r) => {
      toast.success(`Sheet ${r.serno} created from the previous sheet`);
      qc.invalidateQueries({ queryKey: ['pricing', 'rate-sheets'] });
      setSel(r.serno);
    },
  });
  const columns = [
    {
      id: 'no',
      header: 'No.',
      cell: ({ row }) => <span className="font-mono">{row.original.serno}</span>,
    },
    { id: 'date', header: 'Date', cell: ({ row }) => fmtDate(row.original.date) },
    { id: 'lines', header: 'Lines', cell: ({ row }) => row.original.lines },
    { id: 'st', header: 'Status', cell: ({ row }) => badge(row.original.status) },
  ];
  return (
    <>
      <PageHeader
        icon={Map}
        title="City rate sheets"
        subtitle="Permit clients: prices per product and city from the latest approved sheet on or before the permit date (BR-PRC-02)."
        crumbs={[{ label: 'Masters' }, { label: 'City rate sheets' }]}
      />
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Section title="Sheets">
          {s.can('pricing.create') && (
            <form
              className="mb-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="rs-date">New sheet date</Label>
                <Input
                  id="rs-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={!date || create.isPending}>
                {create.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}{' '}
                New
              </Button>
            </form>
          )}
          <ProblemAlert error={create.error ?? list.error} className="mb-3" />
          <DataTable
            columns={columns}
            data={list.data}
            loading={list.isLoading}
            onPageChange={setPage}
            onRowClick={(r) => setSel(r.serno)}
            rowKey={(r) => `${r.brnch}|${r.serno}`}
          />
        </Section>
        <Section>
          {sel ? (
            <SheetView key={sel} brnch={s.branch} serno={sel} />
          ) : (
            <p className="text-sm text-muted-foreground">Choose a sheet.</p>
          )}
        </Section>
      </div>
    </>
  );
}
