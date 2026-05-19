# Coder Workspaces Webview Panel

This package contains the Workspaces webview panel for the Coder VS Code extension.

## Enabling the Feature

The workspaces panel is controlled by the `coder.experimental.workspacesPanel` configuration setting.

To enable via settings.json:

1. Open your VS Code settings.json (Cmd/Ctrl + Shift + P → "Preferences: Open User Settings (JSON)")
2. Add the following:

```json
{
	"coder.experimental.workspacesPanel": true
}
```

3. Reload VS Code

A new activity bar icon labeled **"Coder Remote (New)"** will appear when the setting is enabled.
