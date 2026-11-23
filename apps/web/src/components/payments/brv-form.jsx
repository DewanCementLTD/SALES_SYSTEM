'use client';

// BRV entry + bank verification panel (PRD 4.6, mockup page 4 layout; rules win: manual
// verification by another user, BR-BRV-03; only verified BRVs count toward balance, BR-BRV-04).
import { FUND_FROM, VERIFY_METHODS, businessDate, zBrvBody } from '@dcl/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleDot,
  Landmark,
  Loader2,
  Printer,
  Receipt,
  RotateCcw,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ReasonDialog } from '@/components/common/dialogs';
import { ProblemAlert, Section, StatusBadge } from '@/components/common/page';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

export const BRV_TONE = {
  ENTERED: 'info',
  VERIFIED: 'success',
  CLEARED: 'success',
  BOUNCED: 'danger',
  CANCELLED: 'neutral',
};

const FIELDS = [
  'brvDate',
  'customerCode',
  'instCode',
  'category',
  'bankCode',
  'chequeNo',
  'chequeDate',
  'depositAccount',
  'amount',
  'salesTax',
  'tax',
  'freight',
  'fundFrom',
  'transporter',
  'depositor',
  'city',
  'remarks',
];

const toForm = (brv, today) =>
  Object.fromEntries(FIELDS.map((k) => [k, brv ? (brv[k] ?? '') : k === 'brvDate' ? today : '']));
const toBody = (v) =>
  Object.fromEntries(FIELDS.map((k) => [k, v[k] === '' || v[k] === undefined ? null : v[k]]));

