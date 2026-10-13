import { getGuide, GUIDES } from '@/lib/docs';
import { OG_SIZE, ogImage } from '@/lib/og';

export const alt = 'An signoff-ui docs page';
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
