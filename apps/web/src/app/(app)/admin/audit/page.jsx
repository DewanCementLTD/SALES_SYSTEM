'use client';

// Audit log viewer (TASKS P0-10, BR-AUD-01): filters, list, old/new values side by side.
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const FILTERS = {
  entity: parseAsString,
  key: parseAsString,
  user: parseAsString,
  action: parseAsString,
  from: parseAsString,
  to: parseAsString,
  page: parseAsInteger.withDefault(1),
};

const ACTION_TONE = {
  LOGIN_FAILED: 'danger',
  LOCK: 'danger',
  TOKEN_REUSE: 'danger',
  CANCEL: 'warning',
  OVERRIDE: 'warning',
  APPROVE: 'success',
  CREATE: 'info',
};

const columns = [
  {
    accessorKey: 'eventOn',
    header: 'When',
    cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDateTime(getValue())}</span>,
  },
  { accessorKey: 'usrid', header: 'User', cell: ({ getValue }) => getValue() ?? '—' },
  { accessorKey: 'brnch', header: 'Br.', cell: ({ getValue }) => getValue() ?? '—' },
  {
    accessorKey: 'action',
    header: 'Action',
    cell: ({ getValue }) => (
      <StatusBadge tone={ACTION_TONE[getValue()] ?? 'neutral'}>{getValue()}</StatusBadge>
    ),
  },
  { accessorKey: 'entity', header: 'Entity' },
  {
    accessorKey: 'entityKey',
    header: 'Key',
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
  },
  {
    accessorKey: 'reason',
    header: 'Reason',
    cell: ({ getValue }) => <span className="line-clamp-1 max-w-xs">{getValue() ?? ''}</span>,
  },
];

function Json({ value }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>;
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function AuditPage() {
  const [f, setF] = useQueryStates(FILTERS);
  const [draft, setDraft] = useState({
    entity: f.entity ?? '',
    key: f.key ?? '',
    user: f.user ?? '',
    action: f.action ?? '',
    from: f.from ?? '',
    to: f.to ?? '',
  });
  const [row, setRow] = useState(null);
  const params = { ...f, pageSize: 50 };
  const list = useQuery({ queryKey: qk.audit(params), queryFn: () => api(`/audit${qs(params)}`) });

  const apply = (e) => {
    e.preventDefault();
    setF({ ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v || null])), page: 1 });
  };

  return (
    <>
      <PageHeader
        icon={History}
        title="Audit log"
        subtitle="Every change, approval, override, print, share and sign-in."
        crumbs={[{ label: 'Admin' }, { label: 'Audit log' }]}
      />
      <Section>
        <form onSubmit={apply} className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {[
            ['entity', 'Entity', 'e.g. APP_USER'],
            ['key', 'Key', ''],
            ['user', 'User', ''],
            ['action', 'Action', 'e.g. LOGIN'],
          ].map(([k, label, ph]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`f-${k}`} className="text-xs">
                {label}
              </Label>
              <Input
                id={`f-${k}`}
                placeholder={ph}
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="f-from" className="text-xs">
              From
            </Label>
            <Input
              id="f-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-to" className="text-xs">
              To
            </Label>
            <Input
              id="f-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Filter
            </Button>
          </div>
        </form>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          onRowClick={setRow}
          rowKey={(r) => r.auditId}
          empty="No events match."
        />
      </Section>
      <Dialog open={Boolean(row)} onOpenChange={() => setRow(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {row?.action} · {row?.entity} {row?.entityKey}
            </DialogTitle>
          </DialogHeader>
          {row && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <span>{fmtDateTime(row.eventOn)}</span>
                <span>User {row.usrid ?? '—'}</span>
                <span>IP {row.ip ?? '—'}</span>
                <span className="truncate">Req {row.requestId ?? '—'}</span>
              </div>
              {row.reason && (
                <p className="rounded-md bg-warning-soft px-3 py-2 text-warning">
                  Reason: {row.reason}
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 font-medium">Old values</div>
                  <Json value={row.oldValues} />
                </div>
                <div>
                  <div className="mb-1 font-medium">New values</div>
                  <Json value={row.newValues} />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
