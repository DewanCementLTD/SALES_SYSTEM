'use client';

// Settings per level (TASKS P0-11): company defaults (0) and branch overrides (1, 2).
// Open questions (BRD §8) are marked — their defaults stand until the business decides.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Pencil, Settings2, X } from 'lucide-react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

function ValueCell({ s, level }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(s.value ?? '');
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/settings/${level}/${s.key}`, {
        method: 'PUT',
        body: { value: v === '' ? null : v },
      }),
    onSuccess: () => {
      toast.success(`${s.key} saved`);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">
          {s.value ?? <span className="text-muted-foreground">empty</span>}
        </span>
        {!s.secret && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${s.key}`}
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
      </div>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="h-8 w-40 font-mono"
        aria-label={s.key}
        autoComplete="off"
      />
      <Button
        type="submit"
        size="icon"
        className="size-8"
        disabled={save.isPending}
        aria-label="Save"
      >
        {save.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => setEditing(false)}
        aria-label="Cancel"
      >
        <X className="size-4" />
      </Button>
      {save.error && <span className="text-xs text-danger">{save.error.message}</span>}
    </form>
  );
}

export default function SettingsPage() {
  const s = useSession();
  const [level, setLevel] = useQueryState('level', parseAsInteger.withDefault(0));
  const list = useQuery({
    queryKey: qk.settings(level),
    queryFn: () => api(`/admin/settings?level=${level}`),
  });
  const levels = [
    { v: 0, label: 'Company defaults' },
    ...s.branches.map((b) => ({ v: b.brnch, label: b.name })),
  ];

  return (
    <>
      <PageHeader
        icon={Settings2}
        title="Settings"
        subtitle="A branch value overrides the company default. Company defaults can be changed by a system administrator."
        crumbs={[{ label: 'Admin' }, { label: 'Settings' }]}
      />
      <Section>
        <Tabs value={String(level)} onValueChange={(v) => setLevel(Number(v))} className="mb-4">
          <TabsList>
            {levels.map((l) => (
              <TabsTrigger key={l.v} value={String(l.v)}>
                {l.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ProblemAlert error={list.error} className="mb-3" />
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="bg-secondary/70">
              <TableRow>
                <TableHead className="font-semibold text-brand-navy">Setting</TableHead>
                <TableHead className="font-semibold text-brand-navy">Value</TableHead>
                <TableHead className="font-semibold text-brand-navy">Source</TableHead>
                <TableHead className="font-semibold text-brand-navy">Rule</TableHead>
                <TableHead className="font-semibold text-brand-navy">Changed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin" aria-label="Loading" />
                  </TableCell>
                </TableRow>
              )}
              {(list.data ?? []).map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="max-w-md">
                    <div className="font-mono text-sm font-medium">{row.key}</div>
                    <div className="text-xs text-muted-foreground">{row.description}</div>
                  </TableCell>
                  <TableCell>
                    <ValueCell key={`${level}-${row.key}-${row.value}`} s={row} level={level} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={
                        row.source === 'branch'
                          ? 'info'
                          : row.source === 'company'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {row.source}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {row.rule}
                    {row.openQuestion && (
                      <StatusBadge tone="warning" className="ml-2">
                        Open {row.openQuestion}
                      </StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {row.updatedBy ? `${row.updatedBy}, ${fmtDateTime(row.updatedOn)}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </>
  );
}
