// Next.js config. /api/v1 is forwarded to the API by src/app/api/v1/[...path]/route.js (runtime API_URL).
// Serwist (P3-10) builds src/app/sw.js into public/sw.js on `next build`; off in `next dev`.
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.js',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  reloadOnOnline: false, // a reload would drop a half-filled gate-in form; the banner syncs instead
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // e2e builds into its own folder so it never clashes with a running `next dev` (.next)
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // lint runs once at the repo root (pnpm lint, CI), not again inside next build
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@dcl/shared'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
