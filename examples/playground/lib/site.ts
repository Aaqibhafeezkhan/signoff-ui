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
