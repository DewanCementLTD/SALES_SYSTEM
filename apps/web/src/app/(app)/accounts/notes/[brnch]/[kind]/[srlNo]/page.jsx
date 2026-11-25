'use client';

// One credit / debit note (TASKS P4-01): lines, totals, status and the commands its status allows:
// submit (DRAFT), cancel (DRAFT / waiting for approval), reverse (POSTED, BR-NOTE-05).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileMinus2, Loader2, RotateCcw, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { NOTE_TONE, noteStatusText } from '@/components/accounts/note-status';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const docOf = (kind) => (kind === 'D' ? 'DN' : 'CN');

export default function NotePage() {
  const { brnch, kind, srlNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(null); // 'cancel' | 'reverse'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const q = useQuery({
    queryKey: qk.note(brnch, kind, srlNo),
    queryFn: () => api(`/notes/${brnch}/${kind}/${srlNo}`),
  });
  const n = q.data;
  const path = `/notes/${brnch}/${kind}/${srlNo}`;
  const command = (cmd, body = {}) =>
    api(`${path}/${cmd}`, { method: 'POST', headers: { 'if-match': `"${n.rowVer}"` }, body });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notes'] });
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await command('submit');
      toast.success(
        r.requestId
          ? `Sent for approval (request #${r.requestId})`
          : 'Posted to the customer ledgers',
      );
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const title = n ? `${n.kind === 'D' ? 'Debit' : 'Credit'} note ${n.srlNo}` : 'Note';

  return (
    <>
      <PageHeader
        icon={FileMinus2}
        title={title}
        subtitle={n ? `${n.customerCode} ${n.customerName ?? ''}` : ''}
        crumbs={[
          { label: 'Accounts' },
          { label: 'Credit / debit notes', href: '/accounts/notes' },
          { label: `${docOf(kind)} ${srlNo}` },
        ]}
        actions={
          n && (
            <div className="flex flex-wrap gap-2">
              {n.status === 'DRAFT' && s.can('note.create') && (
                <Button onClick={submit} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}{' '}
                  Submit
                </Button>
              )}
              {['DRAFT', 'PENDING_APPROVAL'].includes(n.status) && s.can('note.create') && (
                <Button variant="outline" onClick={() => setDialog('cancel')}>
                  <XCircle className="size-4" /> Cancel note
                </Button>
              )}
              {n.status === 'POSTED' && !n.reversalOf && s.can('note.reverse') && (
                <Button variant="outline" onClick={() => setDialog('reverse')}>
                  <RotateCcw className="size-4" /> Reverse
                </Button>
              )}
            </div>
          )
        }
      />
      <ProblemAlert error={q.error ?? error} className="mb-3" />
      {n && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <Section title="Lines">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">#</th>
                  <th className="py-2 font-medium">Particular</th>
                  <th className="py-2 text-right font-medium">WHT %</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {n.lines.map((l) => (
                  <tr key={l.srNo} className="border-b last:border-0">
                    <td className="py-2">{l.srNo}</td>
                    <td className="py-2">{l.particular}</td>
                    <td className="py-2 text-right tabular-nums">{l.whtPct ?? '—'}</td>
                    <td className="py-2 text-right tabular-nums">{fmtPKR(l.amount)}</td>
                  </tr>
                ))}
                {!n.lines.length && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      No lines (legacy note).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {n.remarks && <p className="mt-3 text-sm text-muted-foreground">{n.remarks}</p>}
          </Section>
          <Section title="Summary">
            <dl className="space-y-1.5 text-sm">
              <Row label="Status">
                <StatusBadge tone={NOTE_TONE[n.status] ?? 'neutral'}>
                  {noteStatusText(n.status)}
                </StatusBadge>
              </Row>
              <Row label="Type">
                {n.noteType} {n.typeName ?? ''}
              </Row>
              <Row label="Date">{fmtDate(n.date)}</Row>
              {n.invoiceNo && <Row label="Invoice">INV {n.invoiceNo}</Row>}
              {n.transferCustomer && (
                <Row label="Balance transfer">
                  {n.kind === 'C'
                    ? `${n.transferCustomer} → ${n.customerCode}`
                    : `${n.customerCode} → ${n.transferCustomer} (reversed)`}
                </Row>
              )}
              <Row label="Lines">{fmtPKR(n.gross)}</Row>
              <Row label="WHT">− {fmtPKR(n.wht)}</Row>
              <div className="flex justify-between border-t pt-1.5 font-semibold">
                <dt>{n.kind === 'D' ? 'Debit' : 'Credit'}</dt>
                <dd className="tabular-nums">{fmtPKR(n.net)}</dd>
              </div>
              <Row label="Entered">
                {n.createdBy ?? '—'} · {fmtDateTime(n.createdOn)}
              </Row>
              {n.postedBy && (
                <Row label="Posted">
                  {n.postedBy} · {fmtDateTime(n.postedOn)}
                </Row>
              )}
              {n.status === 'PENDING_APPROVAL' && n.requestId && (
                <Row label="Approval">
                  <Link href="/approvals" className="text-primary hover:underline">
                    request #{n.requestId}
                  </Link>
                </Row>
              )}
              {n.reversalOf && (
                <Row label="Reverses">
                  <Link
                    href={`/accounts/notes/${n.brnch}/${n.kind === 'D' ? 'C' : 'D'}/${n.reversalOf}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {docOf(n.kind === 'D' ? 'C' : 'D')} {n.reversalOf}
                  </Link>
                </Row>
              )}
              {n.reversedBy && (
                <Row label="Reversed by">
                  <Link
                    href={`/accounts/notes/${n.brnch}/${n.kind === 'D' ? 'C' : 'D'}/${n.reversedBy}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {docOf(n.kind === 'D' ? 'C' : 'D')} {n.reversedBy}
                  </Link>
                </Row>
              )}
              {n.cancelReason && <Row label="Cancelled">{n.cancelReason}</Row>}
            </dl>
          </Section>
        </div>
      )}
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel the note"
        description="The note is closed without posting. Its number stays used."
        confirmLabel="Cancel note"
        destructive
        onConfirm={async (reason) => {
          await command('cancel', { reason });
          toast.success('Note cancelled');
          refresh();
        }}
      />
      <ReasonDialog
        open={dialog === 'reverse'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Reverse the note"
        description={`A ${n?.kind === 'D' ? 'credit' : 'debit'} note with the same lines is posted at once and this note becomes reversed.`}
        confirmLabel="Reverse"
        destructive
        onConfirm={async (reason) => {
          const r = await command('reverse', { reason });
          toast.success(`Reversed by ${docOf(r.reversal.kind)} ${r.reversal.srlNo}`);
          refresh();
        }}
      />
    </>
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
