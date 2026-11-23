'use client';

// Order Confirmation screen (PRD 4.5, mockup page 3 layout; rules win: status stepper
// DRAFT → REVIEWED → APPROVED → CONFIRMED, "Confirm" creates the DOs after the balance check,
// override badges on prices that differ from the trade price — BR-OC-02/06/07).
import {
  OC_PRICE_FIELDS,
  OC_PRICE_LABELS,
  dec,
  ocBreakdown,
  overriddenFields,
  splitSchedule,
  zOcUpdate,
} from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  Coins,
  Copy,
  FileCheck2,
  Link2,
  Loader2,
  Plus,
  Save,
  Send,
  ShieldAlert,
  Split,
  Trash2,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ReasonDialog } from '@/components/common/dialogs';
import { ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { LedgerAmount } from '@/components/customers/balance-panel';
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
import { cn } from '@/lib/utils';

export const OC_TONE = {
  DRAFT: 'info',
  REVIEWED: 'info',
  APPROVED: 'warning',
  CONFIRMED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
};
const STEPS = ['DRAFT', 'REVIEWED', 'APPROVED', 'CONFIRMED'];

function Stepper({ status }) {
  const at = STEPS.indexOf(status);
  return (
    <ol className="space-y-2" aria-label="Order status">
      {STEPS.map((s, i) => {
        const done = at >= i;
        const current = at === i;
        return (
          <li
            key={s}
            className="flex items-center gap-2 text-sm"
            aria-current={current ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                done ? 'border-primary bg-primary text-white' : 'text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn(current ? 'font-semibold' : !done && 'text-muted-foreground')}>
              {s.toLowerCase()}
            </span>
          </li>
        );
      })}
      {['CANCELLED', 'CLOSED'].includes(status) && (
        <li>
          <StatusBadge tone={OC_TONE[status]}>{status.toLowerCase()}</StatusBadge>
        </li>
      )}
    </ol>
  );
}

function Stat({ label, children, tone }) {
  return (
    <div className={cn('rounded-lg border p-3', tone)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{children}</div>
    </div>
  );
}

/**
 * @param {{ oc: any, can: (p: string) => boolean, mine: boolean,
 *   command: (path: string, body?: any, method?: string) => Promise<any>, onChanged: () => void }} p
 */
export function OcView({ oc, can, mine, command, onChanged }) {
  const editable = mine && ['DRAFT', 'REVIEWED'].includes(oc.status) && can('oc.update');
  const [prices, setPrices] = useState(oc.prices);
  const [qty, setQty] = useState(oc.qtyTon ?? '');
  const [remarks, setRemarks] = useState(oc.remarks ?? '');
  const [schedule, setSchedule] = useState(oc.schedule);
  const [links, setLinks] = useState(
    oc.brvs.map((l) => ({ receiptNo: l.receiptNo, amount: l.amount })),
  );
  const [doType, setDoType] = useState(oc.doTypes[0]?.value ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [dialog, setDialog] = useState(null);
  const bal = useQuery({
    queryKey: qk.ocBalance(oc.brnch, oc.ocNo, oc.rowVer),
    queryFn: () => api(`/oc/${oc.brnch}/${oc.ocNo}/balance`),
    enabled: can('customer.view_balance') && !['CANCELLED', 'CLOSED'].includes(oc.status),
  });
  const qtyOk = /^\d+(\.\d{1,2})?$/.test(qty);
  const live = ocBreakdown(prices, qtyOk ? qty : '0');
  const overridden = overriddenFields(oc.masterPrices, prices);
  const dirty =
    qty !== (oc.qtyTon ?? '') ||
    remarks !== (oc.remarks ?? '') ||
    JSON.stringify(prices) !== JSON.stringify(oc.prices) ||
    JSON.stringify(schedule) !== JSON.stringify(oc.schedule);
  const linksDirty =
    JSON.stringify(links) !==
    JSON.stringify(oc.brvs.map((l) => ({ receiptNo: l.receiptNo, amount: l.amount })));
  const total = schedule.reduce((s, l) => {
    try {
      return s.plus(dec(l.qtyTon || 0));
    } catch {
      return s;
    }
  }, dec(0));

  const run = async (what, fn) => {
    setError(null);
    setBusy(what);
    try {
      const r = await fn();
      onChanged();
      return r;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    run('save', async () => {
      const body = { qtyTon: qty, prices, remarks: remarks || null, schedule };
      const parsed = zOcUpdate.safeParse(body);
      if (!parsed.success) {
        const err = new Error(parsed.error.issues.map((i) => i.message).join('; '));
        err.title = 'Check the OC';
        throw err;
      }
      return command('', parsed.data, 'PUT');
    }).catch(() => {});
  const short = bal.data?.shortfall && Number(bal.data.shortfall) > 0 ? bal.data.shortfall : null;
  const linkTotal = links.reduce((s, l) => s.plus(dec(l.amount || 0)), dec(0));
  const freeOf = (no) => oc.linkableBrvs.find((b) => b.receiptNo === no)?.free;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-4">
        <Section title="Order" icon={FileCheck2}>
          <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <dt className="text-muted-foreground">Order #</dt>
              <dd className="font-mono font-medium">{oc.ocNo}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">SRF #</dt>
              <dd>
                {oc.srfNo ? (
                  <Link
                    href={`/orders/srf/${oc.brnch}/${oc.srfNo}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {oc.srfNo}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Date</dt>
              <dd>{fmtDate(oc.orderDate)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Product</dt>
              <dd>{oc.productCode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Destination</dt>
              <dd>{oc.destName ?? oc.destGeoCode ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                <Link
                  href={`/customers/${oc.brnch}/${oc.customerCode}`}
                  className="text-primary hover:underline"
                >
                  <span className="font-mono">{oc.customerCode}</span> {oc.customerName}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Price code</dt>
              <dd className="font-mono">{oc.priceCode ?? 'none (no trade price)'}</dd>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="oc-remarks" className="text-muted-foreground">
                Special instructions
              </Label>
              <Input
                id="oc-remarks"
                value={remarks}
                maxLength={100}
                disabled={!editable}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </dl>
        </Section>

        <Section
          title="Pricing (per ton)"
          icon={Coins}
          actions={
            overridden.length > 0 && (
              <StatusBadge tone={oc.priceOverride === 'A' ? 'success' : 'warning'}>
                {oc.priceOverride === 'A' ? 'override approved' : 'price override'}
              </StatusBadge>
            )
          }
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="oc-qty">Quantity (t)</Label>
                <Input
                  id="oc-qty"
                  inputMode="decimal"
                  className="text-right"
                  value={qty}
                  disabled={!editable}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              {OC_PRICE_FIELDS.map((k) => {
                const changed = overridden.includes(k);
                return (
                  <div key={k} className="space-y-1.5">
                    <Label htmlFor={`price-${k}`} className="flex items-center gap-2">
                      {OC_PRICE_LABELS[k]}
                      {changed && (
                        <span className="rounded bg-warning/15 px-1.5 text-[10px] font-semibold text-warning uppercase">
                          override
                        </span>
                      )}
                    </Label>
                    <Input
                      id={`price-${k}`}
                      inputMode="decimal"
                      className={cn('text-right tabular-nums', changed && 'border-warning')}
                      value={prices[k]}
                      disabled={!editable}
                      onChange={(e) => setPrices({ ...prices, [k]: e.target.value })}
                    />
                    {oc.masterPrices && (
                      <p className="text-[11px] text-muted-foreground">
                        Trade price: {fmtPKR(oc.masterPrices[k])}
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="space-y-1.5">
                <Label>{OC_PRICE_LABELS.tradeDiscPrice}</Label>
                <Input
                  value={fmtPKR(live.tradeDiscPrice)}
                  readOnly
                  className="bg-secondary/50 text-right"
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-xs text-muted-foreground">Net price</div>
                <div className="text-xl font-semibold tabular-nums">{fmtPKR(live.netPrice)}</div>
                <div className="text-[11px] text-muted-foreground">
                  consumer − expenses − discount
                </div>
              </div>
              <div className="rounded-lg bg-primary/10 p-3">
                <div className="text-xs text-muted-foreground">Total net value</div>
                <div className="text-xl font-semibold tabular-nums text-brand-navy">
                  {fmtPKR(live.value)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  ({fmtPKR(live.netPrice)} × {qtyOk ? fmtQty(qty) : '—'} t)
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Payment link (BRV)"
          icon={Link2}
          actions={
            mine &&
            !['CONFIRMED', 'CLOSED', 'CANCELLED'].includes(oc.status) &&
            can('oc.update') && (
              <Select
                value=""
                onValueChange={(no) =>
                  setLinks([...links, { receiptNo: no, amount: freeOf(no) ?? '0' }])
                }
              >
                <SelectTrigger className="w-64" aria-label="Add BRV link">
                  <SelectValue placeholder="Add a verified BRV…" />
                </SelectTrigger>
                <SelectContent>
                  {oc.linkableBrvs
                    .filter((b) => !links.some((l) => l.receiptNo === b.receiptNo))
                    .map((b) => (
                      <SelectItem key={b.receiptNo} value={b.receiptNo}>
                        {b.receiptNo} · {fmtDate(b.brvDate)} · free {fmtPKR(b.free)}
                      </SelectItem>
                    ))}
                  {oc.linkableBrvs.length === 0 && (
                    <SelectItem value="__none" disabled>
                      No verified BRV with money left
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )
          }
        >
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No BRV linked. Links show which receipts fund this order; confirmation is checked
              against the customer&apos;s available balance.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-secondary/70 text-left">
                <tr>
                  <th className="px-3 py-2">BRV #</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Applied (PKR)</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {links.map((l, i) => {
                  const known = oc.brvs.find((b) => b.receiptNo === l.receiptNo);
                  return (
                    <tr key={l.receiptNo} className="border-t">
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/payments/brv/${oc.brnch}/${l.receiptNo}`}
                          className="font-mono text-primary hover:underline"
                        >
                          {l.receiptNo}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5">
                        {(known?.brvStatus ?? 'VERIFIED').toLowerCase()}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Input
                          aria-label={`Applied amount ${l.receiptNo}`}
                          className="ml-auto w-36 text-right tabular-nums"
                          value={l.amount}
                          disabled={['CONFIRMED', 'CLOSED', 'CANCELLED'].includes(oc.status)}
                          onChange={(e) =>
                            setLinks(
                              links.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                            )
                          }
                        />
                      </td>
                      <td>
                        {!['CONFIRMED', 'CLOSED', 'CANCELLED'].includes(oc.status) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${l.receiptNo}`}
                            onClick={() => setLinks(links.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-semibold">
                  <td className="px-3 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtPKR(linkTotal.toFixed(2))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          {linksDirty && (
            <Button
              className="mt-3"
              variant="outline"
              disabled={!!busy}
              onClick={() => run('links', () => command('brvs', { links }, 'PUT')).catch(() => {})}
            >
              <Save className="size-4" /> Save payment links
            </Button>
          )}
        </Section>

        {can('customer.view_balance') && bal.data && (
          <Section title="Balance" icon={Wallet}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Available balance">
                <LedgerAmount value={bal.data.available} />
              </Stat>
              <Stat label="DO ledger balance">
                <LedgerAmount value={bal.data.doLedgerBalance} />
              </Stat>
              <Stat label="Collected today">{fmtPKR(bal.data.todayCollection.total)}</Stat>
              <Stat
                label={short ? 'Shortfall' : 'OC value'}
                tone={short ? 'border-danger/40 bg-danger/5 text-danger' : undefined}
              >
                {fmtPKR(short ?? oc.value)}
              </Stat>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Available = − DC ledger − open commitments ({fmtPKR(bal.data.openCommitments)}) +
              unused credit ({fmtPKR(bal.data.unusedCredit)}). Only verified BRVs count.
            </p>
          </Section>
        )}

        <Section
          title="Schedule"
          icon={CalendarDays}
          actions={
            editable && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!qtyOk}
                  onClick={() =>
                    setSchedule(
                      splitSchedule(
                        qty,
                        schedule.map((l) => l.date),
                      ),
                    )
                  }
                >
                  <Split className="size-4" /> Split evenly
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSchedule([
                      ...schedule,
                      {
                        srNo: Math.max(0, ...schedule.map((l) => l.srNo)) + 1,
                        date: schedule.at(-1)?.date ?? oc.orderDate,
                        qtyTon: '',
                      },
                    ])
                  }
                >
                  <Plus className="size-4" /> Add line
                </Button>
              </div>
            )
          }
        >
          <table className="w-full text-sm">
            <thead className="bg-secondary/70 text-left">
              <tr>
                <th className="px-3 py-2">Sr no</th>
                <th className="px-3 py-2">Schedule date</th>
                <th className="px-3 py-2 text-right">Quantity (t)</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {schedule.map((l, i) => (
                <tr key={l.srNo} className="border-t">
                  <td className="px-3 py-1.5">{l.srNo}</td>
                  <td className="px-3 py-1.5">
                    <Input
                      type="date"
                      className="w-44"
                      aria-label={`Schedule date ${l.srNo}`}
                      value={l.date ?? ''}
                      disabled={!editable}
                      onChange={(e) =>
                        setSchedule(
                          schedule.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Input
                      className="ml-auto w-32 text-right tabular-nums"
                      aria-label={`Schedule quantity ${l.srNo}`}
                      value={l.qtyTon ?? ''}
                      disabled={!editable}
                      onChange={(e) =>
                        setSchedule(
                          schedule.map((x, j) => (j === i ? { ...x, qtyTon: e.target.value } : x)),
                        )
                      }
                    />
                  </td>
                  <td>
                    {editable && schedule.length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove line ${l.srNo}`}
                        onClick={() => setSchedule(schedule.filter((_, j) => j !== i))}
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
                    qtyOk && !total.eq(dec(qty)) && 'text-danger',
                  )}
                >
                  {fmtQty(total.toFixed(3))} t
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Section>

        {oc.dos.length > 0 && (
          <Section title="Delivery orders" icon={Truck}>
            <table className="w-full text-sm">
              <thead className="bg-secondary/70 text-left">
                <tr>
                  <th className="px-3 py-2">DO #</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Schedule</th>
                  <th className="px-3 py-2 text-right">Qty (t)</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {oc.dos.map((d) => (
                  <tr key={`${d.doType}${d.doNo}`} className="border-t">
                    <td className="px-3 py-1.5 font-mono">{d.doNo}</td>
                    <td className="px-3 py-1.5">{d.doType}</td>
                    <td className="px-3 py-1.5">{fmtDate(d.schedDate)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(d.qtyTon)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtPKR(d.value)}</td>
                    <td className="px-3 py-1.5">{d.status.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>

      <aside className="space-y-4">
        <Section title="Status / actions" className="xl:sticky xl:top-20">
          <Stepper status={oc.status} />
          {oc.cancelReason && (
            <p className="mt-2 text-sm text-danger">Cancelled: {oc.cancelReason}</p>
          )}
          <ProblemAlert error={error} className="mt-3" />
          {mine && (
            <div className="mt-4 grid gap-2">
              {editable && (
                <Button variant="outline" disabled={!dirty || !!busy} onClick={save}>
                  {busy === 'save' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save changes
                </Button>
              )}
              {oc.priceOverride === 'Y' && !dirty && can('oc.price_override') && (
                <Button
                  variant="outline"
                  className="border-warning text-warning"
                  onClick={() => setDialog('price')}
                >
                  <ShieldAlert className="size-4" /> Request price override
                </Button>
              )}
              {oc.status === 'DRAFT' && can('oc.review') && (
                <Button
                  disabled={dirty || !!busy}
                  onClick={() => run('review', () => command('review')).catch(() => {})}
                >
                  <Send className="size-4" /> Mark reviewed
                </Button>
              )}
              {oc.status === 'REVIEWED' && can('oc.approve') && (
                <Button
                  className="bg-primary"
                  disabled={dirty || !!busy}
                  onClick={() => run('approve', () => command('approve')).catch(() => {})}
                >
                  <Check className="size-4" /> Approve OC
                </Button>
              )}
              {['REVIEWED', 'APPROVED'].includes(oc.status) && can('oc.approve') && (
                <Button variant="ghost" onClick={() => setDialog('reject')}>
                  Reject (back to draft)
                </Button>
              )}
              {oc.status === 'APPROVED' && can('oc.confirm') && (
                <div className="space-y-2 rounded-lg border p-2">
                  <Label htmlFor="do-type">DO type</Label>
                  <Select value={doType} onValueChange={setDoType}>
                    <SelectTrigger id="do-type" className="w-full">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {oc.doTypes.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.value} · {t.label}
                          {t.lastUsed ? ' (used before)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    className="w-full bg-brand-orange hover:bg-brand-orange/90"
                    disabled={!doType || !!busy}
                    onClick={() =>
                      run('confirm', () => command('confirm', { doType })).catch(() => {})
                    }
                  >
                    {busy === 'confirm' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Truck className="size-4" />
                    )}
                    Confirm &amp; create DOs
                  </Button>
                  {short && (
                    <p className="text-xs text-danger">
                      Short by {fmtPKR(short)}: collect the money (verified BRV) or ask for an
                      override.
                    </p>
                  )}
                </div>
              )}
              {short && oc.status === 'APPROVED' && can('oc.balance_override') && (
                <Button
                  variant="outline"
                  className="border-danger text-danger"
                  onClick={() => setDialog('balance')}
                >
                  <ShieldAlert className="size-4" /> Request balance override
                </Button>
              )}
              {!['CANCELLED', 'CLOSED'].includes(oc.status) && can('oc.cancel') && (
                <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')}>
                  <XCircle className="size-4" /> Cancel OC
                </Button>
              )}
              {can('oc.create') && (
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => run('dup', () => command('duplicate')).catch(() => {})}
                >
                  <Copy className="size-4" /> Duplicate OC
                </Button>
              )}
            </div>
          )}
        </Section>
      </aside>

      <ReasonDialog
        open={dialog === 'price'}
        onOpenChange={(o) => setDialog(o ? 'price' : null)}
        title="Request price override"
        description={`Prices that differ from the trade price: ${overridden.map((k) => OC_PRICE_LABELS[k]).join(', ')}. The Sales Manager approves.`}
        confirmLabel="Send for approval"
        onConfirm={(reason) =>
          run('po', () => command('request-override', { kind: 'PRICE', reason }))
        }
      />
      <ReasonDialog
        open={dialog === 'balance'}
        onOpenChange={(o) => setDialog(o ? 'balance' : null)}
        title="Request balance override"
        description={`Confirm although the balance is short by ${fmtPKR(short)}. The CFO approves.`}
        confirmLabel="Send for approval"
        onConfirm={(reason) =>
          run('bo', () => command('request-override', { kind: 'BALANCE', reason }))
        }
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => setDialog(o ? 'reject' : null)}
        title={`Reject OC ${oc.ocNo}`}
        description="The OC goes back to draft for changes."
        confirmLabel="Reject"
        onConfirm={(reason) => run('reject', () => command('reject', { reason }))}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={`Cancel OC ${oc.ocNo}`}
        description="This cannot be undone."
        impact={
          oc.dos.length
            ? `${oc.dos.filter((d) => d.status === 'ISSUED').length} open DO(s) are cancelled and their value returns to the customer's balance.`
            : undefined
        }
        confirmLabel="Cancel OC"
        destructive
        onConfirm={(reason) => run('cancel', () => command('cancel', { reason }))}
      />
    </div>
  );
}
