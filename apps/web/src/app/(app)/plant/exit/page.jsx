'use client';

// Plant › Exit (PRD 4.9, TASKS P3-08): scan the gate-pass QR on the DC (or pick the truck), see
// what still blocks it (BR-EXIT-02: invoices, variance, FBR numbers), let it out. When only the FBR
// number is missing and ALLOW_EXIT_WITHOUT_FBR = Y, a supervisor may ask for an override.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LogOut, QrCode, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { fmtPKR, fmtQty } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export default function ExitPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [qr, setQr] = useState('');
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [override, setOverride] = useState(false);
  const board = useQuery({ queryKey: ['plant', 'board'], queryFn: () => api('/plant/board') });
  const ready = (board.data?.items ?? []).filter((g) => g.status === 'INVOICED');

  const load = async (fn) => {
    setError(null);
    setBusy('load');
    try {
      setView(await fn());
    } catch (e) {
      setError(e);
      setView(null);
    } finally {
      setBusy(null);
    }
  };
  const scan = (e) => {
    e.preventDefault();
    if (qr.trim())
      load(() => api('/plant/exit-scan', { method: 'POST', body: { qr: qr.trim() } })).then(() =>
        setQr(''),
      );
  };
  const post = (path, body = {}) =>
    api(`/plant/gate-passes/${view.gatePass.gpId}/${path}`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body,
    });
  const letOut = async () => {
    setBusy('exit');
    setError(null);
    try {
      const gp = await post('exit');
      toast.success(`Truck ${gp.vehicleNo} left the plant`);
      setView(null);
      qc.invalidateQueries({ queryKey: ['plant'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const g = view?.gatePass;
  return (
    <>
      <PageHeader
        icon={LogOut}
        title="Exit"
        subtitle="Scan the gate-pass QR on the DC. The truck leaves only when every invoice has its FBR number."
        crumbs={[{ label: 'Plant' }, { label: 'Exit' }]}
      />
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Section title="Trucks ready to leave">
          <form onSubmit={scan} className="mb-3 flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ex-qr">Gate-pass QR</Label>
              <Input id="ex-qr" value={qr} onChange={(e) => setQr(e.target.value)} />
            </div>
            <Button type="submit" aria-label="Check the gate pass" disabled={busy === 'load'}>
              <QrCode className="size-4" />
            </Button>
          </form>
          <ul className="space-y-1">
            {ready.map((x) => (
              <li key={x.gpId}>
                <button
                  type="button"
                  className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => load(() => api(`/plant/gate-passes/${x.gpId}/exit-check`))}
                >
                  <div className="font-medium">{x.vehicleNo}</div>
                  <div className="text-muted-foreground">
                    GP {x.gpId} · DC {x.dcNo} · {x.waitMin} min
                  </div>
                </button>
              </li>
            ))}
            {!ready.length && (
              <li className="py-4 text-center text-sm text-muted-foreground">
                No invoiced truck waiting.
              </li>
            )}
          </ul>
        </Section>

        <div className="space-y-4">
          <ProblemAlert error={error} />
          {g && (
            <Section title={`Gate pass ${g.gpId} · ${g.vehicleNo}`}>
              <p className="text-sm text-muted-foreground">
                {g.customerCode} {g.customerName ?? ''} · DC {g.dcType} {g.dcNo} · net{' '}
                {fmtQty((g.netKg ?? 0) / 1000)} t
              </p>
              <div
                className={cn(
                  'mt-3 rounded-md p-3 text-sm',
                  view.checklist.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
                )}
              >
                {view.checklist.ok ? (
                  <span className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="size-4" /> Everything is in order.
                  </span>
                ) : (
                  <ul className="space-y-1">
                    {view.checklist.missing.map((m) => (
                      <li key={m} className="flex items-start gap-2">
                        <XCircle className="mt-0.5 size-4 shrink-0" /> {m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <table className="mt-3 w-full text-sm [&_td]:px-2 [&_th]:px-2">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1">Invoice</th>
                    <th>DO</th>
                    <th className="text-right">Qty (t)</th>
                    <th className="text-right">Proceeds</th>
                    <th>FBR</th>
                  </tr>
                </thead>
                <tbody>
                  {view.invoices.map((i) => (
                    <tr key={i.invoiceId} className="border-b">
                      <td className="py-1 font-mono">{i.invoiceNo}</td>
                      <td className="font-mono">{i.doNo}</td>
                      <td className="text-right tabular-nums">{fmtQty(i.qtyTon)}</td>
                      <td className="text-right tabular-nums">{fmtPKR(i.saleProceeds)}</td>
                      <td>
                        {i.fbrInvoiceNo ? (
                          <span className="font-mono text-xs">{i.fbrInvoiceNo}</span>
                        ) : (
                          <StatusBadge tone="warning">pending</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap gap-2">
                {s.can('gate.exit') && (
                  <Button size="lg" disabled={busy === 'exit'} onClick={letOut}>
                    <LogOut className="size-4" /> Let the truck out
                  </Button>
                )}
                {view.checklist.fbrPendingOnly && s.can('gate.exit_override') && (
                  <Button
                    variant="outline"
                    className="border-danger text-danger"
                    onClick={() => setOverride(true)}
                  >
                    <ShieldAlert className="size-4" /> Ask to exit without FBR
                  </Button>
                )}
              </div>
            </Section>
          )}
        </div>
      </div>
      <ReasonDialog
        open={override}
        onOpenChange={setOverride}
        title="Exit while FBR is pending"
        description="Allowed only when the company setting permits it; the plant manager approves (EXIT_WITHOUT_FBR)."
        confirmLabel="Send for approval"
        onConfirm={async (reason) => {
          const r = await post('request-exit-override', { reason });
          toast.success(`Sent for approval (request #${r.requestId})`);
        }}
      />
    </>
  );
}
