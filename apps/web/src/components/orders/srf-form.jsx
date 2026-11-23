'use client';

// SRF form (PRD 4.4, mockup page 2 layout; rules win: validity = SRF date + CONTRACT_VALID_MONTHS,
// "Submit" creates the draft OC — BR-SRF-05/07). Used for new and existing SRFs; read-only unless
// DRAFT in my branch.
import {
  DELIVERY_MODES,
  TAX_TYPES,
  TERMS_OF_SALE,
  bagsToTons,
  businessDate,
  contractValidTo,
  dec,
  splitSchedule,
  tonsToBags,
  zSrfBody,
} from '@dcl/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Printer,
  Save,
  Send,
  Split,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { ReasonDialog } from '@/components/common/dialogs';
import { ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { CustomerPicker } from '@/components/customers/customer-picker';
import { GeoPicker } from '@/components/customers/geo-picker';
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
import { Textarea } from '@/components/ui/textarea';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

export const SRF_TONE = {
  DRAFT: 'info',
  SUBMITTED: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'danger',
};

const BLANK = (today) => ({
  srfDate: today,
  customerCode: '',
  productCode: '',
  destGeoCode: '',
  bagCode: null,
  bagColour: null,
  qtyTon: '',
  bags: null,
  modeOfDelivery: 'BAGS',
  modeOfTransport: '',
  localExport: 'L',
  termOfSale: 'A',
  specialInstructions: '',
  remarks: '',
  doHandoverTo: '',
  taxProfile: { stType: '', strn: '', ntn: '', cnic: '' },
  export: { piNo: '', formE: '', lcNo: '' },
  legalRequirements: '',
  crRemarks: '',
  schedule: [{ srNo: 1, date: today, qtyTon: '' }],
});

/** API SRF → form values (nulls → '' for inputs). */
function toForm(srf) {
  return {
    ...BLANK(srf.srfDate),
    ...Object.fromEntries(Object.entries(srf).map(([k, v]) => [k, v ?? ''])),
    bagCode: srf.bagCode,
    bagColour: srf.bagColour,
    bags: srf.bags,
    qtyTon: srf.qtyTon ?? '',
    taxProfile: Object.fromEntries(Object.entries(srf.taxProfile).map(([k, v]) => [k, v ?? ''])),
    export: srf.export
      ? Object.fromEntries(Object.entries(srf.export).map(([k, v]) => [k, v ?? '']))
      : { piNo: '', formE: '', lcNo: '' },
    schedule: srf.schedule.length ? srf.schedule : [{ srNo: 1, date: srf.srfDate, qtyTon: '' }],
  };
}

/** Form values → API body ('' → null; export only for Export). */
function toBody(v) {
  const n = (x) => (x === '' || x === undefined ? null : x);
  return {
    ...v,
    bagCode: v.bagCode === '' ? null : v.bagCode,
    bagColour: v.bagColour === '' ? null : v.bagColour,
    specialInstructions: n(v.specialInstructions),
    remarks: n(v.remarks),
    doHandoverTo: n(v.doHandoverTo),
    legalRequirements: n(v.legalRequirements),
    crRemarks: n(v.crRemarks),
    taxProfile: Object.fromEntries(Object.entries(v.taxProfile).map(([k, x]) => [k, n(x)])),
    export:
      v.localExport === 'E'
        ? Object.fromEntries(Object.entries(v.export).map(([k, x]) => [k, n(x)]))
        : null,
  };
}

function Segmented({ value, onChange, options, label, disabled }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-md border bg-secondary/50 p-0.5"
    >
      {Object.entries(options).map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={disabled}
          onClick={() => onChange(v)}
          className={cn(
            'rounded px-4 py-1.5 text-sm transition-colors',
            value === v
              ? 'bg-brand-navy text-white shadow'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

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

function LookupSelect({ id, value, onChange, items, placeholder, disabled, numeric }) {
  return (
    <Select
      value={value === null || value === undefined || value === '' ? '' : String(value)}
      onValueChange={(v) => onChange(numeric ? Number(v) : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {(items ?? [])
          .filter((o) => o.active !== false || String(o.value) === String(value))
          .map((o) => (
            <SelectItem key={o.value} value={String(o.value)}>
              {o.value} · {o.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/**
 * @param {{ brnch: number, srf?: any, editable: boolean, canSubmit: boolean, canCancel: boolean,
 *   canPrint: boolean, onSave: (body: any) => Promise<any>, onSubmitSrf?: () => Promise<any>,
 *   onCancelSrf?: (reason: string) => Promise<any>, onPrint?: () => Promise<any> }} p
 */
export function SrfForm({
  brnch,
  srf,
  editable,
  canSubmit,
  canCancel,
  canPrint,
  onSave,
  onSubmitSrf,
  onCancelSrf,
  onPrint,
}) {
  const today = businessDate(new Date());
  const form = useForm({
    resolver: zodResolver(zSrfBody),
    defaultValues: srf ? toForm(srf) : BLANK(today),
  });
  const { control, register, setValue, getValues, formState } = form;
  const errors = formState.errors;
  const sched = useFieldArray({ control, name: 'schedule' });
  const w = useWatch({ control });
  const [customer, setCustomer] = useState(
    srf ? { customerCode: srf.customerCode, customerName: srf.customerName } : null,
  );
  const [otherCity, setOtherCity] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const lookups = useQuery({
    queryKey: qk.lookups(brnch, 'product-codes,bags,bag-colours,transport-modes'),
    queryFn: () =>
      api(`/lookups?types=product-codes,bags,bag-colours,transport-modes&brnch=${brnch}`),
  });
  const priceParams = {
    brnch,
    customer: w.customerCode || undefined,
    product: w.productCode || undefined,
    status: 'APPROVED',
    pageSize: 100,
  };
  const priced = useQuery({
    queryKey: ['pricing', 'trade-prices', priceParams],
    queryFn: () => api(`/pricing/trade-prices${qs(priceParams)}`),
    enabled: !!w.customerCode && !!w.productCode,
  });
  // latest approved price per destination (list is newest first)
  const destinations = [];
  for (const p of priced.data?.items ?? []) {
    if (p.geoCode && p.active && !destinations.some((d) => d.geoCode === p.geoCode))
      destinations.push(p);
  }
  const dest = destinations.find((d) => d.geoCode === w.destGeoCode);

  const total = (w.schedule ?? []).reduce((s, l) => {
    try {
      return s.plus(dec(l.qtyTon || 0));
    } catch {
      return s;
    }
  }, dec(0));
  const qtyOk = w.qtyTon && /^\d+(\.\d{1,2})?$/.test(w.qtyTon);
  const diff = qtyOk ? dec(w.qtyTon).minus(total) : null;

  const pickCustomer = (c) => {
    setCustomer(c);
    setValue('customerCode', c.customerCode, { shouldValidate: true });
    setValue('destGeoCode', '');
    // BR-SRF-04: tax fields default from the customer master (editable)
    setValue('taxProfile', {
      stType: c.salesTaxType ?? '',
      strn: c.strn ?? '',
      ntn: c.ntn ?? '',
      cnic: c.cnic ?? '',
    });
    if (!getValues('doHandoverTo')) setValue('doHandoverTo', c.customerName ?? '');
  };

  const setTons = (v) => {
    setValue('qtyTon', v, { shouldValidate: formState.isSubmitted });
    if (getValues('modeOfDelivery') === 'BAGS' && /^\d+(\.\d{1,2})?$/.test(v))
      setValue('bags', tonsToBags(v).toNumber());
  };
  const setBags = (v) => {
    const b = v === '' ? null : Number(v);
    setValue('bags', b);
    if (b !== null && Number.isInteger(b)) setValue('qtyTon', bagsToTons(b).toFixed(2));
  };
  const split = () => {
    const dates = getValues('schedule').map((l) => l.date);
    if (qtyOk) setValue('schedule', splitSchedule(w.qtyTon, dates), { shouldValidate: true });
  };

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
  const ro = !editable;
  const err = (path) => path.split('.').reduce((o, k) => o?.[k], errors)?.message;

  return (
    <form onSubmit={save} noValidate className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <Section title="Information" icon={FileText}>
          <fieldset disabled={ro} className="grid gap-4 md:grid-cols-2">
            <Field label="SRF #">
              <Input
                value={srf?.srfNo ?? 'Given when saved'}
                readOnly
                className="bg-secondary/50 font-mono"
              />
            </Field>
            <Field label="SRF date" htmlFor="srfDate" required error={err('srfDate')}>
              <Input id="srfDate" type="date" {...register('srfDate')} />
            </Field>
            <Field
              label="Customer"
              htmlFor="srf-customer"
              required
              error={err('customerCode')}
              className="md:col-span-2"
            >
              <CustomerPicker
                id="srf-customer"
                brnch={brnch}
                value={customer}
                onChange={pickCustomer}
                className={ro ? 'pointer-events-none' : undefined}
              />
            </Field>
            <Field label="Product" htmlFor="productCode" required error={err('productCode')}>
              <Controller
                control={control}
                name="productCode"
                render={({ field }) => (
                  <LookupSelect
                    id="productCode"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      setValue('destGeoCode', '');
                    }}
                    items={lookups.data?.['product-codes']}
                    placeholder="Choose product"
                    disabled={ro}
                  />
                )}
              />
            </Field>
            <Field
              label="Destination city"
              htmlFor="destGeoCode"
              required
              error={err('destGeoCode')}
            >
              {otherCity && !ro ? (
                <Controller
                  control={control}
                  name="destGeoCode"
                  render={({ field }) => (
                    <GeoPicker value={field.value} onChange={field.onChange} />
                  )}
                />
              ) : (
                <Controller
                  control={control}
                  name="destGeoCode"
                  render={({ field }) => (
                    <Select value={field.value || ''} onValueChange={field.onChange} disabled={ro}>
                      <SelectTrigger id="destGeoCode" className="w-full">
                        <SelectValue
                          placeholder={
                            !w.customerCode || !w.productCode
                              ? 'Choose customer and product first'
                              : priced.isLoading
                                ? 'Loading prices…'
                                : destinations.length
                                  ? 'City with a trade price'
                                  : 'No trade price for this customer and product'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {srf?.destGeoCode &&
                          !destinations.some((d) => d.geoCode === srf.destGeoCode) && (
                            <SelectItem value={srf.destGeoCode}>
                              {srf.destName ?? srf.destGeoCode}
                            </SelectItem>
                          )}
                        {destinations.map((d) => (
                          <SelectItem key={d.geoCode} value={d.geoCode}>
                            {d.geoName ?? d.geoCode} · {fmtPKR(d.invoicePrice)}/t ({d.priceCode})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
              {!ro && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setOtherCity((x) => !x)}
                >
                  {otherCity
                    ? 'Choose from priced cities'
                    : 'Other city (no trade price: the OC is priced by hand)'}
                </button>
              )}
            </Field>
            <Field label="Local / Export" required>
              <Controller
                control={control}
                name="localExport"
                render={({ field }) => (
                  <Segmented
                    label="Local or export"
                    value={field.value}
                    onChange={field.onChange}
                    options={{ L: 'Local', E: 'Export' }}
                    disabled={ro}
                  />
                )}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['piNo', 'P.I. No.'],
                ['formE', 'Form-E'],
                ['lcNo', 'L.C. No.'],
              ].map(([k, l]) => (
                <Field key={k} label={l} htmlFor={`export.${k}`} error={err(`export.${k}`)}>
                  <Input
                    id={`export.${k}`}
                    disabled={ro || w.localExport !== 'E'}
                    {...register(`export.${k}`)}
                  />
                </Field>
              ))}
            </div>
            <Field label="Quantity in tons" htmlFor="qtyTon" required error={err('qtyTon')}>
              <Input
                id="qtyTon"
                inputMode="decimal"
                value={w.qtyTon ?? ''}
                onChange={(e) => setTons(e.target.value)}
              />
            </Field>
            <Field label="Quantity in bags" htmlFor="bags" error={err('bags')}>
              <Input
                id="bags"
                inputMode="numeric"
                value={w.bags ?? ''}
                disabled={ro || w.modeOfDelivery !== 'BAGS'}
                onChange={(e) => setBags(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">20 bags = 1 ton</p>
            </Field>
            <Field label="Mode of delivery" required>
              <Controller
                control={control}
                name="modeOfDelivery"
                render={({ field }) => (
                  <Segmented
                    label="Mode of delivery"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v);
                      if (v === 'BULK') setValue('bags', null);
                      else if (qtyOk) setValue('bags', tonsToBags(w.qtyTon).toNumber());
                    }}
                    options={DELIVERY_MODES}
                    disabled={ro}
                  />
                )}
              />
            </Field>
            <Field
              label="Mode of transport"
              htmlFor="modeOfTransport"
              required
              error={err('modeOfTransport')}
            >
              <Controller
                control={control}
                name="modeOfTransport"
                render={({ field }) => (
                  <LookupSelect
                    id="modeOfTransport"
                    value={field.value}
                    onChange={field.onChange}
                    items={lookups.data?.['transport-modes']}
                    placeholder="Choose"
                    disabled={ro}
                  />
                )}
              />
            </Field>
            <Field label="Term of sale" htmlFor="termOfSale" required>
              <Controller
                control={control}
                name="termOfSale"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={ro}>
                    <SelectTrigger id="termOfSale" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TERMS_OF_SALE).map(([v, l]) => (
                        <SelectItem key={v} value={v}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Bag" htmlFor="bagCode" error={err('bagCode')}>
                <Controller
                  control={control}
                  name="bagCode"
                  render={({ field }) => (
                    <LookupSelect
                      id="bagCode"
                      numeric
                      value={field.value}
                      onChange={field.onChange}
                      items={lookups.data?.bags}
                      placeholder="Bag type"
                      disabled={ro}
                    />
                  )}
                />
              </Field>
              <Field label="Bag colour" htmlFor="bagColour" error={err('bagColour')}>
                <Controller
                  control={control}
                  name="bagColour"
                  render={({ field }) => (
                    <LookupSelect
                      id="bagColour"
                      numeric
                      value={field.value}
                      onChange={field.onChange}
                      items={lookups.data?.['bag-colours']}
                      placeholder="Colour"
                      disabled={ro}
                    />
                  )}
                />
              </Field>
            </div>
            <Field
              label="Special instructions"
              htmlFor="specialInstructions"
              className="md:col-span-2"
              error={err('specialInstructions')}
            >
              <Textarea
                id="specialInstructions"
                rows={2}
                maxLength={100}
                {...register('specialInstructions')}
              />
            </Field>
            <Field label="S.Tax type" htmlFor="taxProfile.stType">
              <Controller
                control={control}
                name="taxProfile.stType"
                render={({ field }) => (
                  <Select value={field.value || ''} onValueChange={field.onChange} disabled={ro}>
                    <SelectTrigger id="taxProfile.stType" className="w-full">
                      <SelectValue placeholder="From customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_TYPES.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="S.Tax reg #" htmlFor="taxProfile.strn" error={err('taxProfile.strn')}>
              <Input id="taxProfile.strn" {...register('taxProfile.strn')} />
            </Field>
            <Field label="CNIC" htmlFor="taxProfile.cnic" error={err('taxProfile.cnic')}>
              <Input id="taxProfile.cnic" {...register('taxProfile.cnic')} />
            </Field>
            <Field label="NTN" htmlFor="taxProfile.ntn" error={err('taxProfile.ntn')}>
              <Input id="taxProfile.ntn" {...register('taxProfile.ntn')} />
            </Field>
            <Field
              label="D/O to be handed over to"
              htmlFor="doHandoverTo"
              className="md:col-span-2"
              error={err('doHandoverTo')}
            >
              <Input id="doHandoverTo" maxLength={60} {...register('doHandoverTo')} />
            </Field>
            <Field
              label="Legal requirements (Contract Review)"
              htmlFor="legalRequirements"
              error={err('legalRequirements')}
            >
              <Textarea id="legalRequirements" rows={2} {...register('legalRequirements')} />
            </Field>
            <Field
              label="Remarks / comments (Contract Review)"
              htmlFor="crRemarks"
              error={err('crRemarks')}
            >
              <Textarea id="crRemarks" rows={2} {...register('crRemarks')} />
            </Field>
          </fieldset>
        </Section>

        <Section
          title="Schedule"
          icon={CalendarDays}
          actions={
            !ro && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={split} disabled={!qtyOk}>
                  <Split className="size-4" /> Split quantity evenly
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const lines = getValues('schedule');
                    sched.append({
                      srNo: Math.max(0, ...lines.map((l) => l.srNo)) + 1,
                      date: lines.at(-1)?.date ?? today,
                      qtyTon: diff && diff.gt(0) ? diff.toFixed(2) : '',
                    });
                  }}
                >
                  <Plus className="size-4" /> Add line
                </Button>
              </div>
            )
          }
        >
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/70 text-left">
                <tr>
                  <th className="px-3 py-2">Sr no</th>
                  <th className="px-3 py-2">Schedule date</th>
                  <th className="px-3 py-2 text-right">Quantity (t)</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {sched.fields.map((f, i) => (
                  <tr key={f.id} className="border-t">
                    <td className="px-3 py-1.5">{w.schedule?.[i]?.srNo}</td>
                    <td className="px-3 py-1.5">
                      <Input
                        type="date"
                        aria-label={`Schedule date ${i + 1}`}
                        disabled={ro}
                        className="w-44"
                        {...register(`schedule.${i}.date`)}
                      />
                      {err(`schedule.${i}.date`) && (
                        <p className="text-xs text-danger">{err(`schedule.${i}.date`)}</p>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Input
                        inputMode="decimal"
                        aria-label={`Schedule quantity ${i + 1}`}
                        disabled={ro}
                        className="ml-auto w-32 text-right tabular-nums"
                        {...register(`schedule.${i}.qtyTon`)}
                      />
                    </td>
                    <td className="px-2">
                      {!ro && sched.fields.length > 1 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove line ${i + 1}`}
                          onClick={() => sched.remove(i)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-secondary/60 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>
                    Total quantity
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      diff && !diff.isZero() && 'text-danger',
                    )}
                  >
                    {fmtQty(total.toFixed(3))} t
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {(err('schedule') || err('schedule.root')) && (
            <p className="mt-2 text-sm text-danger">{err('schedule') ?? err('schedule.root')}</p>
          )}
          {diff && !diff.isZero() && (
            <p className="mt-2 text-sm text-danger">
              Schedule must total the SRF quantity:{' '}
              {diff.gt(0)
                ? `${diff.toFixed(2)} t still to schedule`
                : `${diff.abs().toFixed(2)} t too much`}{' '}
              (BR-SRF-02).
            </p>
          )}
        </Section>
      </div>

      <aside className="space-y-4">
        <Section title="SRF summary" icon={ClipboardList} className="xl:sticky xl:top-20">
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge tone={SRF_TONE[srf?.status ?? 'DRAFT']}>
                  {(srf?.status ?? 'new').toLowerCase()}
                </StatusBadge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Customer</dt>
              <dd className="text-right">{customer?.customerName ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Product</dt>
              <dd className="text-right">
                {lookups.data?.['product-codes']?.find((p) => p.value === w.productCode)?.label ??
                  (w.productCode || '—')}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total quantity</dt>
              <dd className="text-right font-semibold">
                {qtyOk ? `${fmtQty(w.qtyTon)} t` : '—'}
                {w.bags ? <span className="block text-xs font-normal">({w.bags} bags)</span> : null}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Trade price</dt>
              <dd className="text-right">
                {dest
                  ? `${fmtPKR(dest.invoicePrice)}/t`
                  : w.destGeoCode
                    ? 'none: priced on the OC'
                    : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Contract valid to</dt>
              <dd className="text-right">
                {srf?.contractValidTo
                  ? fmtDate(srf.contractValidTo)
                  : w.srfDate
                    ? fmtDate(contractValidTo(w.srfDate, 3))
                    : '—'}
                <span className="block text-xs text-muted-foreground">
                  SRF date + 3 months (setting)
                </span>
              </dd>
            </div>
            {srf?.ocNo && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Order confirmation</dt>
                <dd className="font-mono">{srf.ocNo}</dd>
              </div>
            )}
            {srf?.cancelReason && (
              <div>
                <dt className="text-muted-foreground">Cancelled</dt>
                <dd>{srf.cancelReason}</dd>
              </div>
            )}
          </dl>
          <ul className="mt-4 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>
              Submit creates the draft order confirmation with the trade price of the destination.
            </li>
            <li>Export fields (P.I. No., Form-E, L.C. No.) are needed for export orders only.</li>
            <li>The SRF can be cancelled until its OC is confirmed.</li>
          </ul>
          <ProblemAlert error={error} className="mt-3" />
          <div className="mt-4 grid gap-2">
            {editable && (
              <Button type="submit" variant="outline" disabled={!!busy}>
                {busy === 'save' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save draft
              </Button>
            )}
            {canPrint && srf && (
              <Button
                type="button"
                className="bg-primary"
                disabled={!!busy}
                onClick={() => run('print', onPrint)}
              >
                {busy === 'print' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Printer className="size-4" />
                )}
                Print Contract Review Form
              </Button>
            )}
            {canSubmit && (
              <Button
                type="button"
                className="bg-brand-orange hover:bg-brand-orange/90"
                disabled={!!busy || form.formState.isDirty}
                title={form.formState.isDirty ? 'Save the draft first' : undefined}
                onClick={() => run('submit', onSubmitSrf)}
              >
                {busy === 'submit' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Submit (create OC)
              </Button>
            )}
            {canCancel && (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                onClick={() => setCancelOpen(true)}
              >
                <XCircle className="size-4" /> Cancel SRF
              </Button>
            )}
          </div>
        </Section>
      </aside>
      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel SRF ${srf?.srfNo ?? ''}`}
        description="The SRF cannot be used after this."
        impact={srf?.ocNo ? `Draft OC ${srf.ocNo} is cancelled with it.` : undefined}
        confirmLabel="Cancel SRF"
        destructive
        onConfirm={(reason) => onCancelSrf(reason)}
      />
    </form>
  );
}
