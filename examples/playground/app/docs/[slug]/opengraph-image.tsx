import { getGuide, GUIDES } from '@/lib/docs';
import { OG_SIZE, ogImage } from '@/lib/og';

// One alt for every page of the route, which Next.js reads as a constant; the preview has the page’s
// title and summary as text.
export const alt = 'signoff-ui docs: the page’s title and summary';
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
