'use client';

// Admin › Devices (PRD 4.16, TASKS P3-01): weighbridge agents and gate tablets of the branch.
// Register (the secret is shown once), rename / switch off / change the configuration, new secret.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Router } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { OneTimeSecretDialog } from '@/components/common/dialogs';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

const TYPES = { WEIGHBRIDGE: 'Weighbridge agent', GATE: 'Gate tablet' };

export default function DevicesPage() {
  const s = useSession();
  const qc = useQueryClient();
  const key = ['admin', 'devices'];
  const q = useQuery({ queryKey: key, queryFn: () => api('/admin/devices') });
  const [edit, setEdit] = useState(null); // { mode: 'new'|'edit', ...fields }
  const [secret, setSecret] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    let config;
    try {
      config = edit.configText.trim() ? JSON.parse(edit.configText) : {};
      if (typeof config !== 'object' || Array.isArray(config)) throw new Error();
    } catch {
      setError({ message: 'Configuration must be a JSON object, e.g. {"port": "COM3"}' });
      return;
    }
    setBusy(true);
    try {
      if (edit.mode === 'new') {
        const r = await api('/admin/devices', {
          method: 'POST',
          body: {
            deviceId: edit.deviceId.trim().toUpperCase(),
            brnch: s.branch,
            deviceType: edit.deviceType,
            deviceName: edit.deviceName,
            config,
          },
        });
        setSecret({ title: `Secret of ${r.device.deviceId}`, secret: r.secret, note: r.note });
      } else {
        await api(`/admin/devices/${edit.deviceId}`, {
          method: 'PUT',
          body: { deviceName: edit.deviceName, active: edit.active, config },
        });
        toast.success('Device saved');
      }
      setEdit(null);
      qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const rotate = async (d) => {
    try {
      const r = await api(`/admin/devices/${d.deviceId}/rotate-secret`, {
        method: 'POST',
        body: {},
      });
      setSecret({ title: `New secret of ${d.deviceId}`, secret: r.secret, note: r.note });
    } catch (err) {
      setError(err);
    }
  };

  const columns = [
    {
      id: 'id',
      header: 'Device id',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.deviceId}</span>,
    },
    { id: 't', header: 'Type', cell: ({ row }) => TYPES[row.original.deviceType] },
    { id: 'n', header: 'Name', cell: ({ row }) => row.original.deviceName },
    { id: 'b', header: 'Branch', cell: ({ row }) => `.${row.original.brnch}` },
    {
      id: 'seen',
      header: 'Last signed in',
      cell: ({ row }) => (row.original.lastSeenOn ? fmtDateTime(row.original.lastSeenOn) : 'never'),
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
      id: 'x',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit ${row.original.deviceId}`}
            onClick={() =>
              setEdit({
                mode: 'edit',
                ...row.original,
                configText: JSON.stringify(row.original.config ?? {}, null, 2),
              })
            }
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`New secret for ${row.original.deviceId}`}
            onClick={() => rotate(row.original)}
          >
            <KeyRound className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        icon={Router}
        title="Devices"
        subtitle="Weighbridge agents and gate tablets. A device signs in with its id and secret and can only call the plant endpoints of its branch."
        crumbs={[{ label: 'Admin' }, { label: 'Devices' }]}
        actions={
          <Button
            onClick={() =>
              setEdit({
                mode: 'new',
                deviceId: '',
                deviceType: 'WEIGHBRIDGE',
                deviceName: '',
                active: true,
                configText: '{\n  "port": "COM3",\n  "baud": 9600\n}',
              })
            }
          >
            <Plus className="size-4" /> Register device
          </Button>
        }
      />
      <Section>
        <ProblemAlert error={q.error ?? (edit ? null : error)} className="mb-3" />
        <DataTable
          columns={columns}
          data={q.data?.items ?? []}
          loading={q.isLoading}
          rowKey={(r) => r.deviceId}
          empty="No devices registered for this branch."
        />
      </Section>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-xl">
          {edit && (
            <form onSubmit={save} className="space-y-3">
              <DialogHeader>
                <DialogTitle>
                  {edit.mode === 'new' ? 'Register device' : `Device ${edit.deviceId}`}
                </DialogTitle>
                {edit.mode === 'new' && (
                  <DialogDescription>
                    For branch {s.currentBranch?.name ?? `.${s.branch}`}. The secret is shown once
                    after saving.
                  </DialogDescription>
                )}
              </DialogHeader>
              {edit.mode === 'new' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="dv-id">Device id</Label>
                    <Input
                      id="dv-id"
                      placeholder="KHI-WB-01"
                      value={edit.deviceId}
                      onChange={(e) => setEdit({ ...edit, deviceId: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dv-type">Type</Label>
                    <Select
                      value={edit.deviceType}
                      onValueChange={(v) => setEdit({ ...edit, deviceType: v })}
                    >
                      <SelectTrigger id="dv-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TYPES).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="dv-name">Name</Label>
                <Input
                  id="dv-name"
                  value={edit.deviceName}
                  onChange={(e) => setEdit({ ...edit, deviceName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dv-cfg">Configuration (JSON: port, baud, parser profile …)</Label>
                <Textarea
                  id="dv-cfg"
                  rows={6}
                  className="font-mono text-xs"
                  value={edit.configText}
                  onChange={(e) => setEdit({ ...edit, configText: e.target.value })}
                />
              </div>
              {edit.mode === 'edit' && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={edit.active}
                    onCheckedChange={(v) => setEdit({ ...edit, active: !!v })}
                  />{' '}
                  Active (switched off, the device cannot sign in and its token stops working)
                </label>
              )}
              <ProblemAlert error={error} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                  Close
                </Button>
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <OneTimeSecretDialog
        open={!!secret}
        onOpenChange={(o) => !o && setSecret(null)}
        title={secret?.title}
        secret={secret?.secret ?? ''}
        note={secret?.note}
      />
    </>
  );
}
