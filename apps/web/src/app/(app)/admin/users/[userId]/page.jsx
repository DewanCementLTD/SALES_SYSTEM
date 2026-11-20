'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Lock, LockOpen, Save, UserCog } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AccessEditor } from '@/components/admin/access-editor';
import { OneTimeSecretDialog, ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';

function DetailsForm({ user }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    fullName: user.fullName,
    designation: user.designation ?? '',
    email: user.email ?? '',
    mobile: user.mobile ?? '',
    allowedFrom: user.allowedFrom ?? '',
    allowedTo: user.allowedTo ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/users/${user.userId}`, {
        method: 'PUT',
        headers: { 'if-match': `"${user.rowVer}"` },
        body: {
          fullName: f.fullName,
          designation: f.designation || null,
          email: f.email || null,
          mobile: f.mobile || null,
          homeBrnch: user.homeBrnch,
          allowedFrom: f.allowedFrom || null,
          allowedTo: f.allowedTo || null,
        },
      }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
  const field = (k, label, props = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`u-${k}`}>{label}</Label>
      <Input
        id={`u-${k}`}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        {...props}
      />
    </div>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field('fullName', 'Full name', { required: true })}
        {field('designation', 'Designation')}
        {field('email', 'E-mail', { type: 'email' })}
        {field('mobile', 'Mobile')}
        {field('allowedFrom', 'Login allowed from (HH:MM)', { placeholder: 'any time' })}
        {field('allowedTo', 'Login allowed to (HH:MM)', { placeholder: 'any time' })}
      </div>
      <ProblemAlert error={save.error} />
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-4" aria-hidden="true" />
        )}
        Save details
      </Button>
    </form>
  );
}

function AccessForm({ user }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: qk.roles, queryFn: () => api('/admin/roles') });
  const [access, setAccess] = useState(user.access);
  const save = useMutation({
    mutationFn: () => api(`/admin/users/${user.userId}/branches`, { method: 'PUT', body: access }),
    onSuccess: () => {
      toast.success('Access saved. It applies at the user’s next sign-in.');
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
  return (
    <div className="space-y-4">
      <AccessEditor value={access} onChange={setAccess} roles={roles.data ?? []} />
      <ProblemAlert error={save.error} />
      <Button onClick={() => save.mutate()} disabled={save.isPending || access.length === 0}>
        {save.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-4" aria-hidden="true" />
        )}
        Save access
      </Button>
    </div>
  );
}

export default function UserDetailPage() {
  const { userId } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.user(userId), queryFn: () => api(`/admin/users/${userId}`) });
  const [lockOpen, setLockOpen] = useState(false);
  const [secret, setSecret] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  const unlock = useMutation({
    mutationFn: () => api(`/admin/users/${userId}/unlock`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Unlocked');
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: () => api(`/admin/users/${userId}/reset-password`, { method: 'POST' }),
    onSuccess: (r) => {
      setSecret(r.temporaryPassword);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading)
    return (
      <Loader2
        className="mx-auto mt-20 size-6 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    );
  if (q.error) return <ProblemAlert error={q.error} />;
  const u = q.data;

  return (
    <>
      <PageHeader
        icon={UserCog}
        title={u.fullName}
        subtitle={`${u.usrid} · last sign-in ${fmtDateTime(u.lastLoginOn)}`}
        crumbs={[{ label: 'Admin' }, { label: 'Users', href: '/admin/users' }, { label: u.usrid }]}
        actions={
          <>
            <StatusBadge status={u.status} className="px-3 py-1 text-sm" />
            {u.status === 'ACTIVE' ? (
              <Button
                variant="outline"
                className="border-danger/40 text-danger hover:bg-danger-soft"
                onClick={() => setLockOpen(true)}
              >
                <Lock className="size-4" aria-hidden="true" /> Lock
              </Button>
            ) : (
              <Button variant="outline" onClick={() => unlock.mutate()} disabled={unlock.isPending}>
                <LockOpen className="size-4" aria-hidden="true" /> Unlock
              </Button>
            )}
            <Button variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending}>
              <KeyRound className="size-4" aria-hidden="true" /> Reset password
            </Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Details">
          <DetailsForm key={u.rowVer} user={u} />
        </Section>
        <Section title="Branches and roles">
          <AccessForm key={JSON.stringify(u.access)} user={u} />
        </Section>
      </div>
      <ReasonDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        title={`Lock ${u.usrid}?`}
        description="The user is signed out everywhere and cannot sign in until unlocked."
        confirmLabel="Lock user"
        destructive
        onConfirm={async (reason) => {
          await api(`/admin/users/${userId}/lock`, { method: 'POST', body: { reason } });
          toast.success('Locked');
          refresh();
        }}
      />
      <OneTimeSecretDialog
        open={Boolean(secret)}
        onOpenChange={() => setSecret(null)}
        title="Temporary password"
        secret={secret ?? ''}
      />
    </>
  );
}
