import kit from 'signoff-ui/package.json';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AUTHOR, GITHUB_URL, MORE_BY_AUTHOR, NPM_URL, RELEASES_URL, TAGLINE } from '@/lib/site';
import { compactNumber, getWeeklyDownloads } from '@/lib/stats';
import { Logo } from './logo';

const link =
  'focus-visible:outline-cyan-soft rounded-sm text-[13px] text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2';
const heading = 'text-fg-subtle font-mono text-[11px] font-medium tracking-[0.08em] uppercase';

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className={heading}>{title}</h2>
      <ul className="mt-3 flex flex-col gap-2">{children}</ul>
    </nav>
  );
}

/** The same columns as the sibling sites: the project, what agents can read, and the siblings. */
export async function Footer() {
  const downloads = await getWeeklyDownloads();
  return (
    <footer className="border-line/80 bg-ink-deep border-t">
      <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 pt-12 pb-10 sm:grid-cols-2 sm:px-6 md:grid-cols-[1fr_1fr_1.6fr]">
        <Column title="Project">
          <li>
            <Link href="/docs" className={link}>
              Docs
            </Link>
          </li>
          <li>
            <a href={`${GITHUB_URL}/blob/main/packages/signoff-ui/CHANGELOG.md`} className={link}>
              Changelog
            </a>
          </li>
          <li>
            <a href={`${GITHUB_URL}/issues`} className={link}>
              Issues
            </a>
          </li>
          <li>
            <a href={NPM_URL} className={link}>
              npm
              {downloads !== undefined && downloads > 0 && (
                <span className="text-fg-subtle font-mono text-[12px]"> · {compactNumber(downloads)}/week</span>
              )}
            </a>
          </li>
          <li>
            <a href={RELEASES_URL} className={`${link} font-mono`}>
              v{kit.version}
              <span className="sr-only"> release notes</span>
            </a>
          </li>
        </Column>
        <Column title="For agents">
          <li>
            <a href="/llms.txt" className={`${link} font-mono`}>
              llms.txt
            </a>
          </li>
          <li>
            <a href="/llms-full.txt" className={`${link} font-mono`}>
              llms-full.txt
            </a>
          </li>
        </Column>
        <nav aria-label={`More by ${AUTHOR.name}`} className="sm:col-span-2 md:col-span-1">
          <h2 className={heading}>More by {AUTHOR.name}</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {MORE_BY_AUTHOR.map((project) => (
              <li key={project.name}>
                <a href={project.url} className={`${link} text-fg font-mono`}>
                  {project.name}
                </a>
                <p className="text-fg-subtle mt-0.5 text-[13px] leading-relaxed">{project.description}</p>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6">
        <div className="border-line/60 flex flex-wrap items-center gap-x-3 gap-y-2 border-t py-5">
          <Logo />
          <p className="text-fg-subtle text-[13px] leading-relaxed">
            <span className="text-fg font-mono font-semibold">signoff-ui</span> · {TAGLINE} MIT licensed, by{' '}
            <a
              href={AUTHOR.url}
              className={`${link} decoration-fg-subtle/50 hover:decoration-fg underline underline-offset-[3px]`}
            >
              {AUTHOR.name}
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
