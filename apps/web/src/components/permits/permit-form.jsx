'use client';

// City-wise permit (PRD 4.7, mockup page 5 layout; rules win: no expiry / 14-day block, valid from
// = issue date, rates from the rate sheet — BR-PMT-01/04). Header + area grid + balance panel and
// actions: save draft, issue, send to CFO, balance override, adjust quantity, cancel, print.
import { areaAmount, businessDate, dec, permitValue } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  MapPinned,
  Plus,
  Printer,
  Save,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Stamp,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { ReasonDialog } from '@/components/common/dialogs';
import { ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { LedgerAmount } from '@/components/customers/balance-panel';
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
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

export const PERMIT_TONE = {
  DRAFT: 'info',
  PENDING_CFO: 'warning',
  ISSUED: 'success',
  PARTLY_DISPATCHED: 'warning',
  DISPATCHED: 'success',
  CANCELLED: 'neutral',
};

const okQty = (q) => /^\d+(\.\d{1,3})?$/.test(q) && dec(q).gt(0);

/**
 * @param {{ brnch: number, permit?: any, can: (p: string) => boolean, mine: boolean,
 *   onSave: (body: any) => Promise<any>, command?: (path: string, body?: any) => Promise<any> }} p
 */
export function PermitForm({ brnch, permit, can, mine, onSave, command }) {
  const today = businessDate(new Date());
  const status = permit?.status ?? 'NEW';
  const draft = !permit || status === 'DRAFT';
  const editable = mine && draft && can(permit ? 'permit.update' : 'permit.create');
  const [customer, setCustomer] = useState(
    permit ? { customerCode: permit.customerCode, customerName: permit.customerName } : null,
  );
  const [productCode, setProduct] = useState(permit?.productCode ?? '');
  const [permitDate, setDate] = useState(permit?.permitDate ?? today);
  const [areas, setAreas] = useState(
    (permit?.areas ?? [])
      .filter((a) => a.status !== 'CANCELLED')
      .map((a) => ({
        areaDoc: a.areaDoc,
        areaName: a.areaName,
        qtyTon: a.qtyTon,
        rate: a.rate,
        sheetRate: a.sheetRate,
        lnkno: a.lnkno,
        dispatchedTon: a.dispatchedTon,
      })),
  );
  const [adjust, setAdjust] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);

  const lookups = useQuery({
    queryKey: qk.lookups(brnch, 'product-codes'),
    queryFn: () => api(`/lookups?types=product-codes&brnch=${brnch}`),
  });
  const rateParams = { product: productCode, date: permitDate };
  const rates = useQuery({
    queryKey: ['permits', 'city-rates', brnch, rateParams],
    queryFn: () => api(`/permits/city-rates${qs(rateParams)}`),
    enabled: draft && !!productCode && !!permitDate,
  });
  const bal = useQuery({
    queryKey: qk.customerBalance(brnch, customer?.customerCode),
    queryFn: () => api(`/customers/${brnch}/${customer.customerCode}/balance`),
    enabled: !!customer && can('customer.view_balance'),
  });
  const lines = areas.filter((a) => okQty(a.qtyTon) && a.rate);
  const value = permitValue(lines);
  const totalQty = lines.reduce((s, a) => s.plus(dec(a.qtyTon)), dec(0));
  const available = bal.data?.available;
  const short =
    draft && available !== undefined && dec(value).gt(dec(available))
      ? dec(value).minus(dec(available)).toFixed(2)
      : null;

  const run = async (what, fn) => {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(null);
    }
  };
  const body = () => ({
    permitDate,
    customerCode: customer?.customerCode ?? '',
    productCode,
    validTo: null,
    areas: areas.map((a) => ({
      areaDoc: a.areaDoc,
      qtyTon: a.qtyTon,
      rate:
        a.sheetRate !== null && a.sheetRate !== undefined && dec(a.rate || 0).eq(dec(a.sheetRate))
          ? null
          : a.rate || null,
    })),
  });
  const addArea = (doc) => {
    const l = rates.data?.lines.find((x) => x.areaDoc === doc);
    if (!l) return;
    setAreas([
      ...areas,
      { areaDoc: l.areaDoc, areaName: l.areaName, qtyTon: '', rate: l.rate, sheetRate: l.rate },
    ]);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <Section title="Permit" icon={Stamp}>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Permit no.</Label>
              <Input
                value={permit?.permitNo ?? 'Given when saved'}
                readOnly
                className="bg-secondary/50 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="permit-date">Permit date</Label>
              <Input
                id="permit-date"
                type="date"
                value={permitDate}
                disabled={!editable}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Valid from</Label>
              <Input
                value={permit?.validFrom ? fmtDate(permit.validFrom) : 'Issue date'}
                readOnly
                className="bg-secondary/50"
              />
              <p className="text-[11px] text-muted-foreground">No expiry (BR-PMT-04)</p>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="permit-customer">Customer</Label>
              <CustomerPicker
                id="permit-customer"
                brnch={brnch}
                value={customer}
                onChange={setCustomer}
                className={!editable || permit ? 'pointer-events-none' : undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="permit-product">Product</Label>
              <Select
                value={productCode}
                onValueChange={(v) => {
                  setProduct(v);
                  setAreas([]);
                }}
                disabled={!editable}
              >
                <SelectTrigger id="permit-product" className="w-full">
                  <SelectValue placeholder="Choose product" />
                </SelectTrigger>
                <SelectContent>
                  {(lookups.data?.['product-codes'] ?? []).map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.value} · {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section
          title="City detail"
          icon={MapPinned}
          actions={
            editable && (
              <Select value="" onValueChange={addArea} disabled={!productCode}>
                <SelectTrigger className="w-72" aria-label="Add area">
                  <SelectValue
                    placeholder={
                      rates.data?.sheet
                        ? `Add area (sheet ${rates.data.sheet.serno})`
                        : 'No approved rate sheet'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(rates.data?.lines ?? [])
                    .filter((l) => !areas.some((a) => a.areaDoc === l.areaDoc))
                    .map((l) => (
                      <SelectItem key={l.areaDoc} value={l.areaDoc}>
                        {l.areaName ?? l.areaDoc} ({l.areaDoc}) · {fmtPKR(l.rate)}/t
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )
          }
        >
          <table className="w-full text-sm">
            <thead className="bg-secondary/70 text-left">
              <tr>
                <th className="px-3 py-2">Area / city</th>
                <th className="px-3 py-2 text-right">Qty (t)</th>
                <th className="px-3 py-2 text-right">City rate</th>
                <th className="px-3 py-2 text-right">Amount</th>
                {!draft && <th className="px-3 py-2 text-right">Dispatched</th>}
                {!draft && <th className="px-3 py-2 text-right">Balance</th>}
                {(editable ||
                  (mine &&
                    ['ISSUED', 'PARTLY_DISPATCHED'].includes(status) &&
                    can('permit.adjust'))) && <th className="w-36" />}
              </tr>
            </thead>
            <tbody>
              {areas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-3 text-muted-foreground">
                    No area yet: choose the product, then add areas from the rate sheet.
                  </td>
                </tr>
              )}
              {areas.map((a, i) => {
                const ov =
                  a.sheetRate !== null &&
                  a.sheetRate !== undefined &&
                  a.rate &&
                  !dec(a.rate).eq(dec(a.sheetRate));
                return (
                  <tr key={a.areaDoc} className="border-t">
                    <td className="px-3 py-1.5">
                      {a.areaName ?? a.areaDoc}{' '}
                      <span className="text-xs text-muted-foreground">({a.areaDoc})</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {editable ? (
                        <Input
                          aria-label={`Quantity ${a.areaDoc}`}
                          className="ml-auto w-28 text-right tabular-nums"
                          value={a.qtyTon}
                          onChange={(e) =>
                            setAreas(
                              areas.map((x, j) => (j === i ? { ...x, qtyTon: e.target.value } : x)),
                            )
                          }
                        />
                      ) : (
                        <span className="tabular-nums">{fmtQty(a.qtyTon)}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {editable ? (
                        <Input
                          aria-label={`Rate ${a.areaDoc}`}
                          className={cn(
                            'ml-auto w-28 text-right tabular-nums',
                            ov && 'border-warning',
                          )}
                          value={a.rate}
                          onChange={(e) =>
                            setAreas(
                              areas.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)),
                            )
                          }
                        />
                      ) : (
                        <span className="tabular-nums">{fmtPKR(a.rate)}</span>
                      )}
                      {ov && (
                        <div className="text-[10px] text-warning">sheet {fmtPKR(a.sheetRate)}</div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {okQty(a.qtyTon) && a.rate ? fmtPKR(areaAmount(a.qtyTon, a.rate)) : '—'}
                    </td>
                    {!draft && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtQty(a.dispatchedTon)}
                      </td>
                    )}
                    {!draft && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtQty(
                          dec(a.qtyTon)
                            .minus(dec(a.dispatchedTon ?? 0))
                            .toFixed(3),
                        )}
                      </td>
                    )}
                    {editable && (
                      <td className="px-2 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${a.areaDoc}`}
                          onClick={() => setAreas(areas.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    )}
                    {!draft &&
                      mine &&
                      ['ISSUED', 'PARTLY_DISPATCHED'].includes(status) &&
                      can('permit.adjust') && (
                        <td className="px-2">
                          <Input
                            aria-label={`New quantity ${a.areaDoc}`}
                            placeholder="New qty"
                            className="w-28 text-right"
                            value={adjust[a.lnkno] ?? ''}
                            onChange={(e) => setAdjust({ ...adjust, [a.lnkno]: e.target.value })}
                          />
                        </td>
                      )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-secondary/60 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(totalQty.toFixed(3))}</td>
                <td />
                <td className="px-3 py-2 text-right tabular-nums">{fmtPKR(value)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
          {permit?.adjustments?.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-brand-navy">Quantity adjustments</h3>
              <ul className="space-y-1 text-sm">
                {permit.adjustments.map((x) => (
                  <li key={x.serno}>
                    {fmtDate(x.date)} · area {x.areaDoc}: {fmtQty(x.qtyTon)} t ({fmtPKR(x.amount)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <aside className="space-y-4">
        <Section title="Status / balance" icon={Wallet} className="xl:sticky xl:top-20">
          <StatusBadge tone={PERMIT_TONE[status] ?? 'info'}>
            {status === 'NEW' ? 'new' : status.toLowerCase().replace('_', ' ')}
          </StatusBadge>
          {bal.data && (
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Available balance</dt>
                <dd>
                  <LedgerAmount value={bal.data.available} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">DO ledger balance</dt>
                <dd>
                  <LedgerAmount value={bal.data.doLedgerBalance} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Permit value</dt>
                <dd className="font-semibold tabular-nums">{fmtPKR(value)}</dd>
              </div>
              {short && (
                <div className="flex justify-between text-danger">
                  <dt>Shortfall</dt>
                  <dd className="tabular-nums">{fmtPKR(short)}</dd>
                </div>
              )}
            </dl>
          )}
          {permit?.cancelReason && (
            <p className="mt-2 text-sm text-danger">Cancelled: {permit.cancelReason}</p>
          )}
          {permit?.cfoReqId && draft && (
            <p className="mt-2 text-xs text-success">CFO approved (request #{permit.cfoReqId}).</p>
          )}
          <ProblemAlert error={error} className="mt-3" />
          <div className="mt-4 grid gap-2">
            {editable && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => run('save', () => onSave(body())).catch(() => {})}
              >
                {busy === 'save' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save draft
              </Button>
            )}
            {permit && mine && status === 'DRAFT' && can('permit.issue') && (
              <Button
                className="bg-brand-orange hover:bg-brand-orange/90"
                disabled={!!busy}
                onClick={() => run('issue', () => command('issue')).catch(() => {})}
              >
                {busy === 'issue' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Stamp className="size-4" />
                )}
                Issue permit
              </Button>
            )}
            {permit && mine && status === 'DRAFT' && can('permit.send_cfo') && (
              <Button variant="outline" onClick={() => setDialog('cfo')}>
                <Send className="size-4" /> Send to CFO
              </Button>
            )}
            {permit &&
              mine &&
              short &&
              ['DRAFT', 'PENDING_CFO'].includes(status) &&
              can('permit.balance_override') && (
                <Button
                  variant="outline"
                  className="border-danger text-danger"
                  onClick={() => setDialog('override')}
                >
                  <ShieldAlert className="size-4" /> Request balance override
                </Button>
              )}
            {permit && mine && Object.values(adjust).some(Boolean) && (
              <Button variant="outline" onClick={() => setDialog('adjust')}>
                <SlidersHorizontal className="size-4" /> Save quantity adjustment
              </Button>
            )}
            {permit && can('permit.print') && status !== 'DRAFT' && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => run('print', () => command('print')).catch(() => {})}
              >
                <Printer className="size-4" /> Print permit
              </Button>
            )}
            {permit &&
              mine &&
              !['CANCELLED', 'DISPATCHED'].includes(status) &&
              can('permit.cancel') && (
                <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')}>
                  <XCircle className="size-4" /> Cancel permit
                </Button>
              )}
            {!permit && (
              <p className="text-xs text-muted-foreground">
                <Plus className="inline size-3" /> Save the draft, then issue it.
              </p>
            )}
          </div>
        </Section>
      </aside>

      <ReasonDialog
        open={dialog === 'cfo'}
        onOpenChange={(o) => setDialog(o ? 'cfo' : null)}
        title="Send to the CFO"
        description="The permit waits for the CFO and cannot be dispatched meanwhile (BR-PMT-03)."
        confirmLabel="Send"
        onConfirm={(reason) => run('cfo', () => command('send-cfo', { reason }))}
      />
      <ReasonDialog
        open={dialog === 'override'}
        onOpenChange={(o) => setDialog(o ? 'override' : null)}
        title="Request balance override"
        description={`Issue although the balance is short by ${fmtPKR(short)}. The CFO approves.`}
        confirmLabel="Send for approval"
        onConfirm={(reason) => run('override', () => command('request-override', { reason }))}
      />
      <ReasonDialog
        open={dialog === 'adjust'}
        onOpenChange={(o) => setDialog(o ? 'adjust' : null)}
        title="Adjust quantities"
        description="An increase is checked against the balance again (BR-PMT-06)."
        confirmLabel="Save adjustment"
        onConfirm={(reason) =>
          run('adjust', () =>
            command('adjust', {
              reason,
              lines: Object.entries(adjust)
                .filter(([, v]) => v)
                .map(([lnkno, qtyTon]) => ({ lnkno: Number(lnkno), qtyTon })),
            }),
          )
        }
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={`Cancel permit ${permit?.permitNo ?? ''}`}
        description="The undispatched value returns to the customer's balance (BR-PMT-07)."
        confirmLabel="Cancel permit"
        destructive
        onConfirm={(reason) => run('cancel', () => command('cancel', { reason }))}
      />
    </div>
  );
}
