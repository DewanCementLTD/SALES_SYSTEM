'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, UserCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { AccessEditor } from '@/components/admin/access-editor';
import { DataTable } from '@/components/common/data-table';
import { OneTimeSecretDialog } from '@/components/common/dialogs';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const columns = [
  {
    accessorKey: 'usrid',
    header: 'User ID',
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
  },
  { accessorKey: 'fullName', header: 'Name' },
  { accessorKey: 'designation', header: 'Designation', cell: ({ getValue }) => getValue() ?? '—' },
  {
    accessorKey: 'homeBrnch',
    header: 'Home',
    cell: ({ getValue }) => (getValue() === 1 ? 'Karachi' : 'Hattar'),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: 'mustChangePassword',
    header: 'Password',
    cell: ({ getValue }) =>
      getValue() ? (
        <StatusBadge tone="warning">Must change</StatusBadge>
      ) : (
        <span className="text-muted-foreground">OK</span>
      ),
  },
  {
    accessorKey: 'lastLoginOn',
    header: 'Last sign-in',
    cell: ({ getValue }) => fmtDateTime(getValue()),
  },
];

function NewUserDialog({ open, onOpenChange, onCreated }) {
  const roles = useQuery({ queryKey: qk.roles, queryFn: () => api('/admin/roles'), enabled: open });
  const [f, setF] = useState({ usrid: '', fullName: '', designation: '', email: '', mobile: '' });
  const [access, setAccess] = useState([{ brnch: 1, isDefault: true, roles: [] }]);
  const create = useMutation({
    mutationFn: () =>
      api('/admin/users', {
        method: 'POST',
        body: {
          usrid: f.usrid.trim(),
          fullName: f.fullName.trim(),
          designation: f.designation || null,
          email: f.email || null,
          mobile: f.mobile || null,
          homeBrnch: (access.find((a) => a.isDefault) ?? access[0])?.brnch ?? 1,
          access,
        },
      }),
    onSuccess: (res) => {
      onCreated(res);
      setF({ usrid: '', fullName: '', designation: '', email: '', mobile: '' });
      setAccess([{ brnch: 1, isDefault: true, roles: [] }]);
    },
  });
  const field = (k, label, props = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`nu-${k}`}>{label}</Label>
      <Input
        id={`nu-${k}`}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        {...props}
      />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {field('usrid', 'User ID', { required: true, maxLength: 20, autoComplete: 'off' })}
            {field('fullName', 'Full name', { required: true })}
            {field('designation', 'Designation')}
            {field('email', 'E-mail', { type: 'email' })}
            {field('mobile', 'Mobile (03XXXXXXXXX)', { inputMode: 'tel' })}
          </div>
          <AccessEditor value={access} onChange={setAccess} roles={roles.data ?? []} />
          <ProblemAlert error={create.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || access.length === 0}>
              {create.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useQueryState('q', parseAsString.withDefault(''));
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault('all'));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [draft, setDraft] = useState(q);
  const [newOpen, setNewOpen] = useState(false);
  const [secret, setSecret] = useState(null);
  const params = { q, status: status === 'all' ? undefined : status, page, pageSize: 25 };
  const list = useQuery({
    queryKey: qk.users(params),
    queryFn: () => api(`/admin/users${qs(params)}`),
  });

  return (
    <>
      <PageHeader
        icon={UserCog}
        title="Users & branch access"
        subtitle="Accounts, branches and roles. Every change is audited."
        crumbs={[{ label: 'Admin' }, { label: 'Users' }]}
        actions={
          <Button
            onClick={() => setNewOpen(true)}
            className="bg-brand-orange hover:bg-brand-orange-hover"
          >
            <Plus className="size-4" aria-hidden="true" /> New user
          </Button>
        }
      />
      <Section>
        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draft || null);
            setPage(1);
          }}
        >
          <div className="relative w-full max-w-sm">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label="Search users"
              placeholder="User id or name"
              className="pl-9"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v === 'all' ? null : v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="LOCKED">Locked</SelectItem>
              <SelectItem value="DISABLED">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={setPage}
          onRowClick={(u) => router.push(`/admin/users/${u.userId}`)}
          rowKey={(u) => u.userId}
          empty="No users match."
        />
      </Section>
      <NewUserDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(res) => {
          setNewOpen(false);
          setSecret(res.temporaryPassword);
          qc.invalidateQueries({ queryKey: ['admin', 'users'] });
        }}
      />
      <OneTimeSecretDialog
        open={Boolean(secret)}
        onOpenChange={() => setSecret(null)}
        title="User created — temporary password"
        secret={secret ?? ''}
      />
    </>
  );
}
