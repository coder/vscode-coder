# Storybook

Stories render inside an environment that mirrors a real VS Code webview.

## Themes

`themes/generated/themes.json` holds the exact `--vscode-*` variables a real
VS Code instance injects per built-in theme, and `default-styles.css` is the
stylesheet VS Code injects into every webview. `preview.ts` applies both, plus
the `data-vscode-theme-kind` body attribute.

To refresh the snapshots after a VS Code release, bump `VSCODE_VERSION` in
`themes/sync.mjs` and run:

```sh
xvfb-run -a pnpm sync:vscode-themes
```

The script launches the pinned VS Code via `@vscode/test-electron`, cycles
the four built-in themes, and dumps what each webview receives.

## Fonts

VS Code uses the host OS font, so the dumped `--vscode-font-family` resolves
per machine; rendering inside actual VS Code is always exact.
