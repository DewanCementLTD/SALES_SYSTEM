'use client';

// Tax rates (TASKS P1-05): withholding tax by filer status / section (BR-TAX-05) and FED / sales
// tax per product period (BR-TAX-02/03/10). Every change is a new effective-dated row that waits
// for approval (rule RATE_CHANGE, decided in Approvals); history is never edited.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Percent, Send } from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const FILER = { F: 'Filer', N: 'Non-filer', E: 'Exempt' };
const TONE = { PENDING_APPROVAL: 'warning', APPROVED: 'success', REJECTED: 'danger' };
const status = (s) => (
  <StatusBadge tone={TONE[s] ?? 'neutral'}>{s.replace('_', ' ').toLowerCase()}</StatusBadge>
);

function Field({ id, label, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function SimpleSelect({ id, value, onChange, options }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WhtTab() {
  const s = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['tax', 'rates'], queryFn: () => api('/tax/rates') });
  const empty = {
    scope: '0',
    filerStatus: 'F',
    section: '',
    ratePct: '',
    effectiveFrom: '',
    remarks: '',
  };
  const [v, setV] = useState(empty);
  const add = useMutation({
    mutationFn: () => api('/tax/rates', { method: 'POST', body: { ...v, scope: Number(v.scope) } }),
    onSuccess: (r) => {
      toast.success(
        r.requestId ? 'Sent for approval (Approvals → My inbox of the approver)' : 'Rate saved',
      );
      setV(empty);
      qc.invalidateQueries({ queryKey: ['tax', 'rates'] });
    },
  });
  const branchName = (b) => (b === 0 ? 'Both' : (s.branches.find((x) => x.brnch === b)?.name ?? b));
  const columns = [
    { id: 'filer', header: 'Filer status', cell: ({ row }) => FILER[row.original.filerStatus] },
    {
      id: 'section',
      header: 'Section',
      cell: ({ row }) => (row.original.section === '-' ? 'General' : row.original.section),
    },
    {
      id: 'rate',
      header: 'Rate %',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.ratePct}</span>,
    },
    {
      id: 'from',
      header: 'Effective from',
      cell: ({ row }) => fmtDate(row.original.effectiveFrom),
    },
    { id: 'scope', header: 'Branch', cell: ({ row }) => branchName(row.original.brnch) },
    { id: 'status', header: 'Status', cell: ({ row }) => status(row.original.status) },
    {
      id: 'by',
      header: 'Entered / approved',
      cell: ({ row }) =>
        `${row.original.createdBy}${row.original.approvedBy ? ` / ${row.original.approvedBy}` : ''}`,
    },
  ];
  const set = (k) => (e) => setV({ ...v, [k]: e?.target ? e.target.value : e });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        WHT = rate × sale proceeds (BR-TAX-05). The latest approved row starting on or before the
        invoice date applies; a section row beats the general row, a branch row beats a
        both-branches row.
      </p>
      {s.can('tax.update') && (
        <form
          className="grid gap-3 rounded-lg border bg-secondary/40 p-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field id="wht-scope" label="Branch">
            <SimpleSelect
              id="wht-scope"
              value={v.scope}
              onChange={set('scope')}
              options={[
                ['0', 'Both branches'],
                ...s.branches.map((b) => [String(b.brnch), b.name]),
              ]}
            />
          </Field>
          <Field id="wht-filer" label="Filer status">
            <SimpleSelect
              id="wht-filer"
              value={v.filerStatus}
              onChange={set('filerStatus')}
              options={Object.entries(FILER)}
            />
          </Field>
          <Field id="wht-section" label="Section (optional)">
            <Input
              id="wht-section"
              placeholder="e.g. 236G"
              value={v.section}
              onChange={set('section')}
            />
          </Field>
          <Field id="wht-rate" label="Rate %">
            <Input id="wht-rate" inputMode="decimal" value={v.ratePct} onChange={set('ratePct')} />
          </Field>
          <Field id="wht-from" label="Effective from">
            <Input
              id="wht-from"
              type="date"
              value={v.effectiveFrom}
              onChange={set('effectiveFrom')}
            />
          </Field>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}{' '}
            Submit
          </Button>
          <ProblemAlert error={add.error} className="sm:col-span-3 lg:col-span-6" />
        </form>
      )}
      <ProblemAlert error={list.error} />
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        rowKey={(r) => r.taxRateId}
        empty="No WHT rates entered yet."
      />
    </div>
  );
}

