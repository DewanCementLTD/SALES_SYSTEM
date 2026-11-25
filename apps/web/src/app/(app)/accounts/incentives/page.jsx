'use client';

// Accounts › Incentive runs (PRD 4.13, TASKS P4-03, BR-INC-01/03): schemes (period, customer
// range, products with a rate per ton). Open one to preview the run and commit it into DRAFT
// credit notes (type 008), which are then approved like any note.
import { businessDate, zIncentiveScheme } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Gift, Loader2, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const SCHEME_TONE = { DRAFT: 'info', COMMITTED: 'success', CANCELLED: 'neutral' };

const columns = [
  {
    id: 'no',
    header: 'Scheme #',
    cell: ({ row }) => (
      <Link
        href={`/accounts/incentives/${row.original.brnch}/${row.original.srlNo}`}
        className="font-mono text-primary hover:underline"
      >
        INC {row.original.srlNo}
      </Link>
    ),
  },
  { id: 'm', header: 'Memo', cell: ({ row }) => row.original.memoNo ?? '—' },
  {
    id: 'p',
    header: 'Period',
    cell: ({ row }) => `${fmtDate(row.original.dateFrom)} – ${fmtDate(row.original.dateTo)}`,
  },
  {
    id: 'c',
    header: 'Customers',
    cell: ({ row }) => (
      <span className="font-mono">
        {row.original.customerFrom} … {row.original.customerTo}
      </span>
    ),
  },
  {
    id: 'a',
    header: 'Amount',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.total ? fmtPKR(row.original.total) : '—'}</span>
    ),
  },
  {
    id: 's',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={SCHEME_TONE[row.original.status] ?? 'neutral'}>
        {row.original.status.toLowerCase()}
      </StatusBadge>
    ),
  },
];

function NewSchemeDialog({ open, onOpenChange }) {
  const s = useSession();
  const router = useRouter();
  const today = businessDate(new Date());
  const [v, setV] = useState({
    memoNo: '',
    memoDate: today,
    dateFrom: '',
    dateTo: '',
    customerFrom: '',
    customerTo: '',
    remarks: '',
  });
  const [products, setProducts] = useState([{ productCode: '', rate: '' }]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lookups = useQuery({
    queryKey: qk.lookups(s.branch, 'product-codes'),
    queryFn: () => api(`/lookups?types=product-codes&brnch=${s.branch}`),
  });
  const field = (k) => ({
    id: `is-${k}`,
    value: v[k],
    onChange: (e) => setV((x) => ({ ...x, [k]: e.target.value })),
  });
  const save = async (e) => {
    e.preventDefault();
    const parsed = zIncentiveScheme.safeParse({
      ...v,
      memoNo: v.memoNo || null,
      remarks: v.remarks || null,
      products,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const r = await api('/incentives/schemes', { method: 'POST', body: parsed.data });
      toast.success(`Scheme INC ${r.srlNo} saved`);
      router.push(`/accounts/incentives/${r.brnch}/${r.srlNo}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const err = (k) => (errors[k] ? <p className="text-xs text-danger">{errors[k]}</p> : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>New incentive scheme</DialogTitle>
            <DialogDescription>
              Invoiced tons of the customers in the code range, in the period, times the rate per
              ton of each product.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <ProblemAlert error={error} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="is-memoNo">Memo #</Label>
                <Input maxLength={30} {...field('memoNo')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="is-memoDate">Memo date</Label>
                <Input type="date" {...field('memoDate')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="is-dateFrom">Period from</Label>
                <Input type="date" {...field('dateFrom')} />
                {err('dateFrom')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="is-dateTo">Period to</Label>
                <Input type="date" {...field('dateTo')} />
                {err('dateTo')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="is-customerFrom">First customer code</Label>
                <Input className="font-mono" maxLength={11} {...field('customerFrom')} />
                {err('customerFrom')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="is-customerTo">Last customer code</Label>
                <Input className="font-mono" maxLength={11} {...field('customerTo')} />
                {err('customerTo')}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="is-remarks">Remarks</Label>
                <Input maxLength={256} {...field('remarks')} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Products and rate per ton</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setProducts((p) => [...p, { productCode: '', rate: '' }])}
                >
                  <Plus className="size-4" /> Add product
                </Button>
              </div>
              {err('products')}
              {products.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`is-p-${i}`}>Product {i + 1}</Label>
                    <Select
                      value={p.productCode}
                      onValueChange={(code) =>
                        setProducts((x) =>
                          x.map((y, j) => (j === i ? { ...y, productCode: code } : y)),
                        )
                      }
                    >
                      <SelectTrigger id={`is-p-${i}`} className="w-full">
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {(lookups.data?.['product-codes'] ?? []).map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.value} · {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`is-r-${i}`}>Rate / t</Label>
                    <Input
                      id={`is-r-${i}`}
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      value={p.rate}
                      onChange={(e) =>
                        setProducts((x) =>
                          x.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)),
                        )
                      }
                    />
                    {err(`products.${i}.rate`)}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove product ${i + 1}`}
                    disabled={products.length === 1}
                    onClick={() => setProducts((x) => x.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Save scheme
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function IncentivesPage() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useQueryStates({
    status: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
  });
  const params = {
    ...(f.status !== 'all' ? { status: f.status } : {}),
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: ['incentives', 'list', params],
    queryFn: () => api(`/incentives/schemes${qs(params)}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        icon={Gift}
        title="Incentive runs"
        subtitle="Incentive schemes on invoiced quantity. Preview a scheme, then commit it into draft credit notes."
        crumbs={[{ label: 'Accounts' }, { label: 'Incentive runs' }]}
        actions={
          s.can('incentive.run') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New scheme
            </Button>
          )
        }
      />
      <Section>
        <Tabs value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })} className="mb-3">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="DRAFT">Draft</TabsTrigger>
            <TabsTrigger value="COMMITTED">Committed</TabsTrigger>
            <TabsTrigger value="CANCELLED">Cancelled</TabsTrigger>
          </TabsList>
        </Tabs>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          rowKey={(r) => `${r.brnch}|${r.srlNo}`}
          empty="No incentive schemes."
        />
      </Section>
      {open && <NewSchemeDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
