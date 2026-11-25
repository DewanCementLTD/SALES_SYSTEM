'use client';

// New credit / debit note (PRD 4.13, BR-NOTE-01/02): type from the branch's note types, customer,
// lines with optional WHT %, live totals (net = Σ lines − WHT). A sales-return note names one
// invoice of the customer. Saved as DRAFT; submitted from the note screen.
import { businessDate, noteTotals, zNoteCreate } from '@dcl/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ProblemAlert, Section } from '@/components/common/page';
import { CustomerPicker } from '@/components/customers/customer-picker';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const blankLine = { particular: '', amount: '', whtPct: '' };
const safeTotals = (lines) => {
  try {
    return noteTotals(
      lines.map((l) => ({
        amount: /^\d+(\.\d{1,2})?$/.test(l.amount ?? '') ? l.amount : '0',
        whtPct: /^\d+(\.\d{1,3})?$/.test(l.whtPct ?? '') ? l.whtPct : null,
      })),
    );
  } catch {
    return { gross: '0.00', wht: '0.00', net: '0.00' };
  }
};

function Err({ msg }) {
  return msg ? <p className="text-xs text-danger">{msg}</p> : null;
}

export function NoteForm() {
  const s = useSession();
  const router = useRouter();
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState(null);
  const types = useQuery({
    queryKey: qk.noteTypes(s.branch),
    queryFn: () => api('/notes/types'),
  });
  const form = useForm({
    resolver: zodResolver(zNoteCreate),
    defaultValues: {
      kind: 'C',
      noteType: '',
      customerCode: '',
      date: businessDate(new Date()),
      remarks: '',
      invoiceId: null,
      lines: [blankLine],
    },
  });
  const { control, register, handleSubmit, setValue, formState } = form;
  const lines = useFieldArray({ control, name: 'lines' });
  const [kind, noteType, customerCode, watched] = useWatch({
    control,
    name: ['kind', 'noteType', 'customerCode', 'lines'],
  });
  const totals = safeTotals(watched ?? []);
  const type = (types.data?.items ?? []).find((x) => x.code === noteType);
  const isReturn = kind === 'C' && type?.salesReturn;
  const invParams = { customer: customerCode, pageSize: 50 };
  const invoices = useQuery({
    queryKey: ['invoices', 'list', invParams],
    queryFn: () => api(`/invoices${qs(invParams)}`),
    enabled: Boolean(isReturn && customerCode),
  });
  const errs = formState.errors;

  const save = handleSubmit(async (v) => {
    setError(null);
    try {
      const n = await api('/notes', {
        method: 'POST',
        body: {
          ...v,
          remarks: v.remarks || null,
          invoiceId: isReturn ? v.invoiceId : null,
          lines: v.lines.map((l) => ({ ...l, whtPct: l.whtPct || null })),
        },
      });
      toast.success(`${n.kind === 'D' ? 'Debit' : 'Credit'} note ${n.srlNo} saved as draft`);
      router.push(`/accounts/notes/${n.brnch}/${n.kind}/${n.srlNo}`);
    } catch (e) {
      setError(e);
    }
  });

  return (
    <form onSubmit={save} className="grid gap-4 xl:grid-cols-[1fr_320px]" noValidate>
      <div className="space-y-4">
        <Section title="Note">
          <ProblemAlert error={error} className="mb-3" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <span className="text-sm font-medium">Kind</span>
              <Controller
                control={control}
                name="kind"
                render={({ field }) => (
                  <Tabs value={field.value} onValueChange={field.onChange}>
                    <TabsList aria-label="Kind">
                      <TabsTrigger value="C">Credit note (customer is credited)</TabsTrigger>
                      <TabsTrigger value="D">Debit note (customer is debited)</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-type">Type</Label>
              <Controller
                control={control}
                name="noteType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="nt-type" className="w-full">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {(types.data?.items ?? []).map((x) => (
                        <SelectItem key={x.code} value={x.code}>
                          {x.code} · {x.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Err msg={errs.noteType?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-date">Date</Label>
              <Input id="nt-date" type="date" {...register('date')} />
              <Err msg={errs.date?.message} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="nt-cust">Customer</Label>
              <CustomerPicker
                id="nt-cust"
                brnch={s.branch}
                value={customer}
                onChange={(c) => {
                  setCustomer(c);
                  setValue('customerCode', c?.customerCode ?? '', { shouldValidate: true });
                  setValue('invoiceId', null);
                }}
              />
              <Err msg={errs.customerCode?.message} />
            </div>
            {isReturn && (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="nt-inv">Invoice returned</Label>
                <Controller
                  control={control}
                  name="invoiceId"
                  render={({ field }) => (
                    <Select
                      value={field.value ? String(field.value) : ''}
                      onValueChange={(v) => field.onChange(Number(v))}
                      disabled={!customerCode}
                    >
                      <SelectTrigger id="nt-inv" className="w-full">
                        <SelectValue
                          placeholder={
                            customerCode ? 'Choose the invoice' : 'Choose the customer first'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(invoices.data?.items ?? [])
                          .filter((i) => i.status !== 'CANCELLED')
                          .map((i) => (
                            <SelectItem key={i.invoiceId} value={String(i.invoiceId)}>
                              INV {i.invoiceNo} · {fmtDate(i.invoiceDate)} · {i.qtyTon} t ·{' '}
                              {fmtPKR(i.totalCollectable)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  A sales return credits at most what the invoice charged, less earlier returns.
                </p>
              </div>
            )}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="nt-rem">Remarks</Label>
              <Textarea id="nt-rem" rows={2} maxLength={500} {...register('remarks')} />
            </div>
          </div>
        </Section>

        <Section
          title="Lines"
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => lines.append(blankLine)}
              disabled={lines.fields.length >= 20}
            >
              <Plus className="size-4" /> Add line
            </Button>
          }
        >
          <Err msg={errs.lines?.message ?? errs.lines?.root?.message} />
          <div className="space-y-2">
            {lines.fields.map((fl, i) => (
              <div key={fl.id} className="grid items-end gap-2 sm:grid-cols-[1fr_160px_110px_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`nl-p-${i}`}>Particular {i + 1}</Label>
                  <Input id={`nl-p-${i}`} maxLength={60} {...register(`lines.${i}.particular`)} />
                  <Err msg={errs.lines?.[i]?.particular?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`nl-a-${i}`}>Amount</Label>
                  <Input
                    id={`nl-a-${i}`}
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    {...register(`lines.${i}.amount`)}
                  />
                  <Err msg={errs.lines?.[i]?.amount?.message} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`nl-w-${i}`}>WHT %</Label>
                  <Input
                    id={`nl-w-${i}`}
                    inputMode="decimal"
                    className="text-right tabular-nums"
                    {...register(`lines.${i}.whtPct`, { setValueAs: (v) => v || null })}
                  />
                  <Err msg={errs.lines?.[i]?.whtPct?.message} />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => lines.remove(i)}
                  disabled={lines.fields.length === 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Totals">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="tabular-nums">{fmtPKR(totals.gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">WHT</dt>
              <dd className="tabular-nums">− {fmtPKR(totals.wht)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <dt>{kind === 'D' ? 'Debit to the customer' : 'Credit to the customer'}</dt>
              <dd className="tabular-nums">{fmtPKR(totals.net)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Saved as a draft. Submit it from the note screen: the Finance Manager approves it, and
            it is then posted to the customer&apos;s DO and DC ledgers.
          </p>
          <Button type="submit" className="mt-3 w-full" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}{' '}
            Save draft
          </Button>
        </Section>
      </div>
    </form>
  );
}
