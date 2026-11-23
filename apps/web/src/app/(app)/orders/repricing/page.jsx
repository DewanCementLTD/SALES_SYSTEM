'use client';

// Re-pricing (PRD 4.8, BR-PRC-07/08, TASKS P2-07): new rate for a product (optionally one price
// code or customer) from a date → open DOs past their rate lock with old rate, new rate, extra and
// shortfall; apply puts the short DOs on hold.
import { businessDate } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PauseCircle, Search, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
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
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export default function RepricingPage() {
  const s = useSession();
  const [form, setForm] = useState({
    productCode: '',
    priceCode: '',
    customerCode: '',
    newRate: '',
    effectiveFrom: businessDate(new Date()),
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const products = useQuery({
    queryKey: qk.lookups(s.branch, 'product-codes'),
    queryFn: () => api('/lookups?types=product-codes'),
  });
  const body = () => ({
    productCode: form.productCode,
    newRate: form.newRate,
    effectiveFrom: form.effectiveFrom,
    ...(form.priceCode ? { priceCode: form.priceCode.toUpperCase() } : {}),
    ...(form.customerCode ? { customerCode: form.customerCode } : {}),
  });
  const run = async (what) => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'preview')
        setResult(await api('/reprice/preview', { method: 'POST', body: body() }));
      else {
        const r = await api('/reprice/apply', { method: 'POST', body: body() });
        toast.success(`${r.held.length} DO(s) put on hold; Sales is notified`);
        setResult(await api('/reprice/preview', { method: 'POST', body: body() }));
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const ready = form.productCode && /^\d+(\.\d{1,2})?$/.test(form.newRate) && form.effectiveFrom;
  const columns = [
    {
      id: 'do',
      header: 'DO #',
      cell: ({ row }) => (
        <Link
          href={`/delivery/do/${row.original.brnch}/${row.original.doType}/${row.original.doNo}`}
          className="font-mono text-primary hover:underline"
        >
          {row.original.doNo}
        </Link>
      ),
    },
    {
      id: 'c',
      header: 'Customer',
      cell: ({ row }) => `${row.original.customerCode} ${row.original.customerName ?? ''}`,
    },
    { id: 'pc', header: 'Price code', cell: ({ row }) => row.original.priceCode ?? '—' },
    { id: 'lock', header: 'Lock ended', cell: ({ row }) => fmtDate(row.original.rateLockUntil) },
    {
      id: 'q',
      header: 'Remaining (t)',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.remainingTon)}</span>,
    },
    {
      id: 'o',
      header: 'Old rate',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.oldRate)}</span>,
    },
    {
      id: 'n',
      header: 'New rate',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.newRate)}</span>,
    },
    {
      id: 'x',
      header: 'Extra',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.extra)}</span>,
    },
    {
      id: 's',
      header: 'Shortfall',
      meta: { className: 'text-right' },
      cell: ({ row }) =>
        Number(row.original.shortfall) > 0 ? (
          <StatusBadge tone="danger">{fmtPKR(row.original.shortfall)}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">covered</span>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        icon={TrendingUp}
        title="Re-pricing"
        subtitle="A new rate applies to open DOs whose 14-day rate lock has ended. DOs the customer's balance cannot cover go on hold until the difference is collected or the DO is cancelled."
        crumbs={[{ label: 'Orders' }, { label: 'Re-pricing' }]}
      />
      <Section className="mb-4">
        <div className="grid gap-3 md:grid-cols-5 md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="rp-product">Product</Label>
            <Select
              value={form.productCode}
              onValueChange={(v) => setForm({ ...form, productCode: v })}
            >
              <SelectTrigger id="rp-product" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {(products.data?.['product-codes'] ?? []).map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.value} · {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-pc">Price code (optional)</Label>
            <Input
              id="rp-pc"
              value={form.priceCode}
              onChange={(e) => setForm({ ...form, priceCode: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-cust">Customer code (optional)</Label>
            <Input
              id="rp-cust"
              value={form.customerCode}
              onChange={(e) => setForm({ ...form, customerCode: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-rate">New net rate / ton</Label>
            <Input
              id="rp-rate"
              inputMode="decimal"
              value={form.newRate}
              onChange={(e) => setForm({ ...form, newRate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-from">Effective from</Label>
            <Input
              id="rp-from"
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" disabled={!ready || !!busy} onClick={() => run('preview')}>
            {busy === 'preview' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}{' '}
            Preview
          </Button>
          {result?.toHold > 0 && s.can('do.reprice') && (
            <Button
              className="bg-brand-orange hover:bg-brand-orange/90"
              disabled={!!busy}
              onClick={() => run('apply')}
            >
              {busy === 'apply' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PauseCircle className="size-4" />
              )}
              Hold {result.toHold} DO(s) with a shortfall
            </Button>
          )}
        </div>
        <ProblemAlert error={error} className="mt-3" />
      </Section>
      {result && (
        <Section
          title={`${result.lines.length} open DO(s) past the rate lock · shortfall ${fmtPKR(result.totalShortfall)}`}
        >
          <DataTable
            columns={columns}
            data={result.lines}
            rowKey={(l) => l.key}
            empty="No open DO is past its rate lock on this date."
          />
        </Section>
      )}
    </>
  );
}
