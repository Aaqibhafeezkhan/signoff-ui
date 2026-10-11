/** Links and names the whole site shares. */
export const SITE_URL = 'https://signoff-ui.vercel.app';
export const GITHUB_URL = 'https://github.com/dgesteves/signoff-ui';
export const NPM_URL = 'https://www.npmjs.com/package/signoff-ui';
export const PACKAGE = 'signoff-ui';
export const INSTALL_COMMAND = `npm i ${PACKAGE}`;
export const GET_STARTED_URL = '/docs/getting-started';
export const RELEASES_URL = `${GITHUB_URL}/releases`;

/** The hosted shadcn registry: each item is `${REGISTRY_URL}/<item>.json`. */
export const REGISTRY_URL = `${SITE_URL}/r`;
/**
 * The command that adds a registry item. By URL, so it works with no setup: the `@signoff-ui`
 * namespace needs a `registries` entry in components.json until the shadcn directory lists it.
 */
export const shadcnAdd = (item: string) => `npx shadcn@latest add ${REGISTRY_URL}/${item}.json`;

export const AUTHOR = { name: 'Diogo Esteves', url: 'https://github.com/dgesteves' };

/** The owner's other open-source projects, for the footer. */
export const MORE_BY_AUTHOR = [
  {
    name: 'ondocs',
    url: 'https://ondocs.vercel.app',
    description:
      'Docs answerable by people and agents from one static index: a cited Ask box, an MCP server and llms.txt.',
  },
  {
    name: 'onsystem',
    url: 'https://onsystem.vercel.app',
    description: 'Keeps coding agents on your design system, and the same check gates your PRs.',
  },
];
