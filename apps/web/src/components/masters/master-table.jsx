'use client';

// List of one simple master (TASKS P1-01): search, active filter, branch scope, paging,
// create / edit / deactivate / activate. Columns come from the shared registry.
import { masterKeyOf } from '@dcl/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MasterFormDialog } from './master-form-dialog';
import { DataTable } from '@/components/common/data-table';
import { ReasonDialog } from '@/components/common/dialogs';
import { ProblemAlert, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, qs } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

function cellValue(f, v) {
  if (v === null || v === undefined || v === '')
    return <span className="text-muted-foreground">—</span>;
  if (f.kind === 'flag01') return v ? 'Yes' : 'No';
  if (f.kind === 'date') return fmtDate(v);
  if (f.kind === 'enum') return f.options.find((o) => o.value === v)?.label ?? v;
  if (f.kind === 'decimal') return <span className="tabular-nums">{v}</span>;
  return String(v);
}

/** @param {{ def: import('@dcl/shared').MasterDef }} props */
export function MasterTable({ def }) {
  const s = useSession();
  const qc = useQueryClient();
  const canCreate = !def.readOnly && s.can('masters.create');
  const canUpdate = !def.readOnly && s.can('masters.update');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(def.hasActive ? 'true' : 'any');
  const [scope, setScope] = useState('current');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [deactivating, setDeactivating] = useState(null);

  const params = {
    q: search,
    active: active === 'any' ? undefined : active,
    brnch: scope === 'all' ? 'all' : undefined,
    page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.masters(def.type, params),
    queryFn: async () => {
      const data = await api(`/masters/${def.type}${qs(params)}`);
      return { ...data, items: data.items.map((r) => ({ ...r, __key: masterKeyOf(def, r) })) };
    },
    placeholderData: (prev) => prev,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['masters', def.type] });
    qc.invalidateQueries({ queryKey: ['lookups'] });
  };

  const toggle = useMutation({
    mutationFn: ({ row, on, reason }) =>
      api(
        `/masters/${def.type}/${row.brnch}/${encodeURIComponent(row.__key)}/${on ? 'activate' : 'deactivate'}`,
        {
          method: 'POST',
          body: reason ? { reason } : {},
          headers: { 'if-match': `"${row.rowVer}"` },
        },
      ),
    onSuccess: (_r, { row, on }) => {
      toast.success(`${def.singular} ${row.__key} ${on ? 'activated' : 'deactivated'}`);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const listFields = def.fields.filter((f) => f.list);
  const columns = [
    ...(scope === 'all'
      ? [
          {
            id: 'brnch',
            header: 'Branch',
            cell: ({ row }) => (row.original.brnch === 1 ? 'Karachi' : 'Hattar'),
          },
        ]
      : []),
    ...def.key.map((k) => ({
      id: k.name,
      header: k.label,
      cell: ({ row }) => (
        <span className="font-mono font-medium">{String(row.original[k.name])}</span>
      ),
    })),
    ...listFields.map((f) => ({
      id: f.name,
      header: f.label,
      cell: ({ row }) => cellValue(f, row.original[f.name]),
      meta: { className: f.kind === 'decimal' ? 'text-right' : undefined },
    })),
    ...(def.hasActive
      ? [
          {
            id: 'active',
            header: 'Status',
            cell: ({ row }) => (
              <StatusBadge tone={row.original.active ? 'success' : 'neutral'}>
                {row.original.active ? 'Active' : 'Inactive'}
              </StatusBadge>
            ),
          },
        ]
      : []),
    ...(canUpdate
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">Actions</span>,
            meta: { className: 'w-24 text-right' },
            cell: ({ row }) => {
              const r = row.original;
              if (r.brnch !== s.branch) return null;
              return (
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(r);
                    }}
                    aria-label={`Edit ${r.__key}`}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {r.active ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeactivating(r);
                      }}
                      aria-label={`Deactivate ${r.__key}`}
                    >
                      <Ban className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle.mutate({ row: r, on: true });
                      }}
                      aria-label={`Activate ${r.__key}`}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <div>
      {def.note && <p className="mb-3 text-sm text-muted-foreground">{def.note}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q.trim());
          }}
        >
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => {
              setPage(1);
              setSearch(q.trim());
            }}
            placeholder={`Search ${def.title.toLowerCase()}`}
            aria-label={`Search ${def.title}`}
            className="w-64 pl-8"
          />
        </form>
        {def.hasActive && (
          <Select
            value={active}
            onValueChange={(v) => {
              setPage(1);
              setActive(v);
            }}
          >
            <SelectTrigger className="w-36" aria-label="Status filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
              <SelectItem value="any">All</SelectItem>
            </SelectContent>
          </Select>
        )}
        {s.branches.length > 1 && (
          <Select
            value={scope}
            onValueChange={(v) => {
              setPage(1);
              setScope(v);
            }}
          >
            <SelectTrigger className="w-44" aria-label="Branch filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">{s.currentBranch?.name ?? 'This branch'}</SelectItem>
              <SelectItem value="all">All my branches</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        {canCreate && (
          <Button
            onClick={() => setEditing('new')}
            className="bg-brand-orange hover:bg-brand-orange/90"
          >
            <Plus className="size-4" /> New {def.singular.toLowerCase()}
          </Button>
        )}
      </div>
      <ProblemAlert error={list.error} className="mb-3" />
      <DataTable
        columns={columns}
        data={list.data}
        loading={list.isLoading}
        onPageChange={setPage}
        onRowClick={(r) => setEditing(r)}
        rowKey={(r) => `${r.brnch}|${r.__key}`}
        empty={search ? `Nothing matches “${search}”.` : 'No records.'}
      />
      {editing && (
        <MasterFormDialog
          key={editing === 'new' ? 'new' : `${editing.brnch}|${editing.__key}|${editing.rowVer}`}
          def={def}
          row={editing === 'new' ? undefined : editing}
          open
          onOpenChange={(v) => !v && setEditing(null)}
          canEdit={editing === 'new' ? canCreate : canUpdate && editing.brnch === s.branch}
          brnch={editing === 'new' ? s.branch : editing.brnch}
          onSaved={(saved) => {
            toast.success(`${def.singular} ${masterKeyOf(def, saved)} saved`);
            setEditing(null);
            refresh();
          }}
        />
      )}
      <ReasonDialog
        open={!!deactivating}
        onOpenChange={(v) => !v && setDeactivating(null)}
        title={`Deactivate ${def.singular.toLowerCase()} ${deactivating?.__key ?? ''}`}
        description="It stays in history and old documents; it is no longer offered for new entries. You can activate it again."
        confirmLabel="Deactivate"
        destructive
        onConfirm={(reason) => toggle.mutateAsync({ row: deactivating, on: false, reason })}
      />
    </div>
  );
}
