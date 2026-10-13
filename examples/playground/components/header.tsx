import kit from 'signoff-ui/package.json';
import { getStars } from '@/lib/stats';
import { SiteHeader, type Page } from './site-header';

/** The site's header, with the version and the star count read when the site builds. */
export async function Header({
  page,
}: {
  /** The section the page belongs to; none on the home page. */
  page?: Page;
}) {
  return <SiteHeader page={page} version={kit.version} stars={await getStars()} />;
}
