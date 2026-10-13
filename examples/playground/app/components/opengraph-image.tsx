import { OG_SIZE, ogImage } from '@/lib/og';

export const alt = 'signoff-ui: every component in isolation';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogImage({
    eyebrow: 'Components',
    title: 'Every component, live',
    description:
      'Per-hunk diff review, approvals and their rules, tool timelines, run telemetry, sources, an AG-UI agent and an ACP turn, each with its install command.',
  });
}
