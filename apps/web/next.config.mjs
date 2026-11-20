// Next.js config. /api/v1 is forwarded to the API by src/app/api/v1/[...path]/route.js (runtime API_URL).

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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

export default nextConfig;
