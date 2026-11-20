// API client for the browser. Same-origin (/api/v1 is rewritten to the API by Next), cookies
// carry the session; state-changing requests send the CSRF double-submit header (API_SPEC §1).
// A 401 triggers ONE shared refresh (single flight: parallel refreshes would trip the
// refresh-token reuse detection and end the session), then the request is retried once.

export class ApiError extends Error {
  /** @param {{ code?: string, detail?: string, title?: string, errors?: {path: string, message: string}[], ruleId?: string, data?: any, requestId?: string }} problem */
  constructor(problem, status) {
    super(problem?.detail || problem?.title || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.code ?? 'error';
    this.errors = problem?.errors ?? [];
    this.ruleId = problem?.ruleId;
    this.data = problem?.data;
    this.requestId = problem?.requestId;
  }
}

function readCookie(name) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

let refreshing = null;
export function refreshSession() {
  refreshing ??= fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * @param {string} path e.g. '/auth/me'
 * @param {{ method?: string, body?: unknown, headers?: Record<string,string>, signal?: AbortSignal, retry?: boolean }} [opts]
 * @returns {Promise<any>}
 */
export async function api(path, { method = 'GET', body, headers = {}, signal, retry = true } = {}) {
  const form = typeof FormData !== 'undefined' && body instanceof FormData; // file uploads go as-is
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    signal,
    headers: {
      accept: 'application/json',
      ...(body !== undefined && !form ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'x-csrf-token': readCookie('csrf') } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });

  if (
    res.status === 401 &&
    retry &&
    !path.startsWith('/auth/login') &&
    !path.startsWith('/auth/refresh')
  ) {
    if (await refreshSession()) return api(path, { method, body, headers, signal, retry: false });
  }
  if (!res.ok) {
    const problem = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(problem, res.status);
  }
  if (res.status === 204) return null;
  const etag = res.headers.get('etag');
  const data = await res.json();
  if (etag && data && typeof data === 'object' && !Array.isArray(data)) {
    Object.defineProperty(data, '__etag', { value: etag, enumerable: false });
  }
  return data;
}

/** Build a query string from defined values. */
export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
