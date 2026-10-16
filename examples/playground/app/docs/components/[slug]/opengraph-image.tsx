import { COMPONENTS, getComponent } from '@/lib/components';
import { OG_SIZE, ogImage } from '@/lib/og';

// One alt for every page of the route, which Next.js reads as a constant; the preview has the page’s
// title and summary as text.
export const alt = 'signoff-ui: the component’s name and what it does';
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