function ProductTab() {
  const s = useSession();
  const qc = useQueryClient();
  const products = useQuery({
    queryKey: qk.lookups(s.branch, 'product-codes'),
    queryFn: () => api('/lookups?types=product-codes'),
  });
  const [product, setProduct] = useState('');
  const params = { productCode: product, pageSize: 20 };
  const periods = useQuery({
    queryKey: qk.masters('product-periods', params),
    queryFn: () => api(`/masters/product-periods${qs(params)}`),
    enabled: !!product,
  });
  const pending = useQuery({
    queryKey: ['tax', 'pending-periods'],
    queryFn: () => api('/tax/product-periods/pending'),
  });
  const empty = {
    dateFrom: '',
    fedPerTon: '',
    salesTaxPer: '',
    mrp: '',
    retailPrice: '',
    companyPrice: '',
  };
  const [v, setV] = useState(empty);
  const add = useMutation({
    mutationFn: () =>
      api('/tax/product-periods', {
        method: 'POST',
        body: Object.fromEntries(
          Object.entries({ productCode: product, ...v }).filter(([, x]) => x !== ''),
        ),
      }),
    onSuccess: (r) => {
      toast.success(r.requestId ? 'New period sent for approval' : `Period ${r.period} added`);
      setV(empty);
      qc.invalidateQueries({ queryKey: ['tax', 'pending-periods'] });
      qc.invalidateQueries({ queryKey: ['masters', 'product-periods'] });
    },
  });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const columns = [
    { id: 'p', header: 'Period', cell: ({ row }) => row.original.period },
    { id: 'from', header: 'Date from', cell: ({ row }) => fmtDate(row.original.dateFrom) },
    ...[
      ['fedPerTon', 'FED / ton'],
      ['salesTaxPer', 'ST %'],
      ['mrp', 'MRP / ton'],
      ['retailPrice', 'Retail / ton'],
    ].map(([k, h]) => ({
      id: k,
      header: h,
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original[k] ?? '—'}</span>,
    })),
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        FED per ton and sales tax % come from the product&apos;s effective period: the highest
        period number starting on or before the date (BR-TAX-10). A change is a new period; values
        not entered are copied from the latest period.
      </p>
      <div className="max-w-sm">
        <Field id="tp-product" label="Product">
          <SimpleSelect
            id="tp-product"
            value={product}
            onChange={setProduct}
            options={(products.data?.['product-codes'] ?? []).map((p) => [
              p.value,
              `${p.value} · ${p.label}`,
            ])}
          />
        </Field>
      </div>
      {product && (
        <>
          <DataTable
            columns={columns}
            data={periods.data?.items ?? []}
            loading={periods.isLoading}
            rowKey={(r) => r.period}
          />
          {s.can('tax.update') && (
            <form
              className="grid gap-3 rounded-lg border bg-secondary/40 p-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <Field id="np-from" label="Date from">
                <Input id="np-from" type="date" value={v.dateFrom} onChange={set('dateFrom')} />
              </Field>
              <Field id="np-fed" label="FED / ton">
                <Input
                  id="np-fed"
                  inputMode="decimal"
                  value={v.fedPerTon}
                  onChange={set('fedPerTon')}
                />
              </Field>
              <Field id="np-st" label="Sales tax %">
                <Input
                  id="np-st"
                  inputMode="decimal"
                  value={v.salesTaxPer}
                  onChange={set('salesTaxPer')}
                />
              </Field>
              <Field id="np-mrp" label="MRP / ton">
                <Input
                  id="np-mrp"
                  inputMode="decimal"
                  placeholder="unchanged"
                  value={v.mrp}
                  onChange={set('mrp')}
                />
              </Field>
              <Field id="np-retail" label="Retail / ton">
                <Input
                  id="np-retail"
                  inputMode="decimal"
                  placeholder="unchanged"
                  value={v.retailPrice}
                  onChange={set('retailPrice')}
                />
              </Field>
              <Field id="np-company" label="Company / ton">
                <Input
                  id="np-company"
                  inputMode="decimal"
                  placeholder="unchanged"
                  value={v.companyPrice}
                  onChange={set('companyPrice')}
                />
              </Field>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}{' '}
                New period
              </Button>
              <ProblemAlert error={add.error} className="sm:col-span-3 lg:col-span-7" />
            </form>
          )}
        </>
      )}
      {(pending.data?.items ?? []).length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold text-brand-navy">Waiting for approval</h3>
          <ul className="space-y-1 text-sm">
            {pending.data.items.map((p) => (
              <li key={p.requestId}>
                #{p.requestId} {p.productCode}: FED {p.fedPerTon}/t, ST {p.salesTaxPer}% from{' '}
                {fmtDate(p.dateFrom)} — {p.requestedBy}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function TaxRatesPage() {
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('wht'));
  return (
    <>
      <PageHeader
        icon={Percent}
        title="Tax rates"
        subtitle="Effective-dated; every change waits for approval (RATE_CHANGE) and history is never edited."
        crumbs={[{ label: 'Masters' }, { label: 'Tax rates' }]}
      />
      <Section>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="wht">Withholding tax</TabsTrigger>
            <TabsTrigger value="product">FED & sales tax</TabsTrigger>
          </TabsList>
          <TabsContent value="wht">{tab === 'wht' && <WhtTab />}</TabsContent>
          <TabsContent value="product">{tab === 'product' && <ProductTab />}</TabsContent>
        </Tabs>
      </Section>
    </>
  );
}
