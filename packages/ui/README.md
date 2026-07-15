# @repo/ui

Generic React components for VS Code webviews. The package is currently
source-consumed by this monorepo; it does not ship a `dist` build yet.

Its stable separation boundary is the public root exports, no monorepo runtime
imports, and component CSS using only semantic `--ui-*` tokens. A future package
build can emit those same entry points without API changes.

## CSS

Import the semantic token mapping and codicon assets once in each real webview
entry point:

```ts
import "@repo/ui/tokens.css";
import "@repo/ui/codicon.css";
```

`tokens.css` is the only layer that references VS Code's injected
`--vscode-*` variables. Components reference `--ui-*` tokens only.

Component CSS is inherit-first: typography and text color come from the
webview (`font: inherit`), and controls center content with a fixed height
plus the shared `.ui-control` flex base in `components/control.css`.
Line-height and vertical padding math drift off-center with font metrics,
so components avoid them.

Every component forwards `className` and `style` to its root element, and
default rules use single-class specificity, so a consumer class imported
after the library overrides any default (width, height, spacing).

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
from there. Both surfaces share the `.ui-overlay` base in
`components/overlay.css` for stacking, shadow, and scrolling; surface
colors come from the `--ui-menu-*` and `--ui-tooltip-*` tokens, and
corner radii from the generic `--ui-radius-*` tokens. Menus fade in like
native menus do, gated on `data-state` so an interrupted entry animation
cannot delay unmounting; tooltips appear instantly like the native hover
widget. High contrast follows the VS Code contrast variables, and the
styles handle `forced-colors` and `prefers-reduced-motion`.

## Codicons

`CodiconName` is derived directly from the installed
`@vscode/codicons/dist/metadata.json` keys. TypeScript validates icon names
without a generated source file or a runtime list in the public API.

## Isolation

ESLint rejects `@repo/*` imports and relative cross-package imports in
`packages/ui` TypeScript and TSX source. `react` remains a peer dependency;
the only runtime dependencies are the Radix overlay primitives and
`@vscode/codicons`. Public consumers import from the package root or its
declared CSS exports.

Shared internals are reached through `package.json` subpath imports (`#cx`,
`#codicons`, `#storybook`). These resolve only inside this package and ship
with it, so they survive a standalone NPM split.
