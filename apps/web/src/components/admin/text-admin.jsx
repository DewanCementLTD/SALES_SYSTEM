'use client';

// Admin texts (TASKS P0-16 remainder, P2-09): message templates and print texts. A row is edited
// in a dialog; scope 0 = company (all branches), 1 = Karachi, 2 = Hattar. Never deleted: switch off.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

const SCOPES = { 0: 'Company', 1: 'Karachi', 2: 'Hattar' };

/**
 * @param {{ kind: 'templates'|'print-texts', title: string, subtitle: string, icon: any,
 *   hint: string }} p
 */
export function TextAdmin({ kind, title, subtitle, icon, hint }) {
  const qc = useQueryClient();
  const isTpl = kind === 'templates';
  const q = useQuery({ queryKey: ['admin', kind], queryFn: () => api(`/admin/${kind}`) });
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const blank = isTpl
    ? { templateCode: '', channel: 'SMS', scope: 0, subject: '', body: '', active: true }
    : { textCode: '', srNo: 1, scope: 0, body: '', active: true };
  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        ...edit,
        scope: Number(edit.scope),
        ...(isTpl ? {} : { srNo: Number(edit.srNo) }),
      };
      if (isTpl && !body.subject) delete body.subject;
      await api(`/admin/${kind}`, { method: 'PUT', body });
      toast.success('Saved');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['admin', kind] });
    } catch (err) {
      setError(err);
    }
  };
  const columns = [
    {
      id: 'code',
      header: isTpl ? 'Event' : 'Text',
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {isTpl ? row.original.templateCode : row.original.textCode}
        </span>
      ),
    },
    isTpl
      ? { id: 'ch', header: 'Channel', cell: ({ row }) => row.original.channel }
      : { id: 'sr', header: '#', cell: ({ row }) => row.original.srNo },
    {
      id: 'sc',
      header: 'Scope',
      cell: ({ row }) => SCOPES[row.original.scope] ?? row.original.scope,
    },
    {
      id: 'b',
      header: 'Text',
      cell: ({ row }) => <span className="line-clamp-2 max-w-xl text-sm">{row.original.body}</span>,
    },
    {
      id: 'a',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge tone={row.original.active ? 'success' : 'neutral'}>
          {row.original.active ? 'active' : 'off'}
        </StatusBadge>
      ),
    },
    {
      id: 'e',
      header: '',
      cell: ({ row }) => (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Edit"
          onClick={() => setEdit({ ...blank, ...row.original })}
        >
          <Pencil className="size-4" />
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        crumbs={[{ label: 'Admin' }, { label: title }]}
        actions={
          <Button onClick={() => setEdit(blank)}>
            <Plus className="size-4" /> New
          </Button>
        }
      />
      <Section>
        <p className="mb-3 text-sm text-muted-foreground">{hint}</p>
        <ProblemAlert error={q.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isLoading}
          rowKey={(r) =>
            isTpl
              ? `${r.templateCode}|${r.channel}|${r.scope}`
              : `${r.textCode}|${r.scope}|${r.srNo}`
          }
          empty="Nothing set up yet."
        />
      </Section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-2xl">
          {edit && (
            <form onSubmit={save} className="space-y-3">
              <DialogHeader>
                <DialogTitle>{isTpl ? 'Message template' : 'Print text'}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="t-code">{isTpl ? 'Event code' : 'Text code'}</Label>
                  <Input
                    id="t-code"
                    value={isTpl ? edit.templateCode : edit.textCode}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        [isTpl ? 'templateCode' : 'textCode']: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </div>
                {isTpl ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="t-ch">Channel (SMS, WA, EMAIL)</Label>
                    <Input
                      id="t-ch"
                      value={edit.channel}
                      onChange={(e) => setEdit({ ...edit, channel: e.target.value.toUpperCase() })}
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="t-sr">Paragraph #</Label>
                    <Input
                      id="t-sr"
                      inputMode="numeric"
                      value={edit.srNo}
                      onChange={(e) => setEdit({ ...edit, srNo: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="t-scope">Scope (0 company, 1, 2)</Label>
                  <Input
                    id="t-scope"
                    inputMode="numeric"
                    value={edit.scope}
                    onChange={(e) => setEdit({ ...edit, scope: e.target.value })}
                  />
                </div>
              </div>
              {isTpl && (
                <div className="space-y-1.5">
                  <Label htmlFor="t-sub">E-mail subject</Label>
                  <Input
                    id="t-sub"
                    value={edit.subject ?? ''}
                    onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="t-body">Text</Label>
                <Textarea
                  id="t-body"
                  rows={6}
                  value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={edit.active}
                  onCheckedChange={(v) => setEdit({ ...edit, active: !!v })}
                />{' '}
                Active
              </label>
              <ProblemAlert error={error} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                  Close
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
