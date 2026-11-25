'use client';

// Accounts › Tax withheld (TASKS P4-05, R12 block 7): income / sales tax customers deducted when
// paying, the certificates received against each entry, and the outstanding per customer. A wrong
// entry is cancelled by a reversing entry (while no certificate is recorded on it).
import { TAX_KINDS, businessDate, zTaxWithheldCreate } from '@dcl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Loader2, Plus, ReceiptText, RotateCcw } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { CustomerPicker } from '@/components/customers/customer-picker';
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
import { useSession } from '@/lib/session';

function NewEntryDialog({ open, onOpenChange, onDone }) {
  const s = useSession();
  const [customer, setCustomer] = useState(null);
  const [v, setV] = useState({
    taxKind: 'IT',
    date: businessDate(new Date()),
    amount: '',
    docType: '',
    docNo: '',
    remarks: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const field = (k) => ({
    id: `tw-${k}`,
    value: v[k],
    onChange: (e) => setV((x) => ({ ...x, [k]: e.target.value })),
  });
  const save = async (e) => {
    e.preventDefault();
    const parsed = zTaxWithheldCreate.safeParse({
      ...v,
      customerCode: customer?.customerCode ?? '',
      docType: v.docType || null,
      docNo: v.docNo || null,
      remarks: v.remarks || null,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await api('/tax-withheld', { method: 'POST', body: parsed.data });
      toast.success('Tax withheld recorded');
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const err = (k) => (errors[k] ? <p className="text-xs text-danger">{errors[k]}</p> : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>Record tax withheld</DialogTitle>
            <DialogDescription>Tax the customer deducted when paying DCL.</DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <ProblemAlert error={error} />
            <div className="space-y-1.5">
              <Label htmlFor="tw-cust">Customer</Label>
              <CustomerPicker
                id="tw-cust"
                brnch={s.branch}
                value={customer}
                onChange={setCustomer}
              />
              {err('customerCode')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tw-kind">Tax</Label>
                <Select
                  value={v.taxKind}
                  onValueChange={(k) => setV((x) => ({ ...x, taxKind: k }))}
                >
                  <SelectTrigger id="tw-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TAX_KINDS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-date">Date</Label>
                <Input type="date" {...field('date')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-amount">Amount (PKR)</Label>
                <Input
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  {...field('amount')}
                />
                {err('amount')}
              </div>
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tw-docType">Doc</Label>
                  <Input placeholder="BRV" maxLength={10} {...field('docType')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tw-docNo">Doc #</Label>
                  <Input maxLength={30} {...field('docNo')} />
                </div>
              </div>
            </div>
            {err('docType')}
            <div className="space-y-1.5">
              <Label htmlFor="tw-remarks">Remarks</Label>
              <Input maxLength={400} {...field('remarks')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CertificateDialog({ entry, onOpenChange, onDone }) {
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/tax-withheld/${entry.twId}/certificate`, {
        method: 'POST',
        body: { amount, remarks: remarks || null },
      });
      toast.success('Certificate recorded');
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Certificate received</DialogTitle>
            <DialogDescription>
              {entry
                ? `${entry.customerCode} · ${TAX_KINDS[entry.taxKind]} · outstanding ${fmtPKR(entry.outstanding)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <ProblemAlert error={error} />
            <div className="space-y-1.5">
              <Label htmlFor="tc-amount">Certificate amount (PKR)</Label>
              <Input
                id="tc-amount"
                inputMode="decimal"
                className="text-right tabular-nums"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tc-remarks">Certificate # / remarks</Label>
              <Input
                id="tc-remarks"
                maxLength={400}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !amount}>
              {busy && <Loader2 className="size-4 animate-spin" />} Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TaxWithheldPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [f, setF] = useQueryStates({
    view: parseAsString.withDefault('entries'),
    page: parseAsInteger.withDefault(1),
  });
  const [newOpen, setNewOpen] = useState(false);
  const [cert, setCert] = useState(null);
  const [rev, setRev] = useState(null);
  const params = { page: f.page, pageSize: 50 };
  const entries = useQuery({
    queryKey: ['tax-withheld', 'list', params],
    queryFn: () => api(`/tax-withheld${qs(params)}`),
    enabled: f.view === 'entries',
    placeholderData: (p) => p,
  });
  const summary = useQuery({
    queryKey: ['tax-withheld', 'summary'],
    queryFn: () => api('/tax-withheld/summary'),
    enabled: f.view === 'summary',
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tax-withheld'] });
  const canEdit = s.can('note.create');

  const columns = [
    { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.date) },
    {
      id: 'c',
      header: 'Customer',
      cell: ({ row }) => `${row.original.customerCode} ${row.original.customerName ?? ''}`,
    },
    { id: 'k', header: 'Tax', cell: ({ row }) => TAX_KINDS[row.original.taxKind] },
    {
      id: 'doc',
      header: 'Document',
      cell: ({ row }) =>
        row.original.docType === 'REV'
          ? `reverses #${row.original.docNo}`
          : [row.original.docType, row.original.docNo].filter(Boolean).join(' ') || '—',
    },
    {
      id: 'a',
      header: 'Withheld',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.amount)}</span>,
    },
    {
      id: 'cr',
      header: 'Certificates',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.certReceived)}</span>,
    },
    {
      id: 'o',
      header: 'Outstanding',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.outstanding)}</span>,
    },
    {
      id: 'x',
      header: '',
      cell: ({ row }) => {
        const e = row.original;
        const open = e.docType !== 'REV' && !e.reversedBy;
        if (!canEdit || !open)
          return e.reversedBy ? <span className="text-muted-foreground">reversed</span> : null;
        return (
          <div className="flex justify-end gap-1">
            {Number(e.outstanding) > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCert(e)}
                aria-label={`Certificate for entry ${e.twId}`}
              >
                <FileCheck2 className="size-4" />
              </Button>
            )}
            {Number(e.certReceived) === 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRev(e)}
                aria-label={`Reverse entry ${e.twId}`}
              >
                <RotateCcw className="size-4" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];
  const sumColumns = [
    {
      id: 'c',
      header: 'Customer',
      cell: ({ row }) => `${row.original.customerCode} ${row.original.customerName ?? ''}`,
    },
    { id: 'k', header: 'Tax', cell: ({ row }) => TAX_KINDS[row.original.taxKind] },
    ...columns.slice(4, 7),
  ];

  return (
    <>
      <PageHeader
        icon={ReceiptText}
        title="Tax withheld"
        subtitle="Income and sales tax customers deducted when paying, and the certificates received."
        crumbs={[{ label: 'Accounts' }, { label: 'Tax withheld' }]}
        actions={
          canEdit && (
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> Record tax withheld
            </Button>
          )
        }
      />
      <Section>
        <Tabs value={f.view} onValueChange={(v) => setF({ view: v, page: 1 })} className="mb-3">
          <TabsList>
            <TabsTrigger value="entries">Entries</TabsTrigger>
            <TabsTrigger value="summary">Per customer</TabsTrigger>
          </TabsList>
        </Tabs>
        {f.view === 'entries' ? (
          <>
            <ProblemAlert error={entries.error} className="mb-3" />
            <DataTable
              columns={columns}
              data={entries.data}
              loading={entries.isLoading}
              onPageChange={(p) => setF({ page: p })}
              rowKey={(r) => r.twId}
              empty="No tax withheld recorded."
            />
          </>
        ) : (
          <>
            <ProblemAlert error={summary.error} className="mb-3" />
            <DataTable
              columns={sumColumns}
              data={summary.data?.items ?? []}
              loading={summary.isLoading}
              rowKey={(r) => `${r.customerCode}|${r.taxKind}`}
              empty="Nothing outstanding."
            />
          </>
        )}
      </Section>
      {newOpen && <NewEntryDialog open={newOpen} onOpenChange={setNewOpen} onDone={refresh} />}
      <CertificateDialog entry={cert} onOpenChange={(o) => !o && setCert(null)} onDone={refresh} />
      <ReasonDialog
        open={!!rev}
        onOpenChange={(o) => !o && setRev(null)}
        title="Reverse the entry"
        description="A reversing entry with the opposite amount is recorded."
        confirmLabel="Reverse"
        destructive
        onConfirm={async (reason) => {
          await api(`/tax-withheld/${rev.twId}/reverse`, { method: 'POST', body: { reason } });
          toast.success('Entry reversed');
          refresh();
        }}
      />
    </>
  );
}
