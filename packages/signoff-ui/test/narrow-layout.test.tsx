import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApprovalCard } from '../src/approval-card';
import { DiffReview } from '../src/diff-review';
import { SignoffLabelsProvider } from '../src/labels';
import { APPROVAL_DECISIONS } from '../src/lib/policy';
import { ROUTE_NEW, ROUTE_OLD } from './fixtures';
import { pt } from './labels-pt';

/*
 * Narrow containers, such as a phone or a sidebar, with labels longer than English. jsdom has no
 * layout, so these check the markup that lets things wrap; scripts/smoke-styles.mjs renders the same
 * review and card in Portuguese in 330px and 360px columns in Chrome and measures them.
 */

const files = [
  { path: 'app/api/chat/route.ts', oldContent: ROUTE_OLD, newContent: ROUTE_NEW },
  { path: 'lib/ratelimit.ts', oldContent: '', newContent: "export const ratelimit = createLimiter('10 s');\n" },
];

function Narrow({ children }: { children: ReactNode }) {
  return (
    <div lang="pt-PT" style={{ width: 360 }}>
      <SignoffLabelsProvider labels={pt}>{children}</SignoffLabelsProvider>
    </div>
  );
}

describe('DiffReview in Portuguese, 360px wide', () => {
  it("wraps the file's buttons and the footer's rather than pushing them past its edge or onto two lines", () => {
    render(
      <Narrow>
        <DiffReview files={files} onSubmit={() => {}} />
      </Narrow>,
    );
    const acceptFile = screen.getByRole('button', { name: /^Aceitar ficheiro\s*app\/api/ });
    const fileButtons = acceptFile.parentElement!;
    // Viewed, Reject file and Accept file wrap among themselves...
    expect(within(fileButtons).getByText('Visto')).toBeInTheDocument();
    expect(fileButtons).toHaveClass('flex-wrap');
    // ...and the group with the counts may shrink to the header's width instead of overflowing it.
    expect(fileButtons.parentElement).toHaveClass('flex-wrap');
    expect(fileButtons.parentElement).not.toHaveClass('shrink-0');
    for (const name of [/^Rejeitar ficheiro\s*app\/api/, /^Aceitar ficheiro\s*app\/api/])
      expect(screen.getByRole('button', { name })).toHaveClass('whitespace-nowrap');

    const footer = screen.getByRole('button', { name: 'Aceitar tudo' }).parentElement!;
    expect(footer).toHaveClass('flex-wrap');
    for (const button of within(footer).getAllByRole('button')) expect(button).toHaveClass('whitespace-nowrap');
    expect(within(footer).getByRole('button', { name: 'Aplicar alterações' })).toBeInTheDocument();
  });

  it('keeps each "+n −n" together, in the review\'s header and in each file\'s', () => {
    render(
      <Narrow>
        <DiffReview files={files} onSubmit={() => {}} />
      </Narrow>,
    );
    const counts = screen
      .getAllByText((_, el) => el?.tagName === 'SPAN' && /^\+\d+ −\d+$/.test(el.textContent ?? ''))
      .filter((el) => !/^\+\d+ −\d+$/.test(el.parentElement?.textContent ?? ''));
    // The review's header, then the two files'.
    expect(counts).toHaveLength(3);
    for (const el of counts) expect(el).toHaveClass('whitespace-nowrap');
  });

  it("puts a decided hunk's badge under its range, away from the buttons, when the hunk is narrow", () => {
    render(
      <Narrow>
        <DiffReview files={files} defaultDecisions={{ 'app/api/chat/route.ts:0': 'accepted' }} onSubmit={() => {}} />
      </Narrow>,
    );
    const hunk = document.querySelector<HTMLElement>('[data-slot="signoff-diff-hunk"]')!;
    const badge = within(hunk).getByText(pt.diffReview.badge.accepted);
    const beside = badge.parentElement!;
    expect(beside.textContent).toMatch(/^@@ -1,\d+ \+1,\d+ @@/);
    expect(within(beside).queryByRole('button')).toBeNull();
    expect(beside).toHaveClass('@max-[30rem]:flex-col');
    expect(beside.parentElement).toHaveClass('@container');
  });

  it('wraps long lines in the unified view when the code is narrow, rather than scrolling each hunk', () => {
    render(
      <Narrow>
        <DiffReview files={files} onSubmit={() => {}} />
      </Narrow>,
    );
    const line = screen.getAllByText(pt.diffReview.added.trim())[0]!.parentElement!;
    expect(line).toHaveClass('whitespace-pre', '@max-[30rem]:whitespace-pre-wrap', '@max-[30rem]:break-all');
    // Nothing above it holds the row at the longest line's width.
    expect(line.closest('.min-w-max')).toHaveClass('@max-[30rem]:min-w-0');
  });
});

describe('ApprovalCard with five choices, in Portuguese, 360px wide', () => {
  it('lays the choices out in two columns with Approve across the last row, in the order they are tabbed', () => {
    render(
      <Narrow>
        <ApprovalCard
          toolName="run_command"
          input={{ command: 'pnpm add @upstash/ratelimit' }}
          decisions={APPROVAL_DECISIONS}
          onDecide={() => {}}
        />
      </Narrow>,
    );
    const choices = [...document.querySelectorAll<HTMLButtonElement>('button[data-decision]')];
    expect(choices.map((b) => b.dataset.decision)).toEqual([
      'deny-always',
      'deny-once',
      'allow-session',
      'allow-always',
      'allow-once',
    ]);
    const group = choices[0]!.parentElement!;
    expect(group).toHaveClass(
      '@max-[40rem]:has-[>:nth-child(4)]:grid',
      '@max-[40rem]:has-[>:nth-child(4)]:grid-cols-[repeat(2,minmax(min-content,1fr))]',
      '@max-[40rem]:[&>:last-child:nth-child(odd)]:col-span-full',
    );
    // The container the breakpoint measures: the row with the choices, as wide as the card's body.
    expect(group.closest('.\\@container')).not.toBeNull();
    for (const choice of choices) expect(choice).toHaveClass('whitespace-nowrap');
  });
});
