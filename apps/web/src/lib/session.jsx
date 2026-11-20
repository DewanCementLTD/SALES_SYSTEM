'use client';

// Current user/session for client components: GET /auth/me, redirect to login on 401,
// to change-password when required. `can(key)` drives what the UI shows (PERMISSIONS P-8);
// the API always enforces.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { api, ApiError } from './api';
import { qk } from './query-keys';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery({ queryKey: qk.me, queryFn: () => api('/auth/me'), staleTime: 60_000 });

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
    if (me.data?.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [me.error, me.data, pathname, router]);

  const value = useMemo(() => {
    if (!me.data) return null;
    const perms = new Set(me.data.permissions);
    const branch = me.data.branches.find((b) => b.brnch === me.data.branch);
    return {
      ...me.data,
      permissionSet: perms,
      currentBranch: branch,
      roles: branch?.roles ?? [],
      can: (key) => (Array.isArray(key) ? key.some((k) => perms.has(k)) : perms.has(key)),
    };
  }, [me.data]);

  return (
    <SessionContext.Provider value={{ session: value, loading: me.isLoading, error: me.error }}>
      {children}
    </SessionContext.Provider>
  );
}

/** @returns {{ session: any, loading: boolean, error: any }} */
export function useSessionState() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionState outside SessionProvider');
  return ctx;
}

/** The signed-in session (only inside the app shell, where it is loaded). */
export function useSession() {
  return useSessionState().session;
}

/** Sign out and forget every cached query. */
export function useLogout() {
  const router = useRouter();
  const qc = useQueryClient();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    qc.clear();
    router.replace('/login');
  };
}
