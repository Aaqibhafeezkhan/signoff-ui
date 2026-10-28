# Architecture

How the repository fits together, for a change that reaches past one file. [CONTRIBUTING.md](./CONTRIBUTING.md) has the setup and the checks, and [RELEASING.md](./RELEASING.md) the release workflow.

## The package

`packages/signoff-ui` is the library, published to npm as `signoff-ui`. Its source is in layers:

- **Pure helpers**, in `src/lib/`: approval rules (`src/lib/policy.ts`), diffs and the review's result (`src/lib/diff.ts`, `src/lib/review.ts`), AI SDK message parts (`src/lib/ai.ts`), usage and cost (`src/lib/usage.ts`), the AG-UI and ACP converters (`src/lib/ag-ui.ts`, `src/lib/acp.ts`), text and URLs from the agent (`src/lib/untrusted.ts`), and the labels (`src/lib/labels.ts`). They have no React and no `'use client'`, so Server Components, Route Handlers and plain Node can call them.
- **Components and hooks**, in `src/` and a few modules of `src/lib/`, such as `src/lib/hooks.ts`: each module with hooks, state or event handlers starts with `'use client'`, and one that only renders markup, such as the icons (`src/lib/icons.tsx`), has no directive. A component is styled with Tailwind utilities on the `signoff-*` tokens, its root carries `data-signoff`, and what the app passes in to render as its own sits in an element with `data-signoff-slot`.
- **Styles**, in `src/styles/`: the tokens (`src/styles/theme.css`), their Tailwind v4 mapping (`src/styles/tokens.css`), and the entry for the precompiled stylesheet (`src/styles/standalone.css`).

The entry points, one per `exports` entry in `package.json`:

| Entry point                  | Source                    | What it has                                                                       |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `signoff-ui`                 | `src/index.ts`            | The components and hooks, and everything in `signoff-ui/core`                     |
| `signoff-ui/core`            | `src/core.ts`             | The pure helpers                                                                  |
| `signoff-ui/ag-ui`           | `src/ag-ui.ts`            | `useAgUiAgent` and the AG-UI converters                                           |
| `signoff-ui/acp`             | `src/acp.ts`              | The ACP converters, with no React                                                 |
| `signoff-ui/assistant-ui`    | `src/assistant-ui.ts`     | Tool UIs for assistant-ui, an optional peer                                       |
| `signoff-ui/custom-markdown` | `src/custom-markdown.tsx` | `AgentMessage` and `Reasoning` without react-markdown, for a renderer of your own |

All but `signoff-ui/custom-markdown`, which defines its two components, only re-export, and have no `'use client'` of their own, so importing one doesn't turn the helpers into client references. The AG-UI and ACP entries declare the AI SDK types they return (`src/lib/ai-types.ts`), so an app that uses only them needs no `ai`.

## The build

`pnpm build:lib` runs tsdown (`packages/signoff-ui/tsdown.config.ts`) with one output module per source module, so each keeps its own directive, and the diff worker (`src/lib/diff-worker.ts`) as an entry of its own, since `DiffReview` starts it by URL. Then:

- `packages/signoff-ui/scripts/build-css.mjs` writes `theme.css`, `theme.auto.css`, `tailwind.css`, `styles.css` and `styles.layered.css` into `dist/`. Every rule of `styles.css` is scoped with the selector from `packages/signoff-ui/scripts/kit-scope.mjs`, which matches the kit's own elements and never the app's content inside a slot.
- `packages/signoff-ui/scripts/check-directives.mjs` checks that each built module has its source's `'use client'`, and that the main, core and AG-UI entries have none.
- `packages/signoff-ui/scripts/check-dist.mjs` checks the source maps, the worker's URL, and that `styles.css` styles only the kit's elements and none of the app's theme.

`scripts/size.mjs` (`pnpm size`) bundles each import from `dist/` and holds it to a gzipped budget, and to the table on the docs' Performance page.

## The registry

`registry.json` is the shadcn registry, generated from `src/` by `scripts/registry.mjs` (`pnpm registry:generate`; `pnpm registry:check` fails when it is out of date). Each item lists a component's file and every file it imports, so it installs on its own with `npx shadcn add`. `pnpm registry:build` writes the items into the site, which serves them.

## The site

`examples/playground` is the site, signoff-ui.vercel.app, in Next.js: the playground, the components page and the docs. It builds against the local package, after `pnpm build:lib`, because it reads the built package's type declarations.

- The guides are Markdown in `examples/playground/content/docs`, listed in `examples/playground/lib/docs.ts`, which also sets the sidebar.
- A component's page comes from its entry in `examples/playground/lib/components.ts` and its "How it works" in `examples/playground/content/components`. Its props, defaults, descriptions and styling hooks come from the package: `examples/playground/lib/api.ts` reads them from `dist/*.d.ts` and `src/`.
- The API index (`/docs/api`) is the guide `examples/playground/content/docs/api.md`, with each entry point's exports written in from the same declarations as the site builds.
- The same Markdown is served at each page's `.md`, in `/llms-full.txt`, to the docs search, and to Ask and the docs MCP server, whose index `examples/playground/scripts/ask-index.ts` builds before `next build`.

## The examples

`examples/nextjs-minimal` (the README quickstart), `examples/coding-agent` (the reference app), `examples/assistant-ui` and `examples/copilotkit` ask for signoff-ui from npm, at the range `scripts/example-versions.mjs` keeps on the version this repository publishes, so a copy runs outside the repository. In the workspace they build against the local source (`overrides` in `pnpm-workspace.yaml`). The playground links the local package instead, and is never copied out.

## Tests and checks

- `packages/signoff-ui/test`: Vitest, Testing Library and axe in jsdom, for the library, and for what the README and the docs claim about it.
- `examples/playground/test`: the site's own tests, on Node's test runner (`pnpm test:site`).
- `scripts/smoke-*.mjs`, `scripts/a11y-audit.mjs` and `scripts/perf.mjs`: the built site and examples in Chrome through Playwright; some also in WebKit and Firefox (`BROWSER`).
- `.github/workflows/ci.yml` runs them on every pull request, except `scripts/smoke-fresh-install.mjs`, which runs daily and on the version pull request. `.github/workflows/release.yml` versions and publishes, and `.github/workflows/audit.yml` audits every dependency daily.
