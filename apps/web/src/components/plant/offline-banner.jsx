'use client';

// Offline banner for the plant screens (TASKS P3-10, BR-OFF-01): shows when the connection is gone
// and how many events wait on this tablet; pushes them when the connection comes back and every 30
// seconds; keeps the offline document cache fresh.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { outboxItems, pushOutbox, refreshCache } from '@/lib/offline';
import { useSession } from '@/lib/session';

const subscribeOnline = (cb) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export function OfflineBanner() {
  const s = useSession();
  const qc = useQueryClient();
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const outbox = useQuery({
    queryKey: ['offline', 'outbox'],
    queryFn: outboxItems,
    networkMode: 'always',
  });
  const items = outbox.data ?? [];
  const pending = items.filter((e) => e.status === 'PENDING').length;
  const conflict = items.filter((e) => e.status === 'CONFLICT').length;
  const push = useCallback(() => {
    pushOutbox()
      .catch(() => {})
      .finally(() => qc.invalidateQueries({ queryKey: ['offline', 'outbox'] }));
  }, [qc]);

  useEffect(() => {
    refreshCache(s.branch).catch(() => {});
    const changed = () => qc.invalidateQueries({ queryKey: ['offline', 'outbox'] });
    const up = () => {
      push();
      refreshCache(s.branch).catch(() => {});
    };
    window.addEventListener('online', up);
    window.addEventListener('dcl-outbox', changed);
    const timer = setInterval(() => {
      if (navigator.onLine) push();
    }, 30000);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('dcl-outbox', changed);
      clearInterval(timer);
    };
  }, [s.branch, push, qc]);

  if (online && !pending && !conflict) return null;
  return (
    <div
      role="status"
      className={
        online
          ? 'mb-3 flex items-center gap-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning'
          : 'mb-3 flex items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger'
      }
    >
      <CloudOff className="size-4 shrink-0" />
      <span className="flex-1">
        {online ? 'Back online.' : 'Offline: work is saved on this tablet.'}{' '}
        {pending ? `${pending} event(s) waiting to sync.` : ''}{' '}
        {conflict ? `${conflict} event(s) were not accepted (see Plant › Offline sync).` : ''}
      </span>
      {online && pending > 0 && (
        <Button size="sm" variant="outline" onClick={push}>
          <RefreshCw className="size-4" /> Sync now
        </Button>
      )}
    </div>
  );
}
