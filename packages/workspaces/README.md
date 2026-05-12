# Coder Experimental Workspaces Webview Panel

This package contains the experimental Workspaces webview panel for the Coder VS Code extension.

This feature is currently in development and hidden from the Settings UI.

## Enabling the Feature

The workspaces panel is controlled by the `coder.experimental.workspacesPanel` configuration setting.

**This setting is hidden from the Settings UI** - it can only be enabled via settings.json:

1. Open your VS Code settings.json (Cmd/Ctrl + Shift + P → "Preferences: Open User Settings (JSON)")
2. Add the following:

```json
{
	"coder.experimental.workspacesPanel": true
}
```

3. Reload VS Code

A new activity bar icon labeled **"Coder Remote (New)"** will appear in the activity bar when the setting is enabled. This creates a completely separate panel alongside the existing "Coder Remote" and "Coder Tasks" panels, allowing easy side-by-side comparison during development.

> [!NOTE]
> The new view will only appear after you instantiate the Coder context (i.e clicking Tasks or Workspaces).
