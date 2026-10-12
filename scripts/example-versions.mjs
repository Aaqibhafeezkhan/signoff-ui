// Keeps the examples that ask for a version range of signoff-ui on the version this repository
// publishes: `^<version>`, from packages/signoff-ui/package.json. `pnpm version-packages` runs it
// after `changeset version`, so the release pull request moves them to the version it publishes.
// Examples that ask for `latest` follow npm on their own and are left alone.
//
// In the workspace every example builds against the local source (`overrides` in
// pnpm-workspace.yaml), and pnpm-lock.yaml records the override, not the range: changing the range
// leaves the lockfile as it is.
//
// Usage: node scripts/example-versions.mjs [--check]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { name, version } = JSON.parse(readFileSync(join(root, 'packages/signoff-ui/package.json'), 'utf8'));
const range = `^${version}`;
const check = process.argv.includes('--check');

const stale = [];
for (const entry of readdirSync(join(root, 'examples'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = join(root, 'examples', entry.name, 'package.json');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const asked = JSON.parse(text).dependencies?.[name];
  // A version range (`^0.6.0`, `~0.6.0`, `0.6.0`), not `latest` or a workspace link.
  if (typeof asked !== 'string' || !/^[\^~]?\d/.test(asked) || asked === range) continue;
  stale.push(`examples/${entry.name} (${asked})`);
  if (!check) writeFileSync(file, text.replace(`"${name}": "${asked}"`, `"${name}": "${range}"`));
}

if (check && stale.length > 0) {
  console.error(
    `These examples ask for another version of ${name} than ${range}, the one this repository publishes:\n` +
      stale.map((line) => `  ${line}`).join('\n') +
      '\nRun `node scripts/example-versions.mjs`.',
  );
  process.exit(1);
}
console.log(
  check
    ? `The examples that ask for a version of ${name} ask for ${range}.`
    : stale.length > 0
      ? `Now asking for ${name}@${range}: ${stale.join(', ')}`
      : `The examples already ask for ${name}@${range}.`,
);
