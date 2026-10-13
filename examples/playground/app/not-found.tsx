import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { NAV } from '@/lib/docs';

// Its own title and description, with no canonical address or link preview: the home page's are its
// own (app/(home)), so nothing here inherits them. Next.js adds the robots noindex tag to a 404 itself.
export const metadata: Metadata = {
  title: 'Page not found · signoff-ui',
  description: 'There is no page at this address.',
  alternates: null,
  openGraph: null,
  twitter: null,
};

const link =
  'focus-visible:outline-cyan-soft rounded-sm text-[13.5px] text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2';

/** Any address with no page: the way back, with the docs' own navigation. */
export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1320px] px-4 py-16 sm:px-6 sm:py-20">
        <p className="text-cyan-soft font-mono text-[12px]">404</p>
        <h1 className="text-fg-strong mt-2 text-[30px] leading-tight font-semibold tracking-[-0.025em] sm:text-[36px]">
          Page not found
        </h1>
        <p className="text-fg-muted mt-3 max-w-[42rem] text-[15px] leading-relaxed">
          There is no page at this address. Every page of the docs is below, or start from{' '}
          <Link href="/" className={`${link} text-fg underline underline-offset-[3px]`}>
            the playground
          </Link>
          .
        </p>
        <nav aria-label="Docs" className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {NAV.map((group) => (
            <div key={group.title}>
              <h2 className="text-fg-subtle font-mono text-[11px] font-medium tracking-[0.08em] uppercase">
                {group.title}
              </h2>
              <ul className="mt-3 flex flex-col gap-1.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className={link}>
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </main>
      <Footer />
    </div>
  );
}