function Field({ label, htmlFor, error, required, className, children }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-danger"> *</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function RefSelect({ control, name, id, items, placeholder, disabled, allowNone }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value || (allowNone ? '__none' : '')}
          onValueChange={(v) => field.onChange(v === '__none' ? '' : v)}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {allowNone && <SelectItem value="__none">—</SelectItem>}
            {(items ?? [])
              .filter((o) => o.active !== false || o.value === field.value)
              .map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value} · {o.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}

/** Verify (method, bank reference, remarks) — BR-BRV-03. */
export function VerifyDialog({ open, onOpenChange, brv, onVerify }) {
  const [v, setV] = useState({ method: 'PHONE', bankRef: '', remarks: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onVerify({ ...v, remarks: v.remarks || null });
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Verify BRV {brv?.receiptNo}</DialogTitle>
            <DialogDescription>
              {brv?.customerName} · {fmtPKR(brv?.amount)} · {brv?.instrument}. Confirm the receipt
              with the bank first; verifying credits the customer&apos;s ledgers.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="verify-method">How was it verified?</Label>
              <Select value={v.method} onValueChange={(m) => setV({ ...v, method: m })}>
                <SelectTrigger id="verify-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VERIFY_METHODS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-ref">Bank reference</Label>
              <Input
                id="verify-ref"
                value={v.bankRef}
                onChange={(e) => setV({ ...v, bankRef: e.target.value })}
                placeholder="Name of bank officer, transaction id, statement line…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-remarks">Remarks</Label>
              <Textarea
                id="verify-remarks"
                rows={2}
                value={v.remarks}
                onChange={(e) => setV({ ...v, remarks: e.target.value })}
              />
            </div>
            <ProblemAlert error={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={busy || v.bankRef.trim().length < 2}>
              {busy && <Loader2 className="size-4 animate-spin" />} Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Timeline({ brv }) {
  const steps = [
    ['BRV entered', brv.createdBy, brv.createdOn, true],
    [
      'Verified with the bank',
      brv.verifiedBy
        ? `${brv.verifiedBy} · ${VERIFY_METHODS[brv.verifyMethod] ?? brv.verifyMethod ?? ''}`
        : null,
      brv.verifiedOn,
      !!brv.verifiedOn || ['VERIFIED', 'CLEARED', 'BOUNCED'].includes(brv.status),
    ],
    brv.status === 'CLEARED' && ['Cleared', null, brv.clearDate, true],
    brv.status === 'BOUNCED' && ['Bounced', brv.bounceReason, brv.bouncedOn, true],
    brv.status === 'CANCELLED' && ['Cancelled', brv.cancelReason, brv.cancelledOn, true],
  ].filter(Boolean);
  return (
    <ol className="space-y-3">
      {steps.map(([title, by, when, done]) => (
        <li key={title} className="flex gap-3">
          {done ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <CircleDot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className={cn('text-sm font-medium', !done && 'text-muted-foreground')}>
              {title}
            </div>
            {by && <div className="text-xs text-muted-foreground">{by}</div>}
          </div>
          {when && (
            <div className="text-right text-xs text-muted-foreground">
              {typeof when === 'string' ? fmtDate(when) : fmtDateTime(when)}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * @param {{ brnch: number, brv?: any, editable: boolean, can: (p: string) => boolean, mine: boolean,
 *   onSave: (b: any) => Promise<any>, onCommand?: (name: string, body: any) => Promise<any>,
 *   onPrint?: () => Promise<any> }} p
 */
export function BrvForm({ brnch, brv, editable, can, mine, onSave, onCommand, onPrint }) {
  const today = businessDate(new Date());
  const form = useForm({
    // validate what is sent: empty optional inputs become null first
    resolver: (values, ctx, opts) => zodResolver(zBrvBody)(toBody(values), ctx, opts),
    defaultValues: toForm(brv, today),
  });
  const { control, register, setValue, formState } = form;
  const err = (k) => formState.errors[k]?.message;
  const [customer, setCustomer] = useState(
    brv ? { customerCode: brv.customerCode, customerName: brv.customerName } : null,
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [clearDate, setClearDate] = useState(today);
  const [returnDate, setReturnDate] = useState(today);
  const lookups = useQuery({
    queryKey: qk.lookups(brnch, 'instruments,categories,banks,company-banks'),
    queryFn: () => api(`/lookups?types=instruments,categories,banks,company-banks&brnch=${brnch}`),
  });
  const L = lookups.data ?? {};
  const ro = !editable;
  const run = async (what, fn) => {
    setError(null);
    setBusy(what);
    try {
      return await fn();
    } catch (e) {
      for (const fe of e.errors ?? []) {
        const path = fe.path.replace(/^body\./, '');
        if (path) form.setError(path, { message: fe.message });
      }
      setError(e);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const save = form.handleSubmit((v) => run('save', () => onSave(toBody(v))));
  const status = brv?.status ?? 'NEW';
  const act = mine && brv;

  return (
    <form onSubmit={save} noValidate className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        <Section title="Payment entry" icon={Receipt}>
          <fieldset disabled={ro} className="grid gap-4 md:grid-cols-2">
            <Field label="BRV no.">
              <Input
                value={brv?.receiptNo ?? 'Given when saved'}
                readOnly
                className="bg-secondary/50 font-mono"
              />
            </Field>
            <Field label="Date" htmlFor="brvDate" required error={err('brvDate')}>
              <Input id="brvDate" type="date" {...register('brvDate')} />
            </Field>
            <Field
              label="Customer"
              htmlFor="brv-customer"
              required
              error={err('customerCode')}
              className="md:col-span-2"
            >
              <CustomerPicker
                id="brv-customer"
                brnch={brnch}
                value={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setValue('customerCode', c.customerCode, { shouldValidate: true });
                }}
                className={ro ? 'pointer-events-none' : undefined}
              />
            </Field>
            <Field label="Instrument" htmlFor="instCode" required error={err('instCode')}>
              <RefSelect
                control={control}
                name="instCode"
                id="instCode"
                items={L.instruments}
                placeholder="Cash, cheque, online…"
                disabled={ro}
              />
            </Field>
            <Field label="Category" htmlFor="category" error={err('category')}>
              <RefSelect
                control={control}
                name="category"
                id="category"
                items={L.categories}
                placeholder="Clean, transitory…"
                disabled={ro}
                allowNone
              />
            </Field>
          </fieldset>
          <fieldset
            disabled={ro}
            className="mt-4 grid gap-4 rounded-lg border bg-secondary/30 p-3 md:grid-cols-3"
          >
            <legend className="px-1 text-sm font-semibold text-brand-navy">
              Cheque / transfer
            </legend>
            <Field label="Cheque / reference #" htmlFor="chequeNo" error={err('chequeNo')}>
              <Input id="chequeNo" {...register('chequeNo')} />
            </Field>
            <Field label="Customer bank" htmlFor="bankCode" error={err('bankCode')}>
              <RefSelect
                control={control}
                name="bankCode"
                id="bankCode"
                items={L.banks}
                placeholder="Bank"
                disabled={ro}
                allowNone
              />
            </Field>
            <Field label="Cheque date" htmlFor="chequeDate" error={err('chequeDate')}>
              <Input id="chequeDate" type="date" {...register('chequeDate')} />
            </Field>
            <Field
              label="Deposited in (company account)"
              htmlFor="depositAccount"
              required
              error={err('depositAccount')}
              className="md:col-span-3"
            >
              <RefSelect
                control={control}
                name="depositAccount"
                id="depositAccount"
                items={L['company-banks']}
                placeholder="Company bank account"
                disabled={ro}
              />
            </Field>
          </fieldset>
          <fieldset disabled={ro} className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label="Amount (PKR)" htmlFor="amount" required error={err('amount')}>
              <Input
                id="amount"
                inputMode="decimal"
                className="text-right"
                {...register('amount')}
              />
            </Field>
            <Field label="Sales tax" htmlFor="salesTax" error={err('salesTax')}>
              <Input
                id="salesTax"
                inputMode="decimal"
                className="text-right"
                {...register('salesTax')}
              />
            </Field>
            <Field label="Tax" htmlFor="tax" error={err('tax')}>
              <Input id="tax" inputMode="decimal" className="text-right" {...register('tax')} />
            </Field>
            <Field label="Freight" htmlFor="freight" error={err('freight')}>
              <Input
                id="freight"
                inputMode="decimal"
                className="text-right"
                {...register('freight')}
              />
            </Field>
            <Field label="Fund from" htmlFor="fundFrom">
              <Controller
                control={control}
                name="fundFrom"
                render={({ field }) => (
                  <Select value={field.value || ''} onValueChange={field.onChange} disabled={ro}>
                    <SelectTrigger id="fundFrom" className="w-full">
                      <SelectValue placeholder="Account" />
                    </SelectTrigger>
                    <SelectContent>
                      {FUND_FROM.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Depositor" htmlFor="depositor">
              <Input id="depositor" {...register('depositor')} />
            </Field>
            <Field label="Location (city)" htmlFor="city">
              <Input id="city" {...register('city')} />
            </Field>
            <Field label="Transporter" htmlFor="transporter">
              <Input id="transporter" {...register('transporter')} />
            </Field>
            <Field label="Remarks" htmlFor="remarks" className="md:col-span-4">
              <Textarea id="remarks" rows={2} maxLength={100} {...register('remarks')} />
            </Field>
          </fieldset>
        </Section>
        <Section title="Invoice knock-off">
          <p className="text-sm text-muted-foreground">
            Informational list of invoices this receipt settles (BR-BRV-07). Invoices are issued at
            the plant from phase P3; the balance is always ledger-based.
          </p>
          {brv?.linkedOcs?.length > 0 && (
            <p className="mt-2 text-sm">
              Funds order confirmations:{' '}
              {brv.linkedOcs.map((o) => `${o.ocNo} (${fmtPKR(o.amount)})`).join(', ')}
            </p>
          )}
        </Section>
      </div>

      <aside className="space-y-4">
        <Section title="Bank verification" icon={Landmark} className="xl:sticky xl:top-20">
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge tone={BRV_TONE[status] ?? 'neutral'}>
                  {status === 'NEW' ? 'new' : status.toLowerCase()}
                </StatusBadge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-semibold tabular-nums">
                {fmtPKR(brv?.amount ?? form.watch('amount'))}
              </dd>
            </div>
            {brv && Number(brv.appliedAmount) > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Applied to OCs</dt>
                <dd className="tabular-nums">{fmtPKR(brv.appliedAmount)}</dd>
              </div>
            )}
          </dl>
          {brv && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-brand-navy">Timeline</h3>
              <Timeline brv={brv} />
            </div>
          )}
          {status === 'ENTERED' && (
            <p className="mt-3 rounded-md bg-warning/10 p-2 text-xs text-warning">
              Not verified: this receipt does not count toward the customer&apos;s balance yet.
            </p>
          )}
          <ProblemAlert error={error} className="mt-3" />
          <div className="mt-4 grid gap-2">
            {editable && (
              <Button type="submit" variant="outline" disabled={!!busy}>
                {busy === 'save' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save BRV
              </Button>
            )}
            {act && status === 'ENTERED' && can('brv.verify') && (
              <Button
                type="button"
                className="bg-primary"
                disabled={!!busy || formState.isDirty}
                onClick={() => setDialog('verify')}
              >
                <ShieldCheck className="size-4" /> Verify with bank
              </Button>
            )}
            {act && status === 'VERIFIED' && can('brv.verify') && (
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="clear-date">Clearing date</Label>
                  <Input
                    id="clear-date"
                    type="date"
                    value={clearDate}
                    onChange={(e) => setClearDate(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => run('clear', () => onCommand('clear', { clearDate }))}
                >
                  Mark cleared
                </Button>
              </div>
            )}
            {act && ['VERIFIED', 'CLEARED'].includes(status) && can('brv.bounce') && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="return-date">Return date (for bounce)</Label>
                  <Input
                    id="return-date"
                    type="date"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => setDialog('bounce')}
                >
                  <RotateCcw className="size-4" /> Cheque bounced
                </Button>
              </>
            )}
            {act && status === 'ENTERED' && can('brv.cancel') && (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                onClick={() => setDialog('cancel')}
              >
                <XCircle className="size-4" /> Cancel BRV
              </Button>
            )}
            {brv && can('brv.print') && (
              <Button
                type="button"
                variant="outline"
                disabled={!!busy}
                onClick={() => run('print', onPrint)}
              >
                {busy === 'print' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Printer className="size-4" />
                )}
                Print receipt
              </Button>
            )}
          </div>
        </Section>
      </aside>

      <VerifyDialog
        open={dialog === 'verify'}
        onOpenChange={(o) => setDialog(o ? 'verify' : null)}
        brv={brv}
        onVerify={(body) => onCommand('verify', body)}
      />
      <ReasonDialog
        open={dialog === 'bounce'}
        onOpenChange={(o) => setDialog(o ? 'bounce' : null)}
        title={`Cheque returned: BRV ${brv?.receiptNo ?? ''}`}
        description={`Return date ${fmtDate(returnDate)}. The receipt is reversed in both ledgers (debit "Cheque return").`}
        impact="Order confirmations not yet confirmed lose this payment; confirmed ones are listed for follow-up."
        confirmLabel="Record bounce"
        destructive
        onConfirm={(reason) => onCommand('bounce', { reason, returnDate })}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={`Cancel BRV ${brv?.receiptNo ?? ''}`}
        description="Only an unverified BRV can be cancelled (BR-BRV-06)."
        confirmLabel="Cancel BRV"
        destructive
        onConfirm={(reason) => onCommand('cancel', { reason })}
      />
    </form>
  );
}
