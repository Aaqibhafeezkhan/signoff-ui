import Link from 'next/link';
import type { ReactNode } from 'react';
import { getHeadings, getPager, NAV, readGuide, type DocPage, type Heading } from '@/lib/docs';
import { lastModified } from '@/lib/git';
import { GITHUB_URL, SITE_URL } from '@/lib/site';
import { ArrowRightIcon, GitHubIcon } from '../icons';
import { GuideDemo } from './guide-demo';
import { DocMarkdown } from './markdown';
import { PageActions } from './page-actions';
import { TableOfContents, TocMenu } from './toc';

function Pager({ href }: { href: string }) {
  const { prev, next } = getPager(href);
  if (!prev && !next) return null;
  const card =
    'group focus-visible:outline-cyan-soft flex flex-col gap-1 rounded-xl border border-line px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2';
  return (
    <nav aria-label="Previous and next pages" className="border-line mt-16 grid gap-3 border-t pt-8 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className={card}>
          <span className="text-fg-subtle font-mono text-[11px]">Previous</span>
          <span className="text-fg text-[14px] font-medium">{prev.title}</span>
        </Link>
      ) : (
        <span aria-hidden="true" className="hidden sm:block" />
      )}
      {next && (
        <Link href={next.href} className={`${card} sm:items-end sm:text-right`}>
          <span className="text-fg-subtle font-mono text-[11px]">Next</span>
          <span className="text-fg flex items-center gap-1.5 text-[14px] font-medium">
            {next.title}
            <ArrowRightIcon className="text-fg-subtle size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </Link>
      )}
    </nav>
  );
}

const footerLink =
  'focus-visible:outline-cyan-soft text-fg-muted hover:text-fg inline-flex items-center gap-1.5 rounded-sm text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * A docs page: title, summary, actions, body, where to change or report it, and the pager. "On
 * this page" is beside it from 1024px, and a menu in the docs bar below that.
 */
export function DocShell({
  href,
  group,
  title,
  description,
  markdownPath,
  sourcePaths,
  headings,
  children,
}: {
  href: string;
  group: string | undefined;
  title: string;
  description: string;
  markdownPath: string;
  /**
   * The files the page is made from, from the repository's root: the first is the one to edit, and
   * the last commit to any of them is when the page was last updated.
   */
  sourcePaths: string[];
  headings: Heading[];
  children: ReactNode;
}) {
  const updated = lastModified(...sourcePaths);
  const issue = new URLSearchParams({ title: `Docs: ${title}`, body: `Page: ${SITE_URL}${href}\n\n` });
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-12">
      <TocMenu headings={headings} />
      <article className="min-w-0 pt-8 pb-16 lg:pt-12">
        <div className="max-w-[46rem]">
          {group && <p className="text-cyan-soft font-mono text-[12px]">{group}</p>}
          <h1 className="text-fg-strong mt-2 text-[30px] leading-tight font-semibold tracking-[-0.025em] sm:text-[36px]">
            {title}
          </h1>
          <p className="text-fg-muted mt-3 max-w-[38rem] text-[16px] leading-relaxed text-pretty sm:text-[17px]">
            {description}
          </p>
          <div className="mt-6">
            <PageActions markdownPath={markdownPath} />
          </div>
          <div className="mt-10">{children}</div>
          <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href={`${GITHUB_URL}/edit/main/${sourcePaths[0]}`} className={footerLink}>
              <GitHubIcon className="size-3.5" />
              Edit this page on GitHub
            </a>
            <a href={`${GITHUB_URL}/issues/new?${issue}`} className={footerLink}>
              Report an issue
            </a>
            {/* Only when the build has the history to know it (lib/git.ts). */}
            {updated && (
              <p className="text-fg-subtle text-[13px] sm:ml-auto">
                Last updated{' '}
                <time dateTime={updated.toISOString()}>
                  {updated.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </time>
              </p>
            )}
          </div>
          <Pager href={href} />
        </div>
      </article>
      <div className="hidden lg:block">
        <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] [scrollbar-width:thin] overflow-y-auto py-12">
          <TableOfContents headings={headings} />
        </div>
      </div>
    </div>
  );
}

/** A guide, from its Markdown. */
export function DocArticle({ doc }: { doc: DocPage }) {
  const markdown = readGuide(doc);
  return (
    <DocShell
      href={doc.href}
      group={NAV.find((g) => g.items.some((item) => item.href === doc.href))?.title}
      title={doc.title}
      description={doc.description}
      markdownPath={doc.href === '/docs' ? '/docs.md' : `${doc.href}.md`}
      sourcePaths={[`examples/playground/content/docs/${doc.slug}.md`]}
      headings={getHeadings(markdown)}
    >
      <GuideDemo slug={doc.slug} />
      <DocMarkdown markdown={markdown} />
    </DocShell>
  );
}
