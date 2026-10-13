import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import type { ImageResponseOptions } from 'next/server';

/*
 * Link preview images, drawn when the site builds: for the docs and the components page, the page's
 * title and summary on the site's ink, in Geist; for the home page, the headline beside a hunk to
 * accept or reject and a command to approve, large enough to read at card size.
 */

export const OG_SIZE = { width: 1200, height: 630 };

// `next build` runs in examples/playground.
const font = (path: string) => readFileSync(join(process.cwd(), 'node_modules/geist/dist/fonts', path));

const OPTIONS: ImageResponseOptions = {
  ...OG_SIZE,
  fonts: [
    { name: 'Geist', data: font('geist-sans/Geist-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Geist', data: font('geist-sans/Geist-SemiBold.ttf'), weight: 600, style: 'normal' },
    { name: 'Geist Mono', data: font('geist-mono/GeistMono-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'Geist Mono', data: font('geist-mono/GeistMono-Medium.ttf'), weight: 500, style: 'normal' },
  ],
};

const BACKGROUND = {
  backgroundColor: '#0d0f12',
  backgroundImage:
    'radial-gradient(circle at 12% 0%, rgba(34, 211, 238, 0.16), transparent 46%), radial-gradient(circle at 96% 8%, rgba(240, 70, 138, 0.07), transparent 40%)',
  color: '#e8eaed',
  fontFamily: 'Geist',
};

function Logo() {
  return (
    <svg width="44" height="44" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#181c22" stroke="#262b33" />
      <path d="M11 9v14" stroke="#353c47" strokeWidth="2" strokeLinecap="round" />
      <circle cx="11" cy="9" r="2.6" fill="#22d3ee" />
      <circle cx="11" cy="16" r="2.6" fill="#67e8f9" />
      <circle cx="11" cy="23" r="2.6" fill="#f0468a" />
      <path d="M17 9h7M17 16h5M17 23h7" stroke="#e8eaed" strokeWidth="2" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <Logo />
      <span style={{ fontFamily: 'Geist Mono', fontSize: 26, fontWeight: 500, color: '#e8eaed' }}>signoff-ui</span>
    </div>
  );
}

/** The address and what it works with, along the bottom. */
function Strip() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 48,
        paddingTop: 28,
        borderTop: '1px solid #262b33',
        fontFamily: 'Geist Mono',
        fontSize: 22,
        color: '#8b94a0',
      }}
    >
      <span>signoff-ui.vercel.app</span>
      <span style={{ color: '#c9d1d9' }}>AI SDK 6 & 7 · AG-UI · ACP · assistant-ui</span>
    </div>
  );
}

const frame = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  padding: '64px 72px',
  ...BACKGROUND,
} as const;

export function ogImage({
  eyebrow,
  title,
  description,
  code = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** Set the title in Geist Mono, as a component's name. */
  code?: boolean;
}) {
  return new ImageResponse(
    <div style={frame}>
      <Brand />
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
        <span style={{ fontFamily: 'Geist Mono', fontSize: 24, color: '#67e8f9', letterSpacing: 1 }}>{eyebrow}</span>
        <span
          style={{
            marginTop: 18,
            fontFamily: code ? 'Geist Mono' : 'Geist',
            fontSize: code ? 70 : 74,
            fontWeight: code ? 500 : 600,
            letterSpacing: code ? -1 : -2.5,
            lineHeight: 1.05,
            color: '#f1f3f5',
          }}
        >
          {title}
        </span>
        <span
          style={{
            marginTop: 24,
            maxWidth: 940,
            fontSize: 30,
            lineHeight: 1.4,
            color: '#a1a9b4',
          }}
        >
          {description}
        </span>
      </div>
      <Strip />
    </div>,
    OPTIONS,
  );
}

const DIFF: Array<['+' | '-' | ' ', string]> = [
  [' ', 'export async function POST(req) {'],
  ['+', '  const { success } = await limit(req);'],
  ['+', '  if (!success) return tooMany();'],
  ['-', '  const body = await req.json();'],
  ['+', '  const { messages } = await req.json();'],
];

function Button({ children, primary = false }: { children: string; primary?: boolean }) {
  return (
    <span
      style={{
        display: 'flex',
        padding: '6px 14px',
        borderRadius: 8,
        border: primary ? '1px solid #22d3ee' : '1px solid #353c47',
        backgroundColor: primary ? '#22d3ee' : 'transparent',
        color: primary ? '#0d0f12' : '#e8eaed',
        fontSize: 19,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

/** The home page's card: the headline, and the two things the kit does, drawn small beside it. */
export function homeOgImage(headline: string) {
  const card = {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid #262b33',
    borderRadius: 16,
    backgroundColor: '#12151a',
    overflow: 'hidden',
  } as const;
  return new ImageResponse(
    <div style={frame}>
      <Brand />
      <div style={{ display: 'flex', alignItems: 'center', gap: 44, marginTop: 'auto' }}>
        <span
          style={{
            width: 520,
            fontSize: 66,
            fontWeight: 600,
            letterSpacing: -2.2,
            lineHeight: 1.08,
            color: '#f1f3f5',
          }}
        >
          {headline}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
          <div style={card}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '12px 18px',
                borderBottom: '1px solid #262b33',
                fontFamily: 'Geist Mono',
                fontSize: 18,
                color: '#c9d1d9',
              }}
            >
              <span>app/api/chat/route.ts</span>
              <span style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: '#67e8f9' }}>+3</span>
                <span style={{ color: '#f472a8' }}>−1</span>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 0' }}>
              {DIFF.map(([sign, text]) => (
                <span
                  key={text}
                  style={{
                    display: 'flex',
                    padding: '2px 18px',
                    fontFamily: 'Geist Mono',
                    fontSize: 16,
                    whiteSpace: 'pre',
                    color: sign === ' ' ? '#8b94a0' : '#e8eaed',
                    backgroundColor:
                      sign === '+'
                        ? 'rgba(34, 211, 238, 0.12)'
                        : sign === '-'
                          ? 'rgba(240, 70, 138, 0.14)'
                          : 'transparent',
                  }}
                >
                  {`${sign} ${text}`}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, padding: '4px 18px 14px' }}>
              <Button primary>Accept hunk</Button>
              <Button>Reject</Button>
            </div>
          </div>
          <div style={{ ...card, flexDirection: 'row', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
            <span style={{ display: 'flex', width: 10, height: 10, borderRadius: 5, backgroundColor: '#f0468a' }} />
            <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 17, color: '#a1a9b4' }}>Approval needed</span>
              <span style={{ fontFamily: 'Geist Mono', fontSize: 20, color: '#f1f3f5' }}>pnpm test</span>
            </span>
            <Button primary>Approve</Button>
            <Button>Deny</Button>
          </div>
        </div>
      </div>
      <Strip />
    </div>,
    OPTIONS,
  );
}
