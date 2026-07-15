# @repo/ui

Generic component library for VS Code webviews. No workspace or task
knowledge — that lives in the consuming packages (`@repo/workspaces`,
`@repo/tasks`).

## Theming

`tokens.css` defines semantic `--ui-*` custom properties mapped to the
`--vscode-*` variables VS Code injects into every webview. Components
style against the semantic tokens only, so the VS Code mapping (including
high contrast) is adjusted in one place. Tokens whose underlying variable
may be absent (high contrast themes omit hover/selection fills) declare a
fallback, so every token always resolves. Import it once per webview
entry point:

```ts
import "@repo/ui/tokens.css";
```

`useVscodeTheme()` returns the active theme kind (`dark`, `light`,
`high-contrast`, `high-contrast-light`) and re-renders on theme changes.

`codicon.css` re-exports the codicon font and classes.

## Overlays

`Tooltip`, `ContextMenu`, and `DropdownMenu` wrap the Radix primitives and
are styled to match the native VS Code menu and hover widgets. The menus
expose Radix's compound parts as flat named exports
(`DropdownMenuTrigger`, `DropdownMenuItem`, …); `Tooltip` is a single
component taking a `content` prop, with a 500ms show delay matching VS
Code's `workbench.hover.delay` default. Each `Tooltip` mounts its own
Radix provider, so the cross-trigger skip-delay window is not shared
between tooltips; if that matters, expose a shared provider. Checkbox/
radio items, labels, and keybinding hints are not wrapped yet.

Overlay content is portalled to `body` and inherits webview typography
from there; surface colors come from the `--ui-menu-*` and
`--ui-tooltip-*` tokens. High contrast follows the VS Code contrast
variables, and the styles handle `forced-colors` and
`prefers-reduced-motion`.

## Rules

The package is shaped for a future standalone NPM split. Keep it that way:

- No `workspace:*` runtime dependencies (no `@repo/shared`,
  `@repo/webview-shared`); ESLint rejects `@repo/*` imports and relative
  cross-package imports in this package.
- `react` stays a peer dependency; the Radix overlay primitives are the
  only other runtime dependencies.
- New entry points go in the `exports` map; consumers never deep-import
  `src/`.
- Shared internals are reached through `package.json` subpath imports
  (`#cx`, `#storybook`). These resolve only inside this package and ship
  with it, so they survive a standalone NPM split.
- New components define their VS Code mappings in `tokens.css`, not
  inline `--vscode-*` references.
