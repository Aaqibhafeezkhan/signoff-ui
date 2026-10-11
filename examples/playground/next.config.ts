import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root },
  outputFileTracingRoot: root,
  // Each docs page as Markdown, at its own URL plus .md (app/md/).
  async rewrites() {
    return [
      { source: '/docs.md', destination: '/md/docs/introduction' },
      { source: '/docs/components/:slug.md', destination: '/md/components/:slug' },
      { source: '/docs/:slug.md', destination: '/md/docs/:slug' },
    ];
  },
  // The same headers as the sibling sites: no MIME sniffing, no full URLs to other origins, no framing.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
