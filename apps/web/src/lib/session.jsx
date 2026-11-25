'use client';

// Current user/session for client components: GET /auth/me, redirect to login on 401,
// to change-password when required. `can(key)` drives what the UI shows (PERMISSIONS P-8);
// the API always enforces.
// Offline (P3-10, BR-OFF-01): the last /auth/me answer is kept on this device (user, branch,
// permissions; no token) so the plant screens open without a connection. It is used only when the
// network is down, dropped on 401 and on logout; the server checks everything again on sync.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo } from 'react';
import { api, ApiError } from './api';
import { qk } from './query-keys';

const SessionContext = createContext(null);
const ME_KEY = 'dcl.me';

function lastMe() {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function keepMe(me) {
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me));
    else localStorage.removeItem(ME_KEY);
  } catch {
    // private window / storage blocked: offline start is simply not available
  }
}
/** no connection, or the web server is up but cannot reach the API (502/503/504) */
const networkDown = (err) =>
  err instanceof ApiError
    ? [502, 503, 504].includes(err.status)
    : navigator.onLine === false ||
      err instanceof TypeError ||
      /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message ?? ''));

async function loadMe() {
  try {
    const me = await api('/auth/me');
    keepMe(me);
    return me;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) keepMe(null);
    const last = networkDown(err) ? lastMe() : null;
    if (last) return { ...last, offline: true };
    throw err;
  }
}

export function SessionProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery({ queryKey: qk.me, queryFn: loadMe, staleTime: 60_000 });

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
    keepMe(null);
    qc.clear();
    router.replace('/login');
  };
}
