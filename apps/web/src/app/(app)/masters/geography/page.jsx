'use client';

// Geography (TASKS P1-02, SCHEMA §2.3): Zone → Territory → Area → City per branch, browsed as four
// columns; legacy code review (LEGACY_MAP). Codes are fixed; names can change; nodes are
// deactivated (with everything below), never deleted.
import { GEO_LEVELS, zGeoCreate, zGeoRename } from '@dcl/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  ChevronRight,
  Loader2,
  MapPinned,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const levelName = (lv) => GEO_LEVELS[lv - 1].name;

function NodeDialog({ mode, parent, node, onClose, onSaved }) {
  const create = mode === 'create';
  const form = useForm({
    resolver: zodResolver(create ? zGeoCreate : zGeoRename),
    defaultValues: create
      ? { parentCode: parent?.geoCode ?? '', code: '', name: '' }
      : { name: node.name },
  });
  const [error, setError] = useState(null);
  const level = create ? (parent ? parent.level + 1 : 1) : node.level;
  const err = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const saved = create
        ? await api('/geo/nodes', { method: 'POST', body: v })
        : await api(`/geo/nodes/${node.brnch}/${node.geoCode}`, {
            method: 'PUT',
            body: v,
            headers: { 'if-match': `"${node.rowVer}"` },
          });
      onSaved(saved);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {create ? `New ${levelName(level).toLowerCase()}` : `Rename ${node.geoCode}`}
          </DialogTitle>
          <DialogDescription>
            {create
              ? parent
                ? `Under ${parent.path.join(' › ')}. The code is part of customer codes (BR-CUS-03) and cannot change later.`
                : 'A new zone. The code is part of customer codes (BR-CUS-03) and cannot change later.'
              : `The new name is shown on every ${levelName(level).toLowerCase()} level record below it.`}
          </DialogDescription>
        </DialogHeader>
        <form id="geo-form" onSubmit={submit} noValidate className="space-y-4">
          {create && (
            <div className="space-y-1.5">
              <Label htmlFor="geo-code">Code</Label>
              <Input
                id="geo-code"
                className="uppercase"
                autoComplete="off"
                maxLength={10}
                {...form.register('code')}
                aria-invalid={!!err.code}
              />
              {err.code && <p className="text-xs text-danger">{err.code.message}</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="geo-name">Name</Label>
            <Input
              id="geo-name"
              autoComplete="off"
              maxLength={100}
              {...form.register('name')}
              aria-invalid={!!err.name}
            />
            {err.name && <p className="text-xs text-danger">{err.name.message}</p>}
          </div>
        </form>
        <ProblemAlert error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="geo-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {create ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LevelColumn({ level, parent, selected, onSelect, onAdd, canCreate, showInactive }) {
  const enabled = level === 1 || !!parent;
  const params = {
    ...(level === 1 ? { level: 1 } : { parentCode: parent?.geoCode }),
    active: showInactive ? undefined : 'true',
    pageSize: 200,
  };
  const list = useQuery({
    queryKey: qk.geoNodes(params),
    queryFn: () => api(`/geo/nodes${qs(params)}`),
    enabled,
  });
  const [filter, setFilter] = useState('');
  const items = (list.data?.items ?? []).filter(
    (n) => !filter || `${n.code} ${n.name}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const lv = GEO_LEVELS[level - 1];
  return (
    <div className="flex min-h-0 flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-sm font-semibold text-brand-navy">
          {lv.plural}
          {list.data && (
            <span className="ml-1.5 font-normal text-muted-foreground">({list.data.total})</span>
          )}
        </div>
        {canCreate && enabled && (parent?.active ?? true) && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onAdd}
            aria-label={`New ${lv.name.toLowerCase()}`}
          >
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      {enabled && (list.data?.total ?? 0) > 8 && (
        <div className="border-b p-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${lv.plural.toLowerCase()}`}
            aria-label={`Filter ${lv.plural}`}
            className="h-8"
          />
        </div>
      )}
      <ul className="max-h-[440px] flex-1 overflow-y-auto p-1" aria-label={lv.plural}>
        {!enabled && (
          <li className="p-3 text-sm text-muted-foreground">
            Select a {GEO_LEVELS[level - 2].name.toLowerCase()}.
          </li>
        )}
        {enabled && list.isLoading && (
          <li className="p-3 text-center">
            <Loader2 className="mx-auto size-4 animate-spin" aria-label="Loading" />
          </li>
        )}
        {enabled && !list.isLoading && items.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">None.</li>
        )}
        {items.map((n) => (
          <li key={n.geoCode}>
            <button
              type="button"
              onClick={() => onSelect(n)}
              aria-current={selected?.geoCode === n.geoCode ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary',
                selected?.geoCode === n.geoCode && 'bg-brand-sky font-medium text-brand-navy',
                !n.active && 'text-muted-foreground line-through',
              )}
            >
              <span className="w-12 shrink-0 font-mono text-xs">{n.code}</span>
              <span className="flex-1 truncate">{n.name}</span>
              {level < 4 && n.childCount > 0 && (
                <span className="flex items-center text-xs text-muted-foreground">
                  {n.childCount}
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodeDetail({ node, canUpdate, onRename, onToggle }) {
  return (
    <div className="mt-4 rounded-lg border bg-secondary/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {levelName(node.level)}
          </div>
          <div className="text-lg font-semibold text-brand-navy">{node.path.join(' › ')}</div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>
              Code <span className="font-mono text-foreground">{node.geoCode}</span>
            </span>
            <span>
              Source {node.sourceTable}
              {node.legacyCode ? ` (legacy ${node.legacyCode})` : ''}
            </span>
            <span>Customers {node.customerCount.toLocaleString('en-PK')}</span>
            <StatusBadge tone={node.active ? 'success' : 'neutral'}>
              {node.active ? 'Active' : 'Inactive'}
            </StatusBadge>
          </div>
        </div>
        {canUpdate && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onRename}>
              <Pencil className="size-4" /> Rename
            </Button>
            {node.active ? (
              <Button
                variant="outline"
                size="sm"
                className="text-danger"
                onClick={() => onToggle(false)}
              >
                <Ban className="size-4" /> Deactivate
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => onToggle(true)}>
                <RotateCcw className="size-4" /> Activate
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Hierarchy() {
  const s = useSession();
  const qc = useQueryClient();
  const [path, setPath] = useState([]); // selected node per level
  const [dialog, setDialog] = useState(null); // { mode, parent?, node? }
  const [deactivating, setDeactivating] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const canCreate = s.can('masters.create');
  const canUpdate = s.can('masters.update');
  const selected = path.at(-1);

  const refresh = (node) => {
    qc.invalidateQueries({ queryKey: ['geo'] });
    if (node) setPath((p) => p.map((x) => (x.geoCode === node.geoCode ? node : x)));
  };
  const activate = useMutation({
    mutationFn: ({ node, reason, on }) =>
      api(`/geo/nodes/${node.brnch}/${node.geoCode}/${on ? 'activate' : 'deactivate'}`, {
        method: 'POST',
        body: reason ? { reason } : {},
        headers: { 'if-match': `"${node.rowVer}"` },
      }),
    onSuccess: (n) => {
      toast.success(
        n.active
          ? `${n.geoCode} activated`
          : `${n.geoCode} deactivated${n.descendantsChanged ? ` with ${n.descendantsChanged} below it` : ''}`,
      );
      refresh(n);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show inactive
      </label>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((level) => (
          <LevelColumn
            key={level}
            level={level}
            parent={level === 1 ? null : path[level - 2]}
            selected={path[level - 1]}
            showInactive={showInactive}
            canCreate={canCreate}
            onSelect={(n) => setPath((p) => [...p.slice(0, level - 1), n])}
            onAdd={() =>
              setDialog({ mode: 'create', parent: level === 1 ? null : path[level - 2] })
            }
          />
        ))}
      </div>
      {selected && (
        <NodeDetail
          node={selected}
          canUpdate={canUpdate}
          onRename={() => setDialog({ mode: 'rename', node: selected })}
          onToggle={(on) =>
            on ? activate.mutate({ node: selected, on: true }) : setDeactivating(selected)
          }
        />
      )}
      {dialog && (
        <NodeDialog
          {...dialog}
          onClose={() => setDialog(null)}
          onSaved={(n) => {
            toast.success(`${n.geoCode} saved`);
            setDialog(null);
            refresh(n);
          }}
        />
      )}
      <ReasonDialog
        open={!!deactivating}
        onOpenChange={(v) => !v && setDeactivating(null)}
        title={`Deactivate ${deactivating?.geoCode ?? ''}`}
        description="Everything below it is deactivated too. Existing customers and documents keep their geography."
        confirmLabel="Deactivate"
        destructive
        onConfirm={(reason) => activate.mutateAsync({ node: deactivating, reason, on: false })}
      />
    </>
  );
}

function LegacyCodes({ entities }) {
  const [entity, setEntity] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = { entity: entity === 'all' ? undefined : entity, q: search, page, pageSize: 50 };
  const list = useQuery({
    queryKey: qk.geoLegacy(params),
    queryFn: () => api(`/geo/legacy-map${qs(params)}`),
    placeholderData: (p) => p,
  });
  const columns = [
    {
      id: 'entity',
      header: 'Legacy table',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.entity}</span>,
    },
    {
      id: 'legacyCode',
      header: 'Legacy code',
      cell: ({ row }) => <span className="font-mono">{row.original.legacyCode}</span>,
    },
    {
      id: 'newCode',
      header: 'New code',
      cell: ({ row }) => <span className="font-mono">{row.original.newCode}</span>,
    },
    {
      id: 'path',
      header: 'Geography',
      cell: ({ row }) =>
        row.original.found ? (
          row.original.path.join(' › ')
        ) : (
          <StatusBadge tone="danger">Node missing</StatusBadge>
        ),
    },
    { id: 'source', header: 'From', cell: ({ row }) => row.original.sourceDb },
  ];
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Every legacy geography code and the node it was mapped to by the load script (db/02d).
        Legacy tables are unchanged and keep serving old reports.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          value={entity}
          onValueChange={(v) => {
            setPage(1);
            setEntity(v);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Legacy table">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All legacy tables</SelectItem>
            {entities.map((e) => (
              <SelectItem key={e.entity} value={e.entity}>
                {e.entity} ({e.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            placeholder="Legacy code, new code or name"
            aria-label="Search legacy codes"
            className="w-72 pl-8"
          />
        </form>
      </div>
      <ProblemAlert error={list.error} className="mb-3" />
      <DataTable
        columns={columns}
        data={list.data}
        loading={list.isLoading}
        onPageChange={setPage}
        rowKey={(r) => `${r.brnch}|${r.entity}|${r.legacyCode}`}
      />
    </div>
  );
}

export default function GeographyPage() {
  const s = useSession();
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault('tree'));
  const summary = useQuery({
    queryKey: qk.geoSummary(s.branch),
    queryFn: () => api('/geo/summary'),
  });
  const sm = summary.data;
  return (
    <>
      <PageHeader
        icon={MapPinned}
        title="Geography"
        subtitle={`Zone → Territory → Area → City for ${s.currentBranch?.name ?? 'this branch'}. Codes are fixed; nodes are deactivated, never deleted.`}
        crumbs={[{ label: 'Masters' }, { label: 'Geography' }]}
      />
      {sm && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {sm.levels.map((l) => (
            <div key={l.level} className="rounded-lg border bg-card p-3">
              <div className="text-xs text-muted-foreground">{GEO_LEVELS[l.level - 1].plural}</div>
              <div className="text-xl font-semibold text-brand-navy">
                {l.active.toLocaleString('en-PK')}
              </div>
              {l.total !== l.active && (
                <div className="text-xs text-muted-foreground">{l.total - l.active} inactive</div>
              )}
            </div>
          ))}
          <div
            className={cn(
              'rounded-lg border bg-card p-3',
              sm.customers.unplaced > 0 && 'border-warning/60',
            )}
          >
            <div className="text-xs text-muted-foreground">Customers without geography</div>
            <div className="text-xl font-semibold text-brand-navy">
              {sm.customers.unplaced.toLocaleString('en-PK')}
            </div>
            <div className="text-xs text-muted-foreground">
              of {sm.customers.total.toLocaleString('en-PK')}
            </div>
          </div>
        </div>
      )}
      <Section>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="tree">Hierarchy</TabsTrigger>
            <TabsTrigger value="legacy">Legacy codes</TabsTrigger>
          </TabsList>
          <TabsContent value="tree">{tab === 'tree' && <Hierarchy />}</TabsContent>
          <TabsContent value="legacy">
            {tab === 'legacy' && <LegacyCodes entities={sm?.legacyEntities ?? []} />}
          </TabsContent>
        </Tabs>
      </Section>
    </>
  );
}
