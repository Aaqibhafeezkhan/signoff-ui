import { Analytics } from '@vercel/analytics/next';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { PACKAGE } from '@/lib/site';
import { THEME_SCRIPT } from '@/lib/theme';
import { GeistMono } from './fonts';
import './globals.css';

// What every page shares. Each page sets its own title, description, canonical address and preview
// (lib/metadata.ts), so a page without them, like the 404, inherits none of the home page's.
export const metadata: Metadata = {
  metadataBase: new URL('https://signoff-ui.vercel.app'),
  title: PACKAGE,
  openGraph: { type: 'website', siteName: PACKAGE },
  twitter: { card: 'summary_large_image' },
};

// Every page is built once, at deploy time, and never regenerated: the header's stars and the footer's
// downloads are fetched with no-store (lib/stats.ts), which would otherwise make the pages dynamic, and
// the docs' "Last updated" dates come from git, which only the build has. The API routes aren't pages.
export const dynamic = 'force-static';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f12' },
  ],
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme class is added before paint by THEME_SCRIPT, so the server's markup can't match it.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="text-fg font-sans">
        <a
          href="#main"
          className="bg-cyan text-ink focus-visible:outline-cyan-soft fixed top-2 left-2 z-50 -translate-y-16 rounded-md px-3 py-2 text-[13px] font-semibold focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Skip to content
        </a>
        {children}
        {/* Vercel Web Analytics: page views, from a script it adds in production builds only. */}
        <Analytics />
      </body>
    </html>
  );
}
