// The changelog entries `changeset version` writes to packages/signoff-ui/CHANGELOG.md, and so to the
// version pull request and the GitHub release: @changesets/changelog-github's, with their pull
// request and commit links, without "Thanks @<login>!" for the maintainers, who write nearly every
// changeset. Anyone else who wrote one is still thanked. .changeset/config.json points here:
//
//   "changelog": ["../scripts/changelog.mjs", { "repo": "dgesteves/signoff-ui", "maintainers": ["dgesteves"] }]
//
// The options are changelog-github's, plus `maintainers`, the GitHub logins it doesn't thank (the
// owner of `repo` by default).
import github from '@changesets/changelog-github';

const USER = /\[@([^\]]+)\]\([^)\s]*\)/g;
// The start of an entry: "\n\n-", then the pull request and commit links, then " Thanks <users>! -".
const LEAD = /^(\s*-)((?: \[[^\]]*\]\([^)\s]*\))*) Thanks (\[@[^\]]+\]\([^)\s]*\)(?:, \[@[^\]]+\]\([^)\s]*\))*)! -/;

/** A release line from changelog-github, without the `maintainers` in its "Thanks …!". */
export function withoutThanks(line, maintainers) {
  const skip = new Set(maintainers.map((login) => login.toLowerCase()));
  return line.replace(LEAD, (_, dash, links, users) => {
    const thanked = [...users.matchAll(USER)].filter(([, login]) => !skip.has(login.toLowerCase()));
    if (thanked.length > 0) return `${dash}${links} Thanks ${thanked.map(([link]) => link).join(', ')}! -`;
    // With no link either, "- - summary" would be left: keep "- summary".
    return links ? `${dash}${links} -` : dash;
  });
}

const maintainersOf = (options) => options?.maintainers ?? [String(options?.repo ?? '').split('/')[0]].filter(Boolean);

export default {
  getDependencyReleaseLine: github.getDependencyReleaseLine,
  getReleaseLine: async (changeset, type, options) =>
    withoutThanks(await github.getReleaseLine(changeset, type, options), maintainersOf(options)),
};
