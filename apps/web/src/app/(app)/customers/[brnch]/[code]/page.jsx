'use client';

// Customer detail (PRD 4.2, mockup page 1): tabbed card + right-side Approval/Status and Customer
// summary panels. Approve only for a checker other than the maker (BR-CUS-02); edits of tax profile
// or contact numbers on an approved customer become a change request.
import { CUSTOMER_FIELDS, CUSTOMER_TABS, zCustomerPatch } from '@dcl/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Loader2, Pencil, RotateCcw, Send, ShieldCheck, Users, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { CreditTab } from '@/components/customers/credit';
import { LinesTab } from '@/components/customers/lines-tab';
import { CustomerStatusBadge } from '@/components/customers/status';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { FieldInput, initialValue } from '@/components/masters/master-form-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

function TabForm({ c, tab, lookups, canEdit, onSaved }) {
  const fields = CUSTOMER_FIELDS.filter((f) => f.tab === tab);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(zCustomerPatch),
    defaultValues: Object.fromEntries(fields.map((f) => [f.name, initialValue(f, c)])),
  });
  const needsApproval =
    (c.status === 'APPROVED' || c.status === 'BLOCKED') && fields.some((f) => f.approval);

  const save = form.handleSubmit(async (values) => {
    setError(null);
    const dirty = Object.keys(form.formState.dirtyFields);
    if (!dirty.length) {
      setEditing(false);
      return;
    }
    try {
      const res = await api(`/customers/${c.brnch}/${c.customerCode}`, {
        method: 'PUT',
        body: Object.fromEntries(dirty.map((k) => [k, values[k]])),
        headers: { 'if-match': `"${c.rowVer}"` },
      });
      toast.success(
        res.requestId
          ? `Sent for approval: ${res.pendingFields.length} field(s). Other changes saved.`
          : 'Customer saved',
      );
      setEditing(false);
      onSaved();
    } catch (e) {
      for (const fe of e.errors ?? [])
        form.setError(fe.path.replace(/^body\./, ''), { message: fe.message });
      setError(e);
    }
  });

  return (
    <form onSubmit={save} noValidate>
      {needsApproval && (
        <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          Changes to the marked fields need approval (BR-CUS-02) and apply when approved.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.name} className="relative">
            <FieldInput
              f={f}
              form={form}
              disabled={!editing}
              options={f.kind === 'ref' ? lookups?.[f.ref] : undefined}
            />
            {needsApproval && f.approval && (
              <ShieldCheck
                className="absolute right-0 top-0 size-3.5 text-warning"
                aria-label="Needs approval"
              />
            )}
          </div>
        ))}
      </div>
      <ProblemAlert error={error} className="mt-3" />
      {canEdit && (
        <div className="mt-4 flex gap-2">
          {editing ? (
            <>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  form.reset();
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

function BlockDialog({ c, open, onOpenChange, onDone }) {
  const block = c.status !== 'BLOCKED';
  const [reason, setReason] = useState('');
  const [stop, setStop] = useState(false);
  const run = useMutation({
    mutationFn: () =>
      api(`/customers/${c.brnch}/${c.customerCode}/${block ? 'block' : 'unblock'}`, {
        method: 'POST',
        body: block ? { reason, stopDispatch: stop } : { reason },
        headers: { 'if-match': `"${c.rowVer}"` },
      }),
    onSuccess: () => {
      toast.success(block ? 'Customer blocked' : 'Customer unblocked');
      onOpenChange(false);
      onDone();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {block ? 'Block' : 'Unblock'} {c.customerCode}
          </DialogTitle>
          <DialogDescription>
            {block
              ? 'A blocked customer gets no new OC, permit or DO. Dispatch against existing DOs continues unless you stop it (BR-CUS-08).'
              : 'The customer can trade again.'}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="block-reason">Reason</Label>
          <Textarea
            id="block-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
          {reason.trim().length > 0 && reason.trim().length < 10 && (
            <p className="text-xs text-danger">At least 10 characters</p>
          )}
        </div>
        {block && (
          <div className="mt-3 flex items-center gap-2">
            <Checkbox id="stop-dispatch" checked={stop} onCheckedChange={(v) => setStop(!!v)} />
            <Label htmlFor="stop-dispatch">Also stop dispatch against existing DOs</Label>
          </div>
        )}
        <ProblemAlert error={run.error} className="mt-3" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={block ? 'destructive' : 'default'}
            disabled={reason.trim().length < 10 || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending && <Loader2 className="size-4 animate-spin" />}
            {block ? 'Block' : 'Unblock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusPanel({ c, onChanged }) {
  const s = useSession();
  const [deciding, setDeciding] = useState(null); // 'approve' | 'reject'
  const [blockOpen, setBlockOpen] = useState(false);
  const [comment, setComment] = useState('');
  const isMaker = c.createdBy === s.usrid || c.pendingApproval?.requestedBy === s.usrid;
  const canApprove =
    s.can('customer.approve') && (c.pendingApproval || c.status === 'PENDING_APPROVAL');
  const decide = useMutation({
    mutationFn: (cmd) =>
      api(`/customers/${c.brnch}/${c.customerCode}/${cmd}`, {
        method: 'POST',
        body: comment.trim() ? { comment: comment.trim() } : {},
      }),
    onSuccess: (_r, cmd) => {
      toast.success(cmd === 'approve' ? 'Approved' : 'Rejected');
      setDeciding(null);
      setComment('');
      onChanged();
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      api(`/customers/${c.brnch}/${c.customerCode}/submit`, {
        method: 'POST',
        headers: { 'if-match': `"${c.rowVer}"` },
      }),
    onSuccess: () => {
      toast.success('Sent for approval');
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const last = c.blocks.history[0];

  return (
    <Section title="Approval & status">
      <div className="space-y-3 text-sm">
        <CustomerStatusBadge status={c.status} active={c.active} />
        {c.pendingApproval && (
          <div className="rounded-md bg-warning-soft p-3 text-warning">
            {c.pendingApproval.action === 'CUSTOMER_CHANGE' ? 'Change request' : 'New customer'}{' '}
            waiting for approval (#{c.pendingApproval.requestId}) — sent by{' '}
            {c.pendingApproval.requestedBy}, {fmtDateTime(c.pendingApproval.requestedOn)}
          </div>
        )}
        {c.status === 'BLOCKED' && last && (
          <div className="rounded-md bg-danger/10 p-3 text-danger">
            Blocked: {last.reason}
            {last.stopDispatch ? ' — dispatch stopped' : ''}
          </div>
        )}
        {canApprove && (
          <>
            {isMaker ? (
              <p className="text-xs text-muted-foreground">
                You made this request, so someone else must approve it.
              </p>
            ) : deciding ? (
              <div className="space-y-2">
                <Label htmlFor="decision-comment">
                  Comment {deciding === 'reject' ? '(why)' : '(optional)'}
                </Label>
                <Textarea
                  id="decision-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                />
                <ProblemAlert error={decide.error} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={deciding === 'reject' ? 'destructive' : 'default'}
                    disabled={decide.isPending || (deciding === 'reject' && !comment.trim())}
                    onClick={() => decide.mutate(deciding)}
                  >
                    {decide.isPending && <Loader2 className="size-4 animate-spin" />}
                    Confirm {deciding}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeciding(null)}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setDeciding('approve')}>
                  <Check className="size-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-danger"
                  onClick={() => setDeciding('reject')}
                >
                  <X className="size-4" /> Reject
                </Button>
              </div>
            )}
          </>
        )}
        {c.status === 'DRAFT' && s.can('customer.update') && (
          <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
            <Send className="size-4" /> Send for approval again
          </Button>
        )}
        {s.can('customer.block') && (c.status === 'APPROVED' || c.status === 'BLOCKED') && (
          <Button
            size="sm"
            variant="outline"
            className={c.status === 'APPROVED' ? 'text-danger' : undefined}
            onClick={() => setBlockOpen(true)}
          >
            {c.status === 'APPROVED' ? (
              <Ban className="size-4" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {c.status === 'APPROVED' ? 'Block' : 'Unblock'}
          </Button>
        )}
      </div>
      <BlockDialog
        key={c.rowVer}
        c={c}
        open={blockOpen}
        onOpenChange={setBlockOpen}
        onDone={onChanged}
      />
    </Section>
  );
}

function SummaryPanel({ c }) {
  const rows = [
    [
      'Customer code',
      <span key="c" className="font-mono">
        {c.customerCode}
      </span>,
    ],
    ['Channel', c.channelName ?? c.channelCode],
    ['Customer zone', c.zoneName ? `${c.zoneCode} · ${c.zoneName}` : (c.zoneCode ?? '—')],
    ['Geography', c.geoPath.length ? c.geoPath.join(' › ') : 'not placed'],
    [
      'Created',
      c.createdBy ? `${c.createdBy}${c.createdOn ? `, ${fmtDate(c.createdOn)}` : ''}` : '—',
    ],
    ['Approved', c.approvedBy ? `${c.approvedBy}, ${fmtDate(c.approvedOn)}` : '—'],
  ];
  return (
    <Section title="Customer summary">
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export default function CustomerDetailPage() {
  const { brnch, code } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('info'));
  const key = qk.customer(Number(brnch), code);
  const q = useQuery({ queryKey: key, queryFn: () => api(`/customers/${brnch}/${code}`) });
  const lookups = useQuery({
    queryKey: qk.lookups(Number(brnch), 'channels,categories'),
    queryFn: () => api(`/lookups?types=channels,categories&brnch=${brnch}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['customers', 'list'] });
  };
  const c = q.data;
  const canEdit =
    s.can('customer.update') && c && c.status !== 'CLOSED' && Number(brnch) === s.branch;

  return (
    <>
      <PageHeader
        icon={Users}
        title={c ? c.customerName : 'Customer'}
        subtitle={c ? `${c.customerCode} · ${c.channelName ?? ''}` : undefined}
        crumbs={[{ label: 'Customers', href: '/customers' }, { label: code }]}
      />
      <ProblemAlert error={q.error} className="mb-3" />
      {q.isLoading && <Loader2 className="mx-auto size-6 animate-spin" aria-label="Loading" />}
      {c && (
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <Section>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-4 flex-wrap">
                {CUSTOMER_TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id}>
                    {t.label}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="credit">Credit limits</TabsTrigger>
                <TabsTrigger value="areas">Areas</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
                <TabsTrigger value="bank-accounts">Bank accounts</TabsTrigger>
                <TabsTrigger value="blocks">Blocks</TabsTrigger>
              </TabsList>
              {CUSTOMER_TABS.map((t) => (
                <TabsContent key={t.id} value={t.id}>
                  {tab === t.id && (
                    <TabForm
                      key={`${t.id}-${c.rowVer}`}
                      c={c}
                      tab={t.id}
                      lookups={lookups.data}
                      canEdit={canEdit}
                      onSaved={refresh}
                    />
                  )}
                </TabsContent>
              ))}
              <TabsContent value="credit">{tab === 'credit' && <CreditTab c={c} />}</TabsContent>
              {['areas', 'security', 'bank-accounts'].map((k) => (
                <TabsContent key={k} value={k}>
                  {tab === k && <LinesTab c={c} kind={k} canEdit={canEdit} />}
                </TabsContent>
              ))}
              <TabsContent value="blocks">
                <h3 className="mb-2 font-semibold text-brand-navy">Block history</h3>
                {c.blocks.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Never blocked in the new system.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {c.blocks.history.map((h) => (
                      <li key={h.blockId} className="rounded-md border p-2">
                        <StatusBadge tone={h.action === 'BLOCK' ? 'danger' : 'success'}>
                          {h.action.toLowerCase()}
                        </StatusBadge>{' '}
                        {h.reason}
                        {h.stopDispatch ? ' (dispatch stopped)' : ''} — {h.by}, {fmtDateTime(h.on)}
                      </li>
                    ))}
                  </ul>
                )}
                {c.blocks.legacyGroups.length > 0 && (
                  <>
                    <h3 className="mb-2 mt-5 font-semibold text-brand-navy">
                      Legacy block groups (read-only)
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {c.blocks.legacyGroups.map((g) => (
                        <StatusBadge key={g.group} tone="neutral">
                          {g.name ?? g.group}
                        </StatusBadge>
                      ))}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </Section>
          <aside className="space-y-4">
            <StatusPanel c={c} onChanged={refresh} />
            <SummaryPanel c={c} />
          </aside>
        </div>
      )}
    </>
  );
}
