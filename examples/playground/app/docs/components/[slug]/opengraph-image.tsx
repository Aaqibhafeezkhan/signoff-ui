import { COMPONENTS, getComponent } from '@/lib/components';
import { OG_SIZE, ogImage } from '@/lib/og';

// Next.js reads one alt for every page of the route, so it describes the card, which carries the
// component's name and summary as text. A per-page alt would come from each page's metadata instead.
export const alt = 'Preview card from the signoff-ui docs, showing the component name and what it does';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Only the pages' own images: any other slug is a 404, not an image drawn for a page that isn't there.
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPONENTS.map((c) => ({ slug: c.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const component = getComponent((await params).slug)!;
  return ogImage({
    eyebrow: 'Components',
    title: component.name.startsWith('use') ? `${component.name}()` : `<${component.name} />`,
    description: component.summary.replace(/`/g, ''),
    code: true,
  });
}
