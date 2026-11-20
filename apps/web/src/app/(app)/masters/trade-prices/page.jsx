'use client';

// Trade prices for DO clients (TASKS P1-06, BR-PRC-01..06): versions per customer + product + city,
// history timeline, new version with live MRP check; approval in Approvals (RATE_CHANGE).
import { mrpViolation } from '@dcl/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, Plus, Search, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { GeoPicker } from '@/components/customers/geo-picker';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';
import { useSession } from '@/lib/session';
import { TradePriceImport } from '@/components/pricing/trade-price-import';

const TONE = { PENDING_APPROVAL: 'warning', APPROVED: 'success', REJECTED: 'danger' };
const badge = (s, active = true) => (
  <StatusBadge tone={active ? (TONE[s] ?? 'neutral') : 'neutral'}>
    {active ? s.replace('_', ' ').toLowerCase() : 'withdrawn'}
  </StatusBadge>
);
const money = (v) => (v === null || v === undefined ? '—' : fmtPKR(v));

const COLUMNS = [
  {
    id: 'code',
    header: 'Price code',
    cell: ({ row }) => <span className="font-mono">{row.original.priceCode}</span>,
  },
  { id: 'from', header: 'Effective', cell: ({ row }) => fmtDate(row.original.efDate) },
  {
    id: 'cust',
    header: 'Customer',
    cell: ({ row }) => `${row.original.customerCode ?? ''} ${row.original.customerName ?? ''}`,
  },
  { id: 'prod', header: 'Product', cell: ({ row }) => row.original.productCode },
  { id: 'city', header: 'City', cell: ({ row }) => row.original.description },
  {
    id: 'price',
    header: 'Price / ton',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">{money(row.original.invoicePrice)}</span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => badge(row.original.status, row.original.active),
  },
];

