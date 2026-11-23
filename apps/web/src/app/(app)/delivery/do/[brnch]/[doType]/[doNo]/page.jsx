'use client';

// DO detail (PRD 4.8): print (signed QR, barcode, watermark), send to dealer, hold/release, cancel
// (DO_CANCEL approval when active; the undispatched value returns to the balance, BR-DO-05),
// quantity adjustment advice (DO_ADJUST approval, BR-DO-06).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, Play, Printer, Scale, Send, Truck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { AdjustDialog } from '@/components/delivery/adjust-dialog';
import { DO_TONE } from '@/components/delivery/do-list';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { printAndOpen } from '@/lib/print';
import { fmtDate, fmtDateTime, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export default function DoDetailPage() {
  const { brnch, doType, doNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const key = qk.do(Number(brnch), doType, doNo);
  const q = useQuery({ queryKey: key, queryFn: () => api(`/do/${brnch}/${doType}/${doNo}`) });
  const d = q.data;
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const base = `/do/${brnch}/${doType}/${doNo}`;
  const mine = Number(brnch) === s.branch;
  const run = async (what, fn) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['do', 'list'] });
      qc.invalidateQueries({ queryKey: ['customers', 'balance'] });
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(null);
    }
  };
  const post = (path, body = {}) =>
    api(`${base}/${path}`, { method: 'POST', body, headers: { 'if-match': `"${d.rowVer}"` } });
  const print = () =>
    run('print', () =>
      printAndOpen({
        path: `${base}/print`,
        entity: 'DELIVERY_ORDER',
        entityKey: `${brnch}|${doType}|${doNo}`,
        label: 'DO',
      }),
    ).catch(() => {});
  const open = d && ['ISSUED', 'PARTLY_DISPATCHED', 'ON_HOLD'].includes(d.status);
  const rows = d
    ? [
        ['Customer', `${d.customerCode} · ${d.customerName ?? ''}`],
        ['Address', d.customerAddress ?? '—'],
        [
          'OC #',
          d.ocNo ? (
            <Link
              key="oc"
              href={`/orders/oc/${brnch}/${d.ocNo}`}
              className="text-primary hover:underline"
            >
              {d.ocNo}
            </Link>
          ) : (
            '—'
          ),
        ],
        ['DO type', `${d.doType}${d.doTypeName ? ` · ${d.doTypeName}` : ''}`],
        ['Product', d.productCode ?? '—'],
        ['Price code', d.priceCode ?? '—'],
        ['Destination', d.destName ?? '—'],
        ['Issued', fmtDate(d.issueDate)],
        ['Schedule date', fmtDate(d.schedDate)],
        ['Quantity', `${fmtQty(d.qtyTon)} t${d.bags ? ` (${d.bags} bags)` : ''}`],
        ['Dispatched', `${fmtQty(d.dispatchedTon)} t`],
        ['Remaining', `${fmtQty(d.remainingTon)} t`],
        ['Rate / value', d.rate ? `${fmtPKR(d.rate)}/t · ${fmtPKR(d.value)}` : '—'],
        ['Rate locked until', d.rateLockUntil ? fmtDate(d.rateLockUntil) : '—'],
        ['Sent to dealer', d.sentToDealerOn ? fmtDateTime(d.sentToDealerOn) : 'not yet'],
      ]
    : [];
  return (
    <>
      <PageHeader
        icon={Truck}
        title={`Delivery order ${doNo}`}
        subtitle={d ? `${d.customerCode} · ${d.customerName ?? ''}` : undefined}
        crumbs={[
          { label: 'Delivery' },
          { label: 'Delivery orders', href: '/delivery/do' },
          { label: doNo },
        ]}
      />
      <ProblemAlert error={q.error ?? error} className="mb-3" />
      {q.isLoading && <Loader2 className="mx-auto size-6 animate-spin" aria-label="Loading" />}
      {d && (
        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          <Section title="Delivery order">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b py-1.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {d.status === 'ON_HOLD' && (
              <p className="mt-3 rounded-md bg-danger/10 p-2 text-sm text-danger">
                On hold: {d.holdReason}
                {d.holdShortfall ? ` (shortfall ${fmtPKR(d.holdShortfall)})` : ''}. It cannot be
                dispatched until released.
              </p>
            )}
            {d.cancelReason && (
              <p className="mt-3 text-sm text-danger">
                Cancelled by {d.cancelledBy} on {fmtDateTime(d.cancelledOn)}: {d.cancelReason}
              </p>
            )}
          </Section>
          <aside>
            <Section title="Status / actions">
              <StatusBadge tone={DO_TONE[d.status]}>
                {d.status.toLowerCase().replace('_', ' ')}
              </StatusBadge>
              <div className="mt-4 grid gap-2">
                {s.can('do.print') && (
                  <Button variant="outline" disabled={!!busy} onClick={print}>
                    {busy === 'print' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Printer className="size-4" />
                    )}
                    Print DO
                  </Button>
                )}
                {mine && open && s.can('do.resend') && (
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      run('send', async () => {
                        await post('send', { channels: ['SMS', 'WHATSAPP'] });
                        toast.success('Queued to the dealer by SMS and WhatsApp');
                      }).catch(() => {})
                    }
                  >
                    <Send className="size-4" /> Send to dealer
                  </Button>
                )}
                {mine &&
                  ['ISSUED', 'PARTLY_DISPATCHED'].includes(d.status) &&
                  s.can('do.hold_release') && (
                    <Button variant="outline" onClick={() => setDialog('hold')}>
                      <Pause className="size-4" /> Put on hold
                    </Button>
                  )}
                {mine && d.status === 'ON_HOLD' && s.can('do.hold_release') && (
                  <Button
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      run('release', async () => {
                        await post('release');
                        toast.success('DO released');
                      }).catch(() => {})
                    }
                  >
                    <Play className="size-4" /> Release
                  </Button>
                )}
                {mine && open && d.rate && s.can('do.adjust') && (
                  <Button variant="outline" onClick={() => setDialog('adjust')}>
                    <Scale className="size-4" /> Adjust quantity
                  </Button>
                )}
                {mine && open && s.can('do.cancel') && (
                  <Button
                    variant="ghost"
                    className="text-danger"
                    onClick={() => setDialog('cancel')}
                  >
                    <XCircle className="size-4" /> Cancel DO
                  </Button>
                )}
              </div>
            </Section>
          </aside>
        </div>
      )}
      <AdjustDialog
        open={dialog === 'adjust'}
        onOpenChange={(o) => setDialog(o ? 'adjust' : null)}
        d={d}
        onConfirm={(body) =>
          run('adjust', async () => {
            const r = await post('adjust', body);
            toast.success(
              r.requestId
                ? `Advice ${r.advice.adviceNo} sent for approval (request #${r.requestId})`
                : `Advice ${r.advice.adviceNo}: DO adjusted to ${fmtQty(r.do.qtyTon)} t`,
            );
            qc.invalidateQueries({ queryKey: ['do-adjustments'] });
          })
        }
      />
      <ReasonDialog
        open={dialog === 'hold'}
        onOpenChange={(o) => setDialog(o ? 'hold' : null)}
        title={`Hold DO ${doNo}`}
        description="A held DO cannot be dispatched until it is released (BR-DO-07)."
        confirmLabel="Put on hold"
        onConfirm={(reason) =>
          run('hold', async () => {
            await post('hold', { reason });
            toast.success('DO on hold');
          })
        }
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
        title={`Cancel DO ${doNo}`}
        description="The undispatched quantity is cancelled and its value returns to the customer's balance. The Finance Manager approves when the DO cancel rule is active."
        impact={d ? `${fmtQty(d.remainingTon)} t not dispatched yet.` : undefined}
        confirmLabel="Cancel DO"
        destructive
        onConfirm={(reason) =>
          run('cancel', async () => {
            const r = await post('cancel', { reason });
            toast.success(
              r.requestId ? `Sent for approval (request #${r.requestId})` : 'DO cancelled',
            );
          })
        }
      />
    </>
  );
}
