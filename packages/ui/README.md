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

`Tooltip`, `ContextMenu`, and `DropdownMenu` wrap the Radix primitives,
styled to match the native VS Code menu and hover widgets. Menus expose
Radix's compound parts as flat named exports (`DropdownMenuTrigger`,
`DropdownMenuItem`, …); `Tooltip` is a single component taking a `content`
prop, with a 500ms show delay matching VS Code's `workbench.hover.delay`
default.

Overlay content is portalled to `body`, inherits webview typography from
there, and shares the `.ui-overlay` base for stacking, border, shadow,
and scrolling. Menus fade in like native menus, gated on `data-state` so
an interrupted entry animation cannot delay unmounting. High contrast,
`forced-colors`, and `prefers-reduced-motion` are handled.

## Known gaps

Deliberate deferrals, fine to fix later.

Overlays:

- Menus only support plain action items; Radix's checkbox/radio items,
  group labels, and keybinding hints have no styled wrappers yet.
- Moving the pointer from one tooltip trigger straight to another replays
  the full 500ms delay, where native shows the next hover instantly. The
  fix is one shared `TooltipProvider` per app instead of one per
  `Tooltip`.
- Overlay shadows are darker than native in dark themes: menus in VS Code
  use `shadow-lg`, which webviews cannot read, so the closest available
  `widget.shadow` stands in.
- A very tall tooltip fills most of the viewport before it scrolls, where
  native hovers stop at half the window height.

Package-wide:

- There is no `Button`; the VS Code button style exists only inside the
  state panels, and secondary-button colors have no `--ui-*` tokens.
- Only the Empty and Error panels ship; a Loading panel would need the
  shared panel skeleton, which stays internal.
- The token layer maps what shipped components need: there are no
  list/selection-row, spacing, typography, or z-index tokens, and the
  `--ui-radius-*` tokens are only adopted by the overlays, with older
  controls hardcoding their radii.
- `--ui-background` assumes a sidebar webview; a webview hosted in an
  editor tab or panel renders on the sidebar color.
- `useVscodeTheme` reports the theme kind only; switching between two
  themes of the same kind does not notify subscribers.
- Under `prefers-reduced-motion` the indeterminate `ProgressBar` renders
  as a full bar and the `Spinner` as a static ring, with no other
  activity cue.
- Story helpers compile against root-hoisted Storybook packages; a
  standalone split needs its own Storybook devDependencies.

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
