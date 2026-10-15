/** Links and names the whole site shares. */
export const SITE_URL = 'https://signoff-ui.vercel.app';
export const GITHUB_URL = 'https://github.com/dgesteves/signoff-ui';
export const NPM_URL = 'https://www.npmjs.com/package/signoff-ui';
export const PACKAGE = 'signoff-ui';
/** What signoff-ui is, in one line: the same on the site, in the README, on npm and in the siblings' footers. */
export const TAGLINE = 'Review what your agent changed and approve what it may do.';
export const INSTALL_COMMAND = `npm i ${PACKAGE}`;
export const GET_STARTED_URL = '/docs/getting-started';
export const RELEASES_URL = `${GITHUB_URL}/releases`;
/** The reference app, a coding agent on a scripted model, as a new app: it needs no API key (Getting started). */
export const REFERENCE_APP_COMMAND = `npx create-next-app@latest my-agent --example ${GITHUB_URL}/tree/main/examples/coding-agent`;
/** Where the docs say how to add their MCP server to a coding agent. */
export const MCP_DOCS_URL = '/docs#use-these-docs-from-your-agent';
/** A prompt to paste into a coding agent, so it sets the kit up with the docs at hand. */
export const AGENT_SETUP_PROMPT = `Set up signoff-ui in this app. Read ${SITE_URL}/llms.txt first (the same docs are an MCP server at ${SITE_URL}/api/mcp). Install it with npm i signoff-ui, render the tool calls that need my approval with its approval card, and put a DiffReview on the tool that proposes edits, so I approve commands and review changes before they land.`;

/** The hosted shadcn registry: each item is `${REGISTRY_URL}/<item>.json`. */
export const REGISTRY_URL = `${SITE_URL}/r`;
/**
 * The command that adds a registry item. By URL, so it works with no setup: the `@signoff-ui`
 * namespace needs a `registries` entry in components.json until the shadcn directory lists it.
 */
export const shadcnAdd = (item: string) => `npx shadcn@latest add ${REGISTRY_URL}/${item}.json`;

export const AUTHOR = { name: 'Diogo Esteves', url: 'https://github.com/dgesteves' };

/** The owner's other open-source projects, for the footer, each with its own one-line tagline. */
export const MORE_BY_AUTHOR = [
  {
    name: 'ondocs',
    url: 'https://ondocs.vercel.app',
    description: 'Makes your docs answerable by people and agents, from one static index.',
  },
  {
    name: 'onsystem',
    url: 'https://onsystem.vercel.app',
    description: 'Keeps coding agents on your design system.',
  },
];