function HistoryDialog({ tp, onClose }) {
  const key = { customer: tp.customerCode, product: tp.productCode, geoCode: tp.geoCode };
  const h = useQuery({
    queryKey: ['pricing', 'history', key],
    queryFn: () => api(`/pricing/trade-prices/history${qs(key)}`),
    enabled: !!tp.geoCode,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Price history — {tp.customerCode} · {tp.productCode} · {tp.description}
          </DialogTitle>
          <DialogDescription>
            Every version is kept; a change is a new row (BR-PRC-01).
          </DialogDescription>
        </DialogHeader>
        {!tp.geoCode ? (
          <p className="text-sm text-muted-foreground">
            This legacy price has no city in the new geography; history by key is not available.
          </p>
        ) : (
          <DataTable
            columns={COLUMNS.filter((c) => !['cust', 'prod', 'city'].includes(c.id))}
            data={h.data?.items ?? []}
            loading={h.isLoading}
            rowKey={(r) => r.priceCode}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewPrice({ onDone }) {
  const [v, setV] = useState({
    customerCode: '',
    productCode: '',
    geoCode: '',
    invoicePrice: '',
    efDate: '',
    priceCodeBase: '',
  });
  const ready = v.customerCode && v.productCode && v.geoCode.split('-').length === 4 && v.efDate;
  const quote = useQuery({
    queryKey: ['pricing', 'quote', v.customerCode, v.productCode, v.geoCode, v.efDate],
    queryFn: () =>
      api(
        `/pricing/quote${qs({ customer: v.customerCode, product: v.productCode, geoCode: v.geoCode, date: v.efDate })}`,
      ),
    enabled: !!ready,
    retry: false,
  });
  const period = quote.data?.period;
  const current = quote.data?.tradePrice;
  const over = v.invoicePrice && period?.mrp ? mrpViolation(v.invoicePrice, period.mrp) : null;
  const save = useMutation({
    mutationFn: () =>
      api('/pricing/trade-prices', {
        method: 'POST',
        body: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')),
      }),
    onSuccess: (r) => {
      toast.success(`${r.tradePrice.priceCode} ${r.requestId ? 'sent for approval' : 'saved'}`);
      onDone();
    },
  });
  const set = (k) => (e) => setV({ ...v, [k]: e?.target ? e.target.value : e });
  return (
    <form
      className="space-y-3 rounded-lg border bg-secondary/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="tp-cust">Customer code</Label>
          <Input id="tp-cust" value={v.customerCode} onChange={set('customerCode')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tp-prod">Product</Label>
          <Input
            id="tp-prod"
            className="uppercase"
            maxLength={4}
            value={v.productCode}
            onChange={set('productCode')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tp-date">Effective from</Label>
          <Input id="tp-date" type="date" value={v.efDate} onChange={set('efDate')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tp-price">Price / ton (tax incl.)</Label>
          <Input
            id="tp-price"
            inputMode="decimal"
            value={v.invoicePrice}
            onChange={set('invoicePrice')}
            aria-invalid={!!over}
          />
        </div>
      </div>
      <GeoPicker value={v.geoCode} onChange={set('geoCode')} />
      {ready && (
        <div className="grid gap-2 rounded-md bg-card p-3 text-sm sm:grid-cols-5">
          {quote.isLoading && <Loader2 className="size-4 animate-spin" aria-label="Loading" />}
          {period ? (
            <>
              <div>
                MRP <b className="tabular-nums">{money(period.mrp)}</b>
              </div>
              <div>
                Sales tax <b className="tabular-nums">{money(period.salesTaxAmt)}</b>
              </div>
              <div>
                FED <b className="tabular-nums">{money(period.fedPerTon)}</b>
              </div>
              <div>
                Company price <b className="tabular-nums">{money(period.companyPrice)}</b>
              </div>
              <div>
                Current{' '}
                {current ? (
                  <b>
                    {current.priceCode} {money(current.invoicePrice)}
                  </b>
                ) : (
                  <b>none — enter a code base</b>
                )}
              </div>
            </>
          ) : (
            !quote.isLoading && <div className="text-danger">No product period on this date.</div>
          )}
        </div>
      )}
      {over && <p className="text-sm text-danger">{over.detail} (BR-PRC-03)</p>}
      {ready && !current && (
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="tp-base">Price code letters (new customer/product/city)</Label>
          <Input
            id="tp-base"
            className="uppercase"
            maxLength={7}
            value={v.priceCodeBase}
            onChange={set('priceCodeBase')}
          />
        </div>
      )}
      <ProblemAlert error={save.error} />
      <Button type="submit" disabled={!ready || !v.invoicePrice || !!over || save.isPending}>
        {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{' '}
        Submit new price
      </Button>
    </form>
  );
}

export default function TradePricesPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ q: '', page: 1 });
  const [adding, setAdding] = useState(false);
  const [hist, setHist] = useState(null);
  const params = { q: f.q, page: f.page, pageSize: 50 };
  const list = useQuery({
    queryKey: ['pricing', 'list', params],
    queryFn: () => api(`/pricing/trade-prices${qs(params)}`),
    placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['pricing'] });
  return (
    <>
      <PageHeader
        icon={Tag}
        title="Trade prices"
        subtitle="DO clients: price per customer, product and city, effective from a date (BR-PRC-02). Changes wait for approval."
        crumbs={[{ label: 'Masters' }, { label: 'Trade prices' }]}
        actions={
          s.can('pricing.create') && (
            <Button
              className="bg-brand-orange hover:bg-brand-orange/90"
              onClick={() => setAdding((x) => !x)}
            >
              <Plus className="size-4" /> New price
            </Button>
          )
        }
      />
      <Section>
        {adding && (
          <div className="mb-4">
            <NewPrice
              onDone={() => {
                setAdding(false);
                refresh();
              }}
            />
          </div>
        )}
        {s.can('pricing.import') && <TradePriceImport onDone={refresh} />}
        <div className="mb-3 flex gap-2">
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
              placeholder="Price code, customer code or name"
              aria-label="Search trade prices"
              className="w-80 pl-8"
            />
          </form>
        </div>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={[
            ...COLUMNS,
            {
              id: 'h',
              header: <span className="sr-only">History</span>,
              cell: ({ row }) => (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setHist(row.original)}
                  aria-label={`History of ${row.original.priceCode}`}
                >
                  <History className="size-4" />
                </Button>
              ),
            },
          ]}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ ...f, page: p })}
          rowKey={(r) => `${r.brnch}|${r.priceCode}`}
        />
      </Section>
      {hist && <HistoryDialog tp={hist} onClose={() => setHist(null)} />}
    </>
  );
}
