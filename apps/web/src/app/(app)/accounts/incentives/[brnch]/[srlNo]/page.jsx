'use client';

// One incentive scheme (TASKS P4-03): products and rates; a draft can be previewed (per customer
// qty, rate, amount; lines already paid by an overlapping scheme are marked, BR-INC-03) and
// committed by the Finance Manager into DRAFT credit notes; a committed scheme lists them.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, Gift, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { NOTE_TONE, noteStatusText } from '@/components/accounts/note-status';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { useSession } from '@/lib/session';

const SCHEME_TONE = { DRAFT: 'info', COMMITTED: 'success', CANCELLED: 'neutral' };

export default function SchemePage() {
  const { brnch, srlNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const q = useQuery({
    queryKey: ['incentives', 'detail', Number(brnch), srlNo],
    queryFn: () => api(`/incentives/schemes/${brnch}/${srlNo}`),
  });
  const sc = q.data;
  const run = async (what) => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'preview') {
        setPreview(await api('/incentives/runs/preview', { method: 'POST', body: { srlNo } }));
      } else {
        const r = await api('/incentives/runs/commit', {
          method: 'POST',
          headers: { 'if-match': `"${sc.rowVer}"` },
          body: { srlNo },
        });
        toast.success(`${r.notes.length} draft credit note(s) created`);
        setPreview(null);
        qc.invalidateQueries({ queryKey: ['incentives'] });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const clashes = (preview?.customers ?? []).some((c) => c.lines.some((l) => l.paidBy));

  return (
    <>
      <PageHeader
        icon={Gift}
        title={`Incentive scheme INC ${srlNo}`}
        subtitle={
          sc
            ? `${fmtDate(sc.dateFrom)} – ${fmtDate(sc.dateTo)} · customers ${sc.customerFrom} … ${sc.customerTo}`
            : ''
        }
        crumbs={[
          { label: 'Accounts' },
          { label: 'Incentive runs', href: '/accounts/incentives' },
          { label: `INC ${srlNo}` },
        ]}
        actions={
          sc?.status === 'DRAFT' && (
            <div className="flex flex-wrap gap-2">
              {s.can('incentive.run') && (
                <Button variant="outline" onClick={() => run('preview')} disabled={!!busy}>
                  {busy === 'preview' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Eye className="size-4" />
                  )}{' '}
                  Preview
                </Button>
              )}
              {s.can('incentive.commit') && (
                <Button
                  onClick={() => run('commit')}
                  disabled={!!busy || !preview || clashes || !preview.customers.length}
                  title={!preview ? 'Preview first' : undefined}
                >
                  {busy === 'commit' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}{' '}
                  Commit
                </Button>
              )}
              {s.can('incentive.run') && (
                <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                  <XCircle className="size-4" /> Cancel
                </Button>
              )}
            </div>
          )
        }
      />
      <ProblemAlert error={q.error ?? error} className="mb-3" />
      {sc && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {preview && (
              <Section title={`Preview · ${fmtQty(preview.qtyTon)} t · ${fmtPKR(preview.amount)}`}>
                {clashes && (
                  <p
                    role="alert"
                    className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
                  >
                    Some lines were already paid by an overlapping scheme (BR-INC-03). Change the
                    period or products before committing.
                  </p>
                )}
                <RunTable
                  rows={preview.customers.flatMap((c) =>
                    c.lines.map((l) => ({
                      ...l,
                      customerCode: c.customerCode,
                      customerName: c.customerName,
                    })),
                  )}
                />
                {!preview.customers.length && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No invoiced quantity in this period, range and products.
                  </p>
                )}
              </Section>
            )}
            {sc.status === 'COMMITTED' && (
              <>
                <Section title="Run">
                  <RunTable rows={sc.details} />
                </Section>
                <Section title="Credit notes">
                  <ul className="space-y-1 text-sm">
                    {sc.notes.map((n) => (
                      <li key={n.srlNo} className="flex items-center justify-between gap-2">
                        <Link
                          href={`/accounts/notes/${sc.brnch}/C/${n.srlNo}`}
                          className="font-mono text-primary hover:underline"
                        >
                          CN {n.srlNo}
                        </Link>
                        <span className="font-mono">{n.customerCode}</span>
                        <span className="tabular-nums">{fmtPKR(n.net)}</span>
                        <StatusBadge tone={NOTE_TONE[n.status] ?? 'neutral'}>
                          {noteStatusText(n.status)}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
            )}
          </div>
          <Section title="Scheme">
            <dl className="space-y-1.5 text-sm">
              <Row label="Status">
                <StatusBadge tone={SCHEME_TONE[sc.status] ?? 'neutral'}>
                  {sc.status.toLowerCase()}
                </StatusBadge>
              </Row>
              <Row label="Memo">
                {sc.memoNo ?? '—'} · {fmtDate(sc.memoDate)}
              </Row>
              {sc.products.map((p) => (
                <Row key={p.productCode} label={`${p.productCode} ${p.productName ?? ''}`}>
                  {fmtPKR(p.rate)} / t
                </Row>
              ))}
              {sc.total && <Row label="Amount">{fmtPKR(sc.total)}</Row>}
              {sc.remarks && <p className="pt-2 text-muted-foreground">{sc.remarks}</p>}
              {sc.cancelReason && <Row label="Cancelled">{sc.cancelReason}</Row>}
            </dl>
          </Section>
        </div>
      )}
      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel the scheme"
        description="The draft scheme is closed; its number stays used."
        confirmLabel="Cancel scheme"
        destructive
        onConfirm={async (reason) => {
          await api(`/incentives/schemes/${brnch}/${srlNo}/cancel`, {
            method: 'POST',
            headers: { 'if-match': `"${sc.rowVer}"` },
            body: { reason },
          });
          toast.success('Scheme cancelled');
          qc.invalidateQueries({ queryKey: ['incentives'] });
        }}
      />
    </>
  );
}

function RunTable({ rows }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-2 font-medium">Customer</th>
          <th className="py-2 font-medium">Product</th>
          <th className="py-2 text-right font-medium">Qty (t)</th>
          <th className="py-2 text-right font-medium">Rate</th>
          <th className="py-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.customerCode}|${r.productCode}`} className="border-b last:border-0">
            <td className="py-2">
              <span className="font-mono">{r.customerCode}</span> {r.customerName ?? ''}
            </td>
            <td className="py-2">
              {r.productCode}
              {r.paidBy && (
                <StatusBadge tone="danger" className="ml-2">
                  paid by INC {r.paidBy}
                </StatusBadge>
              )}
            </td>
            <td className="py-2 text-right tabular-nums">{fmtQty(r.qtyTon)}</td>
            <td className="py-2 text-right tabular-nums">{fmtPKR(r.rate)}</td>
            <td className="py-2 text-right tabular-nums">{fmtPKR(r.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
