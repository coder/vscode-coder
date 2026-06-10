# Coder Remote

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version/coder.coder-remote.svg)](https://marketplace.visualstudio.com/items?itemName=coder.coder-remote)
[![Open VSX Version](https://img.shields.io/open-vsx/v/coder/coder-remote)](https://open-vsx.org/extension/coder/coder-remote)
[!["Join us on
Discord"](https://badgen.net/discord/online-members/coder)](https://coder.com/chat?utm_source=github.com/coder/vscode-coder&utm_medium=github&utm_campaign=readme.md)

The Coder Remote extension connects your editor to
[Coder](https://github.com/coder/coder) workspaces with a single click.

![Demo](https://github.com/coder/vscode-coder/raw/main/demo.gif?raw=true)

## Features

- **One-click workspace access** - open workspaces from the Coder dashboard or
  the editor sidebar. Workspaces start automatically when opened.
- **Multi-editor support** - works with VS Code, Cursor, Windsurf, and other
  VS Code forks.
- **Workspace sidebar** - browse, search, and create workspaces. View agent
  metadata and app statuses at a glance.
- **Coder Tasks** - create, monitor, and manage AI agent tasks directly from
  the sidebar with real-time log streaming.
- **Multi-deployment support** - connect to multiple Coder deployments and
  switch between them without losing credentials.
- **Dev container support** - open dev containers running inside workspaces.
- **Secure authentication** - session tokens stored in the OS keyring
  (macOS/Windows), with optional OAuth 2.1 support.
- **Air-gapped / restricted networks** - no external dependencies beyond your
  Coder deployment.
- **Automatic SSH tuning** - applies recommended SSH settings for reliable
  long-lived connections and recovers from sleep/wake.

> [!NOTE]
> The extension builds on VS Code-provided implementations of SSH. Make sure you
> have the correct SSH extension installed for your editor
> (`ms-vscode-remote.remote-ssh`, `anysphere.remote-ssh` for Cursor, or
> `codeium.windsurf-remote-openssh` for Windsurf).

## Getting Started

Launch VS Code Quick Open (Ctrl+P), paste the following command, and press
enter.

```shell
ext install coder.coder-remote
```

Alternatively, manually install the VSIX from the
[latest release](https://github.com/coder/vscode-coder/releases/latest).

All extension settings are under the `coder.*` namespace in the Settings UI.
Paths in settings accept `~` and `${userHome}` from VS Code's
[variables reference](https://code.visualstudio.com/docs/editor/variables-reference).

## URI Handler

The extension registers a URI handler that can open workspaces from outside
the editor, such as links on the Coder dashboard. The scheme matches the
editor (`vscode://`, `cursor://`, `windsurf://`, etc.), followed by the
extension ID and a path:

```text
vscode://coder.coder-remote/open?owner=alice&workspace=dev&agent=main&folder=/home/coder/project
```

### `/open`

Opens a workspace, starting it first if needed.

| Parameter    | Required | Description                                                                                                |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `owner`      | Yes      | Username of the workspace owner.                                                                           |
| `workspace`  | Yes      | Name of the workspace.                                                                                     |
| `agent`      | No       | Agent _name_ (not ID). If omitted or unmatched in a multi-agent workspace, a picker is shown.              |
| `folder`     | No       | Absolute path inside the workspace to open.                                                                |
| `openRecent` | No       | Open the most recently used folder for this workspace. True when present without a value or set to `true`. |
| `url`        | No       | Coder deployment URL. If omitted, the extension prompts for it (pre-filled with the current deployment).   |
| `token`      | No       | Session token for authentication. If omitted, the existing session is used or a login flow is started.     |

### `/openDevContainer`

Opens a dev container running inside a workspace.

| Parameter              | Required | Description                                                                    |
| ---------------------- | -------- | ------------------------------------------------------------------------------ |
| `owner`                | Yes      | Username of the workspace owner.                                               |
| `workspace`            | Yes      | Name of the workspace.                                                         |
| `agent`                | Yes      | Agent name the dev container runs on.                                          |
| `devContainerName`     | Yes      | Name of the dev container.                                                     |
| `devContainerFolder`   | Yes      | Folder to open inside the dev container.                                       |
| `localWorkspaceFolder` | No       | Local path of the dev container project. Required if `localConfigFile` is set. |
| `localConfigFile`      | No       | Local path to the `devcontainer.json` file.                                    |
| `url`, `token`         | No       | Same as `/open`.                                                               |
