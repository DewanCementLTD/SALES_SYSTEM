'use client';

// Plant › Offline sync (PRD 4.9, TASKS P3-10, BR-OFF-04): offline events the server could not apply
// (vehicle already inside, DO cancelled meanwhile …). The dispatch supervisor retries one after
// fixing the data, or discards it — always with a reason. Below: what waits on this tablet.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, RotateCcw, Trash2, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { OfflineBanner } from '@/components/plant/offline-banner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { dropEvent, outboxItems, pushOutbox } from '@/lib/offline';
import { useSession } from '@/lib/session';

const TONE = { OPEN: 'danger', RESOLVED: 'success', DISCARDED: 'neutral' };
const what = (c) =>
  c.eventType === 'GATE_IN'
    ? `Gate-in ${c.payload?.vehicleNo ?? ''} · DO ${(c.payload?.docs ?? []).map((d) => d.doNo).join(', ')}`
    : `${c.eventType.toLowerCase()} ${c.payload?.weightKg ? `${c.payload.weightKg} kg` : ''}`;

export default function OfflineSyncPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [act, setAct] = useState(null); // { conflict, action }
  const conflicts = useQuery({
    queryKey: ['plant', 'sync-conflicts', status],
    queryFn: () => api(`/plant/sync-conflicts?status=${status}`),
    enabled: s.can('sync.resolve'),
  });
  const local = useQuery({
    queryKey: ['offline', 'outbox'],
    queryFn: outboxItems,
    networkMode: 'always',
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['plant', 'sync-conflicts'] });
    qc.invalidateQueries({ queryKey: ['offline', 'outbox'] });
  };
  return (
    <>
      <PageHeader
        icon={WifiOff}
        title="Offline sync"
        subtitle="Events recorded while the plant was offline that the server could not apply."
        crumbs={[{ label: 'Plant' }, { label: 'Offline sync' }]}
        actions={
          <Button
            variant="outline"
            onClick={() =>
              pushOutbox()
                .then((r) => toast.success(`${r.pushed} event(s) sent`))
                .catch((e) => toast.error(e.message))
                .finally(refresh)
            }
          >
            <RefreshCw className="size-4" /> Sync this tablet now
          </Button>
        }
      />
      <OfflineBanner />
      {s.can('sync.resolve') && (
        <Section title="Not applied on the server">
          <Tabs value={status} onValueChange={setStatus} className="mb-3">
            <TabsList>
              <TabsTrigger value="OPEN">Open</TabsTrigger>
              <TabsTrigger value="RESOLVED">Resolved</TabsTrigger>
              <TabsTrigger value="DISCARDED">Discarded</TabsTrigger>
            </TabsList>
          </Tabs>
          <ProblemAlert error={conflicts.error} className="mb-3" />
          <ul className="space-y-2">
            {(conflicts.data?.items ?? []).map((c) => (
              <li key={c.conflictId} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    #{c.conflictId} · {what(c)}{' '}
                    <StatusBadge tone={TONE[c.status]}>{c.status.toLowerCase()}</StatusBadge>
                  </div>
                  <div className="text-muted-foreground">
                    {c.deviceTime ? `on the tablet ${fmtDateTime(c.deviceTime)}` : ''}
                    {c.deviceId ? ` · ${c.deviceId}` : ''}
                  </div>
                </div>
                <div className="mt-1 text-danger">
                  {c.errorCode}: {c.errorMsg}
                </div>
                {c.resolution && (
                  <div className="mt-1 text-muted-foreground">
                    {c.resolvedBy}: {c.resolution}
                  </div>
                )}
                {c.status === 'OPEN' && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => setAct({ conflict: c, action: 'RETRY' })}>
                      <RotateCcw className="size-4" /> Apply again
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() => setAct({ conflict: c, action: 'DISCARD' })}
                    >
                      <Trash2 className="size-4" /> Discard
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {!conflicts.isLoading && !conflicts.data?.items?.length && (
              <li className="py-4 text-center text-sm text-muted-foreground">Nothing here.</li>
            )}
          </ul>
        </Section>
      )}
      <Section title="Waiting on this tablet" className="mt-4">
        <ul className="space-y-1 text-sm">
          {(local.data ?? []).map((e) => (
            <li key={e.seq} className="flex items-center justify-between gap-2 border-b py-1.5">
              <span>
                {e.type} · {fmtDateTime(e.deviceTime)}{' '}
                <StatusBadge tone={e.status === 'CONFLICT' ? 'danger' : 'warning'}>
                  {e.status.toLowerCase()}
                </StatusBadge>
                {e.error ? <span className="ml-2 text-danger">{e.error}</span> : null}
              </span>
              {e.status === 'CONFLICT' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dropEvent(e.seq).then(refresh)}
                  aria-label="Remove from this tablet"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
          {!local.data?.length && (
            <li className="py-4 text-center text-muted-foreground">Nothing waiting.</li>
          )}
        </ul>
      </Section>
      <ReasonDialog
        open={!!act}
        onOpenChange={(o) => !o && setAct(null)}
        title={act?.action === 'RETRY' ? 'Apply the event again' : 'Discard the event'}
        description={
          act?.action === 'RETRY'
            ? 'It is applied again with you as the user. Fix what blocked it first.'
            : 'The event is closed without being applied.'
        }
        confirmLabel={act?.action === 'RETRY' ? 'Apply again' : 'Discard'}
        destructive={act?.action === 'DISCARD'}
        onConfirm={async (resolution) => {
          await api(`/plant/sync-conflicts/${act.conflict.conflictId}/resolve`, {
            method: 'POST',
            body: { action: act.action, resolution },
          });
          toast.success(act.action === 'RETRY' ? 'Applied' : 'Discarded');
          refresh();
        }}
      />
    </>
  );
}
