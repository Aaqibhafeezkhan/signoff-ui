import type { MetadataRoute } from 'next';
import { componentHref, COMPONENTS, componentSources } from '@/lib/components';
import { GUIDES } from '@/lib/docs';
import { lastModified } from '@/lib/git';
import { SITE_URL } from '@/lib/site';

const PG = 'examples/playground';

/**
 * Every page, each dated by the last commit to what it is made from. Without that history (a
 * shallow clone), the date is left out rather than set to the build's.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, sources: string[]) => ({
    url: `${SITE_URL}${path}`,
    lastModified: lastModified(...sources),
    priority,
  });
  return [
    page('', 1, [`${PG}/app/(home)`, `${PG}/components/hero.tsx`, `${PG}/components/landing.tsx`]),
    page('/components', 0.8, [`${PG}/app/components`, `${PG}/components/demos`]),
    ...GUIDES.map((doc) => page(doc.href, 0.8, [`${PG}/content/docs/${doc.slug}.md`])),
    ...COMPONENTS.map((c) => page(componentHref(c.slug), 0.7, componentSources(c))),
  ];
}
