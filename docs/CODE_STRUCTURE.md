# Code Structure

Rules for where code lives and what it is called. The rules describe how to
decide, not what exists today, so adding a folder or package needs no edit
here. Change this file only when a rule changes.

## Runtimes

The repo builds for two runtimes, split the same way as Electron's main and
renderer processes:

- **Extension host** (`src/`): Node.js plus the `vscode` API.
- **Webviews** (`packages/`): isolated browser contexts with no Node or
  `vscode` access.

Rules for code on either side:

- **Cross the boundary only with messages.** The extension and webviews talk
  through the typed IPC contracts in `@repo/shared` (see the
  [`webview-shared` README](../packages/webview-shared/README.md)), never by
  importing each other's code.
- **Keep `@repo/shared` runtime-free.** Use plain TypeScript, with no Node
  built-ins, DOM or `vscode`. When behavior differs by runtime, take it as a
  parameter, the way `toError` takes its serializer.
- **Dependencies point one way.** `src/` imports only `@repo/shared`. Panel
  packages may import `@repo/webview-shared`, `@repo/ui` and `@repo/shared`,
  and `@repo/webview-shared` imports only `@repo/shared`. Nothing imports a
  panel package.
- **Import a package through its `exports`** (`@repo/shared`,
  `@repo/webview-shared/react`), never through a relative path into another
  package. Inside a package, shared internals can use `#` subpath imports.
- **`@repo/mocks` and `@repo/storybook-utils` are for tests and stories
  only.** Lint rejects them in runtime code.

### `@repo/ui`

`@repo/ui` is a library of generic, VS Code-style React components, and it is
built to be split into its own package later:

- **It imports no other workspace package**, and lint enforces this.
- **It styles only through its `--ui-*` tokens**, so it never depends on a
  particular panel.
- **Its public API is the package root and its CSS exports.** Consumers never
  reach into its files.

A component that knows about Coder, tasks or workspaces belongs in a panel
package, even if it is built from `@repo/ui` parts. The
[`ui` README](../packages/ui/README.md) covers the details.

## Where new code goes

Pick the first option that fits:

1. **One consumer:** put it in that consumer's file.
2. **One feature:** put it in a module in that feature's folder. A new
   feature gets its own `src/<feature>/` folder, and a new webview panel
   gets its own package.
3. **Several features, one domain:** put it in that domain's folder (the
   folder for the Coder API, the CLI, storage, VS Code APIs, and so on).
   Code that knows about a domain never goes in `src/common/`.
4. **Several features, no domain:** put it in a topic file in `src/common/`
   (for example `strings.ts`). Don't add a new top-level file for it.

In webviews, apply the same steps inside a package. Code used by more than
one package goes in:

- `@repo/shared`: types and IPC contracts the extension also uses
- `@repo/webview-shared`: IPC and React plumbing for webviews
- `@repo/ui`: generic components (see [`@repo/ui`](#repoui))

Move code to a shared place only once a second consumer needs it.

## Modules

- **Name a module by its topic**, so the name says what's inside
  (`severity.ts`, `httpAgent.ts`). In `src/` and `packages/*/src/`, never use
  `utils`, `helpers` or `misc` as a file or folder name. Test-only support
  code is the exception (see [Tests](#tests)).
- **Group related functions in one module.** Don't create one file per
  function. When a module mixes topics, split it by topic, not by size.
- **A class, component or hook gets its own file**, named after it:

  | Kind             | File                   | Main export                  |
  | ---------------- | ---------------------- | ---------------------------- |
  | Extension module | `fooManager.ts`        | `FooManager` or `fooManager` |
  | React component  | `FooPanel.tsx`         | `FooPanel`                   |
  | Hook             | `useFoo.ts`            | `useFoo`                     |
  | Story            | `FooPanel.stories.tsx` | stories for `FooPanel`       |

- **In a panel package, hooks used by several components go in `hooks/`.**
  A hook used by one component sits next to that component. Library packages
  keep a hook next to the code it serves.
- **Import from the module that defines a symbol.** Re-export files exist
  only as a package's entry points, the paths listed in its `package.json`
  `exports`.

## Tests

- **Tests mirror source:**
  - `src/<path>.ts` → `test/unit/<path>.test.ts`
  - `packages/<pkg>/src/<path>.ts` → `test/webview/<pkg>/<path>.test.ts`
- **Split a large suite by aspect** as `<module>.<aspect>.test.ts`, for
  example `fooManager.concurrent.test.ts`.
- **A suite that tests several modules through a public API** sits in the
  closest folder those modules share. Suites that guard repo config, like
  `oxlintConfig.test.ts`, sit at the `test/unit/` root.
- **Test support code** goes next to the tests that use it. Mocks shared
  across folders go in `test/mocks/`, and tested helpers in `test/utils/`.

## Background

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
  and [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview):
  isolated renderers that talk to the privileged side only through messages
- [VS Code source organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization):
  runtime-free `common` code that both sides can use, with dependencies
  pointing one way
- [VS Code `base/common`](https://github.com/microsoft/vscode/tree/main/src/vs/base/common):
  topic modules with several functions each
- [Colocation](https://kentcdodds.com/blog/colocation) (Kent C. Dodds)
