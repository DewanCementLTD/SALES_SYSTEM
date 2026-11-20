'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CommandMenu } from './command-menu';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { SessionProvider, useSessionState } from '@/lib/session';
import { qk } from '@/lib/query-keys';

/** Live updates (ADR-9): SSE invalidates the bell and the approvals inbox. Polling stays as fallback. */
function useLiveEvents(enabled) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;
    const es = new EventSource('/api/v1/events?channels=notifications,approvals');
    es.addEventListener('notifications', () =>
      qc.invalidateQueries({ queryKey: qk.notifications }),
    );
    es.addEventListener('approvals', () => qc.invalidateQueries({ queryKey: ['approvals'] }));
    return () => es.close();
  }, [enabled, qc]);
}

function ShellInner({ children }) {
  const { session, loading } = useSessionState();
  const [searchOpen, setSearchOpen] = useState(false);
  useLiveEvents(Boolean(session));

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-live="polite">
        <Loader2 className="size-8 animate-spin text-brand-teal" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSearch={() => setSearchOpen(true)} />
        <main id="main" className="flex-1 px-4 py-5 lg:px-8 lg:py-6">
          {children}
        </main>
      </div>
      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export function AppShell({ children }) {
  return (
    <SessionProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <ShellInner>{children}</ShellInner>
    </SessionProvider>
  );
}
