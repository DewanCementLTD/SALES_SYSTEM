'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDot, Loader2, ShieldCheck, Undo2, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { docLabel } from '@/components/approvals/request-card';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fmtDateTime, fmtPKR, fmtQty } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

export default function ApprovalDetailPage() {
  const { reqId } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.approval(reqId), queryFn: () => api(`/approvals/${reqId}`) });
  const [comment, setComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const done = (msg) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['approvals'] });
  };
  const approve = useMutation({
    mutationFn: () =>
      api(`/approvals/${reqId}/approve`, { method: 'POST', body: comment ? { comment } : {} }),
    onSuccess: (r) =>
      done(
        r.status === 'APPROVED'
          ? 'Approved'
          : `Approved level — now waiting for level ${r.currentLevel}`,
      ),
  });
  const cancel = useMutation({
    mutationFn: () => api(`/approvals/${reqId}/cancel`, { method: 'POST' }),
    onSuccess: () => done('Request withdrawn'),
  });

  if (q.isLoading)
    return (
      <Loader2
        className="mx-auto mt-20 size-6 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    );
  if (q.error) return <ProblemAlert error={q.error} />;
  const r = q.data;
  const pending = r.status === 'PENDING';
  const mine = r.requestedBy === s.user.usrid;
  const canDecide = pending && !mine && s.roles.includes(r.levelRoles[r.currentLevel - 1]);

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title={docLabel(r.docType)}
        subtitle={`Request #${r.reqId} · ${r.docKey}`}
        crumbs={[{ label: 'Approvals', href: '/approvals' }, { label: `#${r.reqId}` }]}
        actions={<StatusBadge status={r.status} className="px-3 py-1 text-sm" />}
      />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Section title="Request">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Requested by</dt>
                <dd className="font-medium">
                  {r.requestedBy} · {fmtDateTime(r.requestedOn)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Branch</dt>
                <dd className="font-medium">.{r.brnch}</dd>
              </div>
              {r.amount && (
                <div>
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="num text-left font-semibold">PKR {fmtPKR(r.amount)}</dd>
                </div>
              )}
              {r.qty && (
                <div>
                  <dt className="text-muted-foreground">Quantity</dt>
                  <dd className="font-semibold">{fmtQty(r.qty)} t</dd>
                </div>
              )}
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Reason</dt>
                <dd>{r.reason}</dd>
              </div>
              {r.expiresOn && (
                <div>
                  <dt className="text-muted-foreground">Expires</dt>
                  <dd>{fmtDateTime(r.expiresOn)}</dd>
                </div>
              )}
            </dl>
          </Section>
          <Section title="Data being approved (snapshot)">
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(r.snapshot, null, 2)}
            </pre>
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Levels">
            <ol className="space-y-3">
              {r.levelRoles.map((role, i) => {
                const h = r.history.find((x) => x.level === i + 1);
                const current = pending && r.currentLevel === i + 1;
                return (
                  <li key={role} className="flex gap-3">
                    {h ? (
                      h.decision === 'APPROVED' ? (
                        <Check className="mt-0.5 size-5 text-success" aria-hidden="true" />
                      ) : (
                        <X className="mt-0.5 size-5 text-danger" aria-hidden="true" />
                      )
                    ) : (
                      <CircleDot
                        className={`mt-0.5 size-5 ${current ? 'text-warning' : 'text-muted-foreground/50'}`}
                        aria-hidden="true"
                      />
                    )}
                    <div className="text-sm">
                      <div className="font-medium">
                        Level {i + 1}: {role.replace(/_/g, ' ').toLowerCase()}
                      </div>
                      {h ? (
                        <div className="text-muted-foreground">
                          {h.decision.toLowerCase()} by {h.decidedBy}, {fmtDateTime(h.decidedOn)}
                          {h.comments && <div className="italic">“{h.comments}”</div>}
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          {current ? 'Waiting' : 'Not reached'}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>
          {canDecide && (
            <Section title="Your decision">
              <div className="space-y-1.5">
                <Label htmlFor="comment">Comment (optional for approval)</Label>
                <Textarea
                  id="comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
              <ProblemAlert error={approve.error} className="mt-3" />
              <div className="mt-4 flex gap-2">
                <Button
                  className="flex-1 bg-success hover:bg-success/90"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                >
                  {approve.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  Approve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 border-danger/40 text-danger hover:bg-danger-soft"
                  onClick={() => setRejectOpen(true)}
                >
                  <X className="size-4" aria-hidden="true" /> Reject
                </Button>
              </div>
            </Section>
          )}
          {pending && mine && (
            <Section title="Your request">
              <p className="mb-3 text-sm text-muted-foreground">
                You cannot approve your own request (maker-checker).
              </p>
              <ProblemAlert error={cancel.error} className="mb-3" />
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                <Undo2 className="size-4" aria-hidden="true" /> Withdraw request
              </Button>
            </Section>
          )}
        </div>
      </div>
      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject request"
        description="The requester is notified with your reason."
        confirmLabel="Reject"
        destructive
        minLength={3}
        onConfirm={async (reason) => {
          await api(`/approvals/${reqId}/reject`, { method: 'POST', body: { comment: reason } });
          done('Rejected');
        }}
      />
    </>
  );
}
