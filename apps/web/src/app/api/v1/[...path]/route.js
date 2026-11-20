// Same-origin proxy /api/v1/* → API_URL (read at runtime, not baked into the build).
// Keeps session cookies first-party in development and simple deployments. In production the
// reverse proxy (Apache/Nginx) should route /api/v1 straight to the API so client IPs reach the
// API's rate limits; this handler then only serves as a fallback.
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = [
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
];

async function proxy(request, { params }) {
  const { path } = await params;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const url = new URL(request.url);
  const target = `${base}/api/v1/${path.map(encodeURIComponent).join('/')}${url.search}`;

  const headers = new Headers(request.headers);
  for (const h of HOP_BY_HOP) headers.delete(h);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const res = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  res.headers.forEach((value, key) => {
    if (key === 'set-cookie' || key === 'content-encoding' || key === 'content-length') return;
    out.set(key, value);
  });
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
