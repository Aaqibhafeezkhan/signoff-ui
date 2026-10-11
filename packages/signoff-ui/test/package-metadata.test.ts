// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/* What npm shows about the package: its homepage is the website, as for onsystem and ondocs. */

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

it('points npm at the website', () => {
  expect(manifest.homepage).toBe('https://signoff-ui.vercel.app');
});
