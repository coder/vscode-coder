# Tooling

How linting, formatting, TypeScript, Node.js and dependencies are set up, and
what to update when changing them.

## Linting

Linting runs in two stages: [Oxlint](https://oxc.rs) handles all JS/TS/TSX
rules, and a residual ESLint pass covers what Oxlint cannot do yet. When an
Oxlint equivalent lands, remove the corresponding entry from
`eslint.config.mjs` and this list.

| ESLint rule/plugin                                          | Why Oxlint can't do it                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `import-x/order`                                            | Oxlint has no import ordering rule; Oxfmt's `sortImports` reorders differently |
| `@eslint/markdown` (`markdown/no-missing-label-refs`, etc.) | Oxlint only lints source extensions; Markdown needs processors                 |
| `eslint-plugin-package-json` (58 rules)                     | Oxlint only lints source extensions                                            |

`eslint-plugin-oxlint` reads `.oxlintrc.jsonc` and disables every rule Oxlint
already covers, so the two stages never overlap.

When editing `.oxlintrc.jsonc`:

- `overrides[].files` does not support extglob alternatives like `@(ts|tsx)`.
  They silently match nothing (oxc-project/oxc#21525). Use brace globs
  (`{ts,tsx}`) or list extensions.
- `settings` is not supported inside `overrides`, and `no-restricted-imports`
  patterns only understand `**` and literal paths, not single `*`.

`test/unit/oxlintConfig.test.ts` guards both regressions.

## Formatting

Oxfmt formats every file type in the repo, using its own bundled Prettier for
Markdown, YAML and CSS. Its config is `.oxfmtrc.jsonc`, and it also skips
everything in `.gitignore`.

## TypeScript Version

TypeScript 7 has no programmatic API yet, so `typescript-eslint` cannot load
against it. The two run side-by-side, following the
[official guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):

- `typescript` is aliased to `@typescript/typescript6`: the 6.0 API that
  `typescript-eslint` consumes. Its binary is `tsc6`.
- `@typescript/native` is aliased to `typescript@^7`: the `tsc` binary used by
  `pnpm typecheck` and editors.

When TypeScript 7 ships an API, drop `@typescript/native` and point `typescript`
back at a single version.

## Node.js Version

This extension targets the Node.js version bundled with VS Code's Electron:

| VS Code | Electron | Node.js | Status            |
| ------- | -------- | ------- | ----------------- |
| 1.105   | 37       | 22      | Minimum supported |
| stable  | latest   | varies  | Also tested in CI |

When updating the minimum Node.js version, update these files:

- **package.json**: `engines.vscode`, `engines.node`, `@types/node`, `@tsconfig/nodeXX`
- **tsconfig.json**: `extends` (the `@tsconfig/nodeXX` package), `lib` (match base ESNext version)
- **scripts/esbuild.mjs**: `target`
- **.github/workflows/ci.yaml**: `electron-version` and `vscode-version` matrices

## Dependencies

Some dependencies are not directly used in the source but are required anyway.

- `bufferutil` and `utf-8-validate` are peer dependencies of `ws`. Their source
  builds are off, so Windows on ARM64 uses their JavaScript fallback.
- `ua-parser-js` and `dayjs` are used by the Coder API client.

The coder client is vendored from coder/coder. Pin it to a release tag in
`pnpm-workspace.yaml` (e.g. `coder: github:coder/coder#v2.33.1`), not `#main`.
A tag gives reproducible builds and is not re-fetched on every `pnpm install`,
unlike `#main` which can drift between installs. To update, bump the tag and
run `pnpm install` (or `pnpm update coder`).

After running `pnpm update`, always run `pnpm dedupe` to consolidate duplicate
package versions across the workspace. Without this, workspace packages can
resolve to different versions of the same dependency, causing issues like broken
React context propagation when two copies of a library are loaded.
