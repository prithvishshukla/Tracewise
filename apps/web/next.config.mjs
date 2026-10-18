import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Load the repo-root .env so API_URL / TRACEWISE_API_TOKEN are shared with the other apps.
config({ path: path.join(here, '..', '..', '.env'), quiet: true });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@tracewise/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default nextConfig;
