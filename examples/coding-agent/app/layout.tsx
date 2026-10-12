import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// The kit's stylesheet for apps without Tailwind, and its dark palette when the OS is in dark mode.
import 'signoff-ui/styles.css';
import 'signoff-ui/theme.auto.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Coding agent · signoff-ui',
  description:
    'A background coding agent: it asks before it runs commands, your approval rules answer what they cover, and you review its edits before anything is written. The signoff-ui reference app.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f12' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to the run
        </a>
        {children}
      </body>
    </html>
  );
}
