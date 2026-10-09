# Coder Extension Development Guidelines

The Coder Remote VS Code extension: an extension host (`src/`) and webview
panels (`packages/`) sharing typed contracts through `@repo/shared`.

Make the smallest correct change, follow existing patterns, and verify the
result. Prefer simple, readable solutions over clever ones; doing it right
beats doing it fast. We're colleagues: prioritize correctness over agreement,
push back on bad ideas and mistakes with evidence, and state uncertainty
instead of guessing.

## Autonomy

- Resolve routine ambiguity from the code, tests, docs and git history. Make
  reasonable, reversible assumptions that match existing patterns, state the
  consequential ones, and keep going.
- Ask only when the answer can't be recovered and would change the result,
  or before a destructive or irreversible action.
- Discuss architectural decisions first: new packages, dependencies, or
  patterns that cross features. Routine fixes need no discussion.
- Requests to implement, fix or investigate authorize that work even when
  phrased as a question. Answer informational questions directly.

## Guides

Before changing anything under `packages/` or `test/webview/`, read
[packages/AGENTS.md](packages/AGENTS.md); not every agent loads nested
`AGENTS.md` files on its own. Otherwise read only what the task needs:

- Where code goes, naming, test placement: [docs/CODE_STRUCTURE.md](docs/CODE_STRUCTURE.md)
- Tests: [docs/TESTING.md](docs/TESTING.md)
- Opening workspaces, SSH config, logging: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Telemetry: [src/instrumentation/CONVENTIONS.md](src/instrumentation/CONVENTIONS.md)
- Lint, format, TypeScript, Node.js, dependencies: [docs/TOOLING.md](docs/TOOLING.md)
- Running, PRs, reviews, releasing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Commands

- Build: `pnpm build`, `pnpm watch`, `pnpm package`
- Check: `pnpm typecheck`, `pnpm lint` (`lint:fix`), `pnpm format:check`
  (`format`)
- Unit tests: `pnpm test`, or `pnpm test:extension` / `pnpm test:webview`
  with an optional file path
- Integration tests: `pnpm test:integration`
- Storybook: `pnpm storybook`; theme snapshots: `pnpm sync:vscode-themes`

Integration tests and the theme sync launch VS Code; on headless machines
prefix them with `xvfb-run -a`. Run targeted tests while iterating, and
before handoff run typecheck, lint, format check and the affected tests.

## Guardrails

- Register `coder.*` commands through `CommandManager` and set context keys
  through `ContextManager` (`src/vscode/`); lint rejects direct calls.
- Read `env.remoteAuthority` through `vscodeProposed`; plain `vscode` throws.
- Never give a `coder.*` setting `"scope": "machine"`; use `application`
  (the README explains why).
- Webviews talk to the extension only through the typed IPC helpers.
- Emit telemetry through the domain's instrumentation class and list new
  events in `src/instrumentation/EVENTS.md`.
- Add a `CHANGELOG.md` entry for changes users should know about.
- Never disable a lint rule without user approval.

## Code style

- Strict TypeScript: no `any`, `as unknown as`, or non-null assertions
  outside tests. Prefer
  annotations and narrowing over `as`; fix types at the source.
- Use the generated API types from `coder/site/src/api/typesGenerated`; never
  redeclare them.
- ES6 features, `const` over `let`, async/await over explicit Promises,
  `_`-prefixed unused variables, wrapped and typed errors.
- YAGNI. Search for existing code before writing new code, reduce
  duplication, and delete dead code.
- Match the surrounding style. Fix bugs when you find them.
- Names say what code does, never how it's implemented or its history
  (`JsonParser`, `LegacyHandler`). Use pattern names only when they add
  clarity, and abbreviate only when obvious.
- Comments must earn their place: only non-obvious invariants, external
  constraints or tradeoffs, in one to three lines. Never restate the code,
  comment where a better name would do, or describe how code changed, and avoid words like "new", "improved" or
  "legacy". Re-read every comment your diff adds before committing.
- JSDoc exported functions and types whose contract isn't obvious.
- No em dashes, en dashes or spaced double hyphens as punctuation in code,
  comments, strings or docs.
- Keep each change to one purpose. Don't touch unrelated code, reword
  existing comments, or delete comments that explain non-obvious behavior.
- Navigate with the TypeScript language server when available.

## Version control

- Commit often. Titles use Conventional Commits (`type(scope): message`),
  imperative, around 70 characters; CI checks PR titles.
- Never skip hooks. Check `git status` before `git add`. Never force push
  unless asked.
- Linear links branches containing `<team>-<number>`: use a Linear ID only
  for its own issue, and write GitHub issue numbers as `issue-<number>`.

Read `AGENTS.local.md` when present; it is gitignored, for personal
instructions.
