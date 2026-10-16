import { getGuide, GUIDES } from '@/lib/docs';
import { OG_SIZE, ogImage } from '@/lib/og';

// Next.js reads one alt for every page of the route, so it describes the card, which carries the
// page's title and summary as text. A per-page alt would come from each page's metadata instead.
export const alt = 'Preview card from the signoff-ui docs, showing the page title and summary';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Only the pages' own images: any other slug is a 404, not an image drawn for a page that isn't there.
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.filter((doc) => doc.href !== '/docs').map((doc) => ({ slug: doc.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const doc = getGuide((await params).slug)!;
  return ogImage({ eyebrow: 'Docs', title: doc.title, description: doc.description });
}
