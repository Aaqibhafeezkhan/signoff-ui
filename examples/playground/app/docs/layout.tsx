import type { ReactNode } from 'react';
import { DocsSidebar } from '@/components/docs/sidebar';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { askEnabled } from '@/lib/ask';
import { NAV } from '@/lib/docs';

// From 1024px: the sidebar, the page and its "On this page"; narrower until 1280px, so the page keeps its room.
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Header page="docs" />
      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[14.5rem_minmax(0,1fr)] xl:gap-12">
        <DocsSidebar nav={NAV} ask={askEnabled()} />
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
      <Footer />
    </div>
  );
}
