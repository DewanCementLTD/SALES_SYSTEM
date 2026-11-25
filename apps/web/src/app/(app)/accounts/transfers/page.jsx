'use client';

// Accounts › Balance transfers (PRD 4.13, TASKS P4-02, BR-NOTE-04): one document moves an amount
// from customer A to customer B (Dr A, Cr B in the DO and DC ledgers once approved). Stored as a
// credit note to B with A as transfer customer; submit / approve / reverse on the note screen.
import { businessDate, zTransferCreate } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parseAsInteger, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { NOTE_TONE, noteStatusText } from '@/components/accounts/note-status';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
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
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const columns = [
  {
    id: 'no',
    header: 'Transfer #',
    cell: ({ row }) => (
      <Link
        href={`/accounts/notes/${row.original.brnch}/${row.original.kind}/${row.original.srlNo}`}
        className="font-mono text-primary hover:underline"
      >
        {row.original.kind === 'D' ? 'DN' : 'CN'} {row.original.srlNo}
      </Link>
    ),
  },
  { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.date) },
  {
    id: 'f',
    header: 'From (debited)',
    cell: ({ row }) =>
      row.original.kind === 'C' ? row.original.transferCustomer : row.original.customerCode,
  },
  {
    id: 't',
    header: 'To (credited)',
    cell: ({ row }) =>
      row.original.kind === 'C'
        ? `${row.original.customerCode} ${row.original.customerName ?? ''}`
        : row.original.transferCustomer,
  },
  {
    id: 'a',
    header: 'Amount',
    meta: { className: 'text-right' },
    cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.net)}</span>,
  },
  {
    id: 's',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={NOTE_TONE[row.original.status] ?? 'neutral'}>
        {row.original.kind === 'D' ? 'reversal' : noteStatusText(row.original.status)}
      </StatusBadge>
    ),
  },
  {
    id: 'r',
    header: 'Remarks',
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-80 text-muted-foreground">
        {row.original.remarks ?? ''}
      </span>
    ),
  },
];

function NewTransferDialog({ open, onOpenChange }) {
  const s = useSession();
  const router = useRouter();
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [v, setV] = useState({
    amount: '',
    date: businessDate(new Date()),
    particular: '',
    remarks: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const body = {
      ...v,
      fromCustomer: from?.customerCode ?? '',
      toCustomer: to?.customerCode ?? '',
      remarks: v.remarks || null,
    };
    const parsed = zTransferCreate.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const n = await api('/notes/transfer', { method: 'POST', body: parsed.data });
      toast.success(`Transfer ${n.srlNo} saved as draft`);
      router.push(`/accounts/notes/${n.brnch}/${n.kind}/${n.srlNo}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const field = (k) => ({
    value: v[k],
    onChange: (e) => setV((x) => ({ ...x, [k]: e.target.value })),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>New balance transfer</DialogTitle>
            <DialogDescription>
              The first customer is debited and the second credited with the same amount, in both
              ledgers, once the transfer is approved.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <ProblemAlert error={error} />
            <div className="space-y-1.5">
              <Label htmlFor="tr-from">From (debited)</Label>
              <CustomerPicker
                id="tr-from"
                label="From (debited)"
                brnch={s.branch}
                value={from}
                onChange={setFrom}
              />
              {errors.fromCustomer && <p className="text-xs text-danger">{errors.fromCustomer}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-to">To (credited)</Label>
              <CustomerPicker
                id="tr-to"
                label="To (credited)"
                brnch={s.branch}
                value={to}
                onChange={setTo}
              />
              {errors.toCustomer && <p className="text-xs text-danger">{errors.toCustomer}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tr-amt">Amount (PKR)</Label>
                <Input
                  id="tr-amt"
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  {...field('amount')}
                />
                {errors.amount && <p className="text-xs text-danger">{errors.amount}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-date">Date</Label>
                <Input id="tr-date" type="date" {...field('date')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-part">Particular</Label>
              <Input id="tr-part" maxLength={60} {...field('particular')} />
              {errors.particular && <p className="text-xs text-danger">{errors.particular}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-rem">Remarks</Label>
              <Input id="tr-rem" maxLength={500} {...field('remarks')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Save draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TransfersPage() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [f, setF] = useQueryStates({ page: parseAsInteger.withDefault(1) });
  const params = { transfer: 'Y', page: f.page, pageSize: 50 };
  const list = useQuery({
    queryKey: qk.notes(params),
    queryFn: () => api(`/notes${qs(params)}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        icon={ArrowLeftRight}
        title="Balance transfers"
        subtitle="Move an amount from one customer's account to another's, in one document."
        crumbs={[{ label: 'Accounts' }, { label: 'Balance transfers' }]}
        actions={
          s.can('note.transfer') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New transfer
            </Button>
          )
        }
      />
      <Section>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          rowKey={(r) => `${r.brnch}|${r.kind}|${r.srlNo}`}
          empty="No balance transfers."
        />
      </Section>
      {open && <NewTransferDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
