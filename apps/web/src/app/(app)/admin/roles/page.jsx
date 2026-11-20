'use client';

// Roles & permissions matrix editor (TASKS P0-16, PERMISSIONS §3). Saving replaces the role's
// permission set; the API audits what was added and removed.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

function Matrix({ role, permissions, onSaved }) {
  const [selected, setSelected] = useState(() => new Set(role.permissions));
  const [filter, setFilter] = useState('');
  const modules = useMemo(() => {
    const m = new Map();
    for (const p of permissions) {
      if (filter && !p.key.includes(filter.toLowerCase())) continue;
      m.set(p.module, [...(m.get(p.module) ?? []), p]);
    }
    return [...m];
  }, [permissions, filter]);
  const dirty =
    selected.size !== role.permissions.length || role.permissions.some((k) => !selected.has(k));
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/roles/${role.code}`, {
        method: 'PUT',
        body: {
          name: role.name,
          descr: role.descr,
          active: role.active,
          permissions: [...selected],
        },
      }),
    onSuccess: () => {
      toast.success(`${role.name} saved`);
      onSaved();
    },
  });
  const toggle = (key, on) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          aria-label="Filter permissions"
          placeholder="Filter, e.g. oc. or override"
          className="max-w-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="text-sm text-muted-foreground">
          {selected.size} of {permissions.length} permissions · {role.userCount} user(s)
        </span>
        <Button
          className="ml-auto"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
        >
          {save.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          Save changes
        </Button>
      </div>
      <ProblemAlert error={save.error} className="mb-3" />
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {modules.map(([mod, perms]) => {
          const all = perms.every((p) => selected.has(p.key));
          return (
            <fieldset key={mod} className="rounded-lg border p-3">
              <legend className="sr-only">{mod}</legend>
              <label className="mb-2 flex items-center gap-2 border-b pb-2 text-sm font-semibold capitalize text-brand-navy">
                <Checkbox
                  checked={all}
                  onCheckedChange={(v) => perms.forEach((p) => toggle(p.key, Boolean(v)))}
                />
                {mod.replace(/_/g, ' ')}
              </label>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {perms.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-sm" title={p.key}>
                    <Checkbox
                      checked={selected.has(p.key)}
                      onCheckedChange={(v) => toggle(p.key, Boolean(v))}
                    />
                    <span className={cn(p.sensitive && 'text-warning')}>
                      {p.action.replace(/_/g, ' ')}
                    </span>
                    {p.sensitive && (
                      <ShieldAlert className="size-3.5 text-warning" aria-label="sensitive" />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

export default function RolesPage() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: qk.roles, queryFn: () => api('/admin/roles') });
  const perms = useQuery({ queryKey: qk.permissions, queryFn: () => api('/admin/permissions') });
  const [code, setCode] = useState('MARKETING');
  const role = roles.data?.find((r) => r.code === code) ?? roles.data?.[0];

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="Roles & permissions"
        subtitle="Amber permissions bypass a check or decide for others; they always go through maker-checker."
        crumbs={[{ label: 'Admin' }, { label: 'Roles' }]}
      />
      <ProblemAlert error={roles.error ?? perms.error} className="mb-4" />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Section bodyClassName="p-2">
          <ul role="listbox" aria-label="Roles" className="space-y-0.5">
            {(roles.data ?? []).map((r) => (
              <li key={r.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={r.code === role?.code}
                  onClick={() => setCode(r.code)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                    r.code === role?.code && 'bg-brand-sky font-semibold text-brand-navy',
                  )}
                >
                  <span>
                    {r.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {r.code}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{r.permissions.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
        <Section
          title={role?.name ?? 'Role'}
          actions={
            role && !role.active ? <StatusBadge status="DISABLED">Inactive</StatusBadge> : null
          }
        >
          {role && perms.data ? (
            <Matrix
              key={`${role.code}-${role.permissions.length}`}
              role={role}
              permissions={perms.data}
              onSaved={() => qc.invalidateQueries({ queryKey: qk.roles })}
            />
          ) : (
            <Loader2
              className="mx-auto size-6 animate-spin text-muted-foreground"
              aria-label="Loading"
            />
          )}
        </Section>
      </div>
    </>
  );
}
