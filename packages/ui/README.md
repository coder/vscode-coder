# @repo/ui

Generic component library for VS Code webviews. No workspace or task
knowledge — that lives in the consuming packages (`@repo/workspaces`,
`@repo/tasks`).

## Theming

`tokens.css` defines semantic `--ui-*` custom properties mapped to the
`--vscode-*` variables VS Code injects into every webview. Components
style against the semantic tokens only, so the VS Code mapping (including
high contrast) is adjusted in one place. Import it once per webview entry
point:

```ts
import "@repo/ui/tokens.css";
```

`useVscodeTheme()` returns the active theme kind (`dark`, `light`,
`high-contrast`, `high-contrast-light`) and re-renders on theme changes.

`codicon.css` re-exports the codicon font and classes.

## Rules

The package is shaped for a future standalone NPM split. Keep it that way:

- No `workspace:*` runtime dependencies (no `@repo/shared`,
  `@repo/webview-shared`).
- `react` stays a peer dependency.
- New entry points go in the `exports` map; consumers never deep-import
  `src/`.
- New components define their VS Code mappings in `tokens.css`, not
  inline `--vscode-*` references.
