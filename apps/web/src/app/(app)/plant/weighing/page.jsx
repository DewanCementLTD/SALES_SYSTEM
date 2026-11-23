'use client';

// Plant › Weighing (PRD 4.9, TASKS P3-05): choose the truck, live weight from the weighbridge
// agent (big digits, STABLE), capture tare then gross; net, planned, variance OVER/UNDER with the
// tolerance; re-weigh or ask for an override when blocked (BR-WGT-01…06). Manual weight only with
// weigh.manual and a reason.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Pencil, RefreshCw, Scale, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fmtQty } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAgent } from '@/lib/use-agent';
import { cn } from '@/lib/utils';

const WEIGHABLE = ['IN', 'TARE_DONE', 'VARIANCE_BLOCKED', 'GROSS_DONE', 'OVERRIDDEN'];
const kgFmt = (v) =>
  v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-PK')} kg`;

export default function WeighingPage() {
  const s = useSession();
  const qc = useQueryClient();
  const agent = useAgent();
  const [gpId, setGpId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [manual, setManual] = useState(null); // 'tare' | 'gross' | 'reweigh'
  const [manualKg, setManualKg] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [override, setOverride] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const board = useQuery({
    queryKey: ['plant', 'board'],
    queryFn: () => api('/plant/board'),
    refetchInterval: 15000,
  });
  const trucks = (board.data?.items ?? []).filter((g) => WEIGHABLE.includes(g.status));
  const gp = useQuery({
    queryKey: ['plant', 'gate-pass', gpId],
    queryFn: () => api(`/plant/gate-passes/${gpId}`),
    enabled: !!gpId,
  });
  const g = gp.data;
  const step =
    g?.status === 'IN'
      ? 'tare'
      : g?.status === 'TARE_DONE'
        ? 'gross'
        : g?.status === 'VARIANCE_BLOCKED'
          ? 'reweigh'
          : null;

  const send = async (path, body) => {
    const r = await api(`/plant/gate-passes/${gpId}/${path}`, {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body,
    });
    qc.invalidateQueries({ queryKey: ['plant'] });
    return r;
  };
  const after = (path, r) => {
    if (path === 'tare') {
      toast.success(`Tare ${kgFmt(r.gatePass.tareKg)} saved`);
      for (const w of r.warnings ?? []) toast.warning(w);
    } else if (r.varianceStatus === 'OK')
      toast.success(
        `Net ${kgFmt(r.net)} · variance ${r.variance > 0 ? '+' : ''}${r.variance} kg: OK`,
      );
    else
      toast.error(
        `Variance ${r.variance > 0 ? '+' : ''}${r.variance} kg is outside ±${r.toleranceKg} kg: re-weigh or ask for an override`,
      );
    invoiceNews(r);
  };
  /** BR-INV-01: invoices made right after the weighing, or why not */
  const invoiceNews = (r) => {
    if (r.invoices?.length)
      toast.success(
        `${r.invoices.length} invoice(s) made: ${r.invoices.map((i) => i.invoiceNo).join(', ')}`,
      );
    if (r.invoiceProblem)
      toast.error(`Not invoiced yet: ${r.invoiceProblem.detail}`, { duration: 10000 });
  };
  const finalise = async () => {
    setBusy('fin');
    setError(null);
    try {
      invoiceNews(await send('finalise', {}));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const captureFromAgent = async () => {
    setBusy('cap');
    setError(null);
    try {
      const c = await agent.capture();
      if (!c.uploaded)
        throw new Error(
          'The reading is saved on the weighbridge PC but not yet sent (network). Try again in a moment.',
        );
      after(step, await send(step, { deviceId: c.deviceId, readingId: c.readingId }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const saveManual = async (e) => {
    e.preventDefault();
    setBusy('man');
    setError(null);
    try {
      after(
        manual,
        await send(manual, { weightKg: Number(manualKg), reason: manualReason.trim() }),
      );
      setManual(null);
      setManualKg('');
      setManualReason('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        icon={Scale}
        title="Weighing"
        subtitle="Tare when the truck comes in empty, gross when it is loaded. Weights come from the weighbridge; manual entry only with permission and a reason."
        crumbs={[{ label: 'Plant' }, { label: 'Weighing' }]}
      />
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Section title="Trucks">
          <ul className="space-y-1">
            {trucks.map((x) => (
              <li key={x.gpId}>
                <button
                  type="button"
                  onClick={() => setGpId(x.gpId)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted',
                    gpId === x.gpId && 'border-primary bg-primary/5',
                  )}
                >
                  <div className="flex justify-between font-medium">
                    <span>{x.vehicleNo}</span>
                    <span className="text-muted-foreground">{x.waitMin} min</span>
                  </div>
                  <div className="text-muted-foreground">
                    GP {x.gpId} · DC {x.dcNo} · {x.status.toLowerCase().replace(/_/g, ' ')}
                  </div>
                </button>
              </li>
            ))}
            {!trucks.length && (
              <li className="py-4 text-center text-sm text-muted-foreground">No truck to weigh.</li>
            )}
          </ul>
        </Section>

        <div className="space-y-4">
          <Section title="Weighbridge">
            <div className="flex flex-wrap items-center gap-6">
              <div
                className={cn(
                  'min-w-72 rounded-xl border-2 px-6 py-4 text-right font-mono text-5xl tabular-nums',
                  agent.stable ? 'border-success text-success' : 'border-muted text-foreground',
                )}
                aria-live="polite"
                aria-label="Live weight"
              >
                {agent.connected && agent.online && agent.kg !== null
                  ? Number(agent.kg).toLocaleString('en-PK')
                  : '— — —'}
                <span className="ml-2 text-xl">kg</span>
              </div>
              <div className="space-y-1 text-sm">
                <StatusBadge tone={agent.stable ? 'success' : 'neutral'}>
                  {agent.stable ? 'STABLE' : 'moving'}
                </StatusBadge>
                <div className={agent.connected ? 'text-muted-foreground' : 'text-danger'}>
                  {!agent.connected
                    ? 'Weighbridge agent not running on this PC'
                    : !agent.online
                      ? 'Indicator offline (check the cable)'
                      : 'Indicator online'}
                </div>
                {agent.status && (
                  <div className="text-muted-foreground">
                    API {agent.status.apiOnline === false ? 'unreachable' : 'ok'} · waiting to send{' '}
                    {agent.status.pending}
                  </div>
                )}
              </div>
            </div>
          </Section>

          {g && (
            <Section title={`Gate pass ${g.gpId} · ${g.vehicleNo}`}>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                {[
                  ['Customer', `${g.customerCode ?? ''} ${g.customerName ?? ''}`],
                  ['DC', `${g.dcType} ${g.dcNo}`],
                  ['Planned', kgFmt(g.plannedKg)],
                  ['Tare', kgFmt(g.tareKg)],
                  ['Gross', kgFmt(g.grossKg)],
                  ['Net', kgFmt(g.netKg)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b py-1">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {g.varianceKg !== null && (
                <p
                  className={cn(
                    'mt-3 rounded-md p-2 text-sm font-medium',
                    g.varianceStatus === 'BLOCKED'
                      ? 'bg-danger/10 text-danger'
                      : g.varianceStatus === 'OVERRIDDEN'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-success/10 text-success',
                  )}
                >
                  Variance {g.varianceKg > 0 ? 'OVER +' : g.varianceKg < 0 ? 'UNDER ' : ''}
                  {g.varianceKg} kg ({g.variancePct}%) · {g.varianceStatus?.toLowerCase()}
                </p>
              )}
              {g.lines?.some((l) => l.allocNetKg !== null) && (
                <table className="mt-3 w-full text-sm [&_td]:px-2 [&_th]:px-2">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1">DO</th>
                      <th className="text-right">Planned (t)</th>
                      <th className="text-right">Net (t)</th>
                      <th>Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map((l) => (
                      <tr key={l.srNo} className="border-b">
                        <td className="py-1 font-mono">{l.doNo}</td>
                        <td className="text-right tabular-nums">{fmtQty(l.plannedTon)}</td>
                        <td className="text-right tabular-nums">
                          {l.allocNetKg === null ? '—' : fmtQty(l.allocNetKg / 1000)}
                        </td>
                        <td className="font-mono">
                          {g.invoices?.find((i) => i.invoiceId === l.invoiceId)?.invoiceNo ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <ProblemAlert error={error} className="mt-3" />
              <div className="mt-4 flex flex-wrap gap-2">
                {step && s.can('weigh.capture') && (
                  <Button
                    size="lg"
                    disabled={!agent.stable || busy === 'cap'}
                    onClick={captureFromAgent}
                  >
                    {busy === 'cap' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : step === 'reweigh' ? (
                      <RefreshCw className="size-4" />
                    ) : (
                      <Scale className="size-4" />
                    )}{' '}
                    {step === 'tare'
                      ? 'Capture tare'
                      : step === 'gross'
                        ? 'Capture gross'
                        : 'Re-weigh (new gross)'}
                  </Button>
                )}
                {step && s.can('weigh.manual') && (
                  <Button variant="outline" onClick={() => setManual(step)}>
                    <Pencil className="size-4" /> Enter weight by hand
                  </Button>
                )}
                {['GROSS_DONE', 'OVERRIDDEN'].includes(g.status) &&
                  s.can(['weigh.capture', 'dc.update']) && (
                    <Button variant="outline" disabled={busy === 'fin'} onClick={finalise}>
                      {busy === 'fin' && <Loader2 className="size-4 animate-spin" />} Finalise
                      invoices
                    </Button>
                  )}
                {['IN', 'TARE_DONE', 'GROSS_DONE', 'VARIANCE_BLOCKED', 'OVERRIDDEN'].includes(
                  g.status,
                ) &&
                  !g.lines?.some((l) => l.invoiceId) &&
                  s.can('gate.abort') && (
                    <Button
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setAbortOpen(true)}
                    >
                      <Ban className="size-4" /> Abort (not loaded)
                    </Button>
                  )}
                {g.status === 'VARIANCE_BLOCKED' && s.can('weigh.override') && (
                  <Button
                    variant="outline"
                    className="border-danger text-danger"
                    onClick={() => setOverride(true)}
                  >
                    <ShieldAlert className="size-4" /> Ask for override
                  </Button>
                )}
              </div>
            </Section>
          )}
        </div>
      </div>

      <Dialog open={!!manual} onOpenChange={(o) => !o && setManual(null)}>
        <DialogContent>
          <form onSubmit={saveManual} className="space-y-3">
            <DialogHeader>
              <DialogTitle>Manual {manual === 'tare' ? 'tare' : 'gross'} weight</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Recorded as MANUAL and shown on reports (BR-WGT-02).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="mw-kg">Weight (kg)</Label>
              <Input
                id="mw-kg"
                inputMode="numeric"
                value={manualKg}
                onChange={(e) => setManualKg(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mw-reason">Reason</Label>
              <Textarea
                id="mw-reason"
                rows={3}
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setManual(null)}>
                Close
              </Button>
              <Button
                type="submit"
                disabled={!manualKg || manualReason.trim().length < 10 || busy === 'man'}
              >
                Save weight
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ReasonDialog
        open={abortOpen}
        onOpenChange={setAbortOpen}
        title={`Abort gate pass ${gpId}`}
        description="The truck leaves without cement. The DC is cancelled (its number stays used); nothing is invoiced."
        confirmLabel="Abort"
        destructive
        onConfirm={async (reason) => {
          await send('abort', { reason });
          toast.success('Gate pass aborted');
          setGpId(null);
        }}
      />
      <ReasonDialog
        open={override}
        onOpenChange={setOverride}
        title={`Override the variance of gate pass ${gpId}`}
        description="The plant manager approves (approval rule WEIGHT_OVERRIDE). The truck stays blocked until then."
        confirmLabel="Send for approval"
        onConfirm={async (reason) => {
          const r = await send('request-weight-override', { reason });
          toast.success(
            r.requestId ? `Sent for approval (request #${r.requestId})` : 'Override recorded',
          );
          invoiceNews(r);
        }}
      />
    </>
  );
}
