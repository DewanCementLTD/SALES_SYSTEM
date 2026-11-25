// Service worker (TASKS P3-10, ARCHITECTURE §2: Serwist; BR-OFF-01). Built into public/sw.js by
// `next build` (not in `next dev`). It keeps the app shell and the plant screens loading when the
// plant network is down; the work done offline goes to the Dexie outbox (src/lib/offline.js).
//
// What is cached, and what never is:
// - build files (/_next/static, precached) and icons/fonts: cache first;
// - pages: network first, the last copy when offline (pages hold no business data: they load it
//   from the API);
// - /api/*: NEVER cached here (customer data, PDFs, tokens). Offline documents live in IndexedDB.
import { CacheFirst, ExpirationPlugin, NetworkFirst, NetworkOnly, Serwist } from 'serwist';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    { matcher: ({ url }) => url.pathname.startsWith('/api/'), handler: new NetworkOnly() },
    {
      matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'pages',
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 })],
      }),
    },
    {
      // React Server Component payloads of client-side navigation between pages
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin && request.headers.get('RSC') === '1' && !url.pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: 'pages-rsc',
        networkTimeoutSeconds: 4,
        plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 })],
      }),
    },
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && ['image', 'font', 'style', 'script'].includes(request.destination),
      handler: new CacheFirst({
        cacheName: 'assets',
        plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 3600 })],
      }),
    },
  ],
});

serwist.addEventListeners();
