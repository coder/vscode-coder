# Coder Remote

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/coder.coder-remote?label=Visual%20Studio%20Marketplace&color=%233fba11)](https://marketplace.visualstudio.com/items?itemName=coder.coder-remote)
[![Open VSX Version](https://img.shields.io/open-vsx/v/coder/coder-remote)](https://open-vsx.org/extension/coder/coder-remote)
[!["Join us on
Discord"](https://badgen.net/discord/online-members/coder)](https://coder.com/chat?utm_source=github.com/coder/vscode-coder&utm_medium=github&utm_campaign=readme.md)

The Coder Remote extension lets you open [Coder](https://github.com/coder/coder)
workspaces with a single click.

- Open workspaces from the dashboard in a single click.
- Automatically start workspaces when opened.
- No command-line or local dependencies required - just install your editor!
- Works in air-gapped or restricted networks. Just connect to your Coder
  deployment!
- Supports multiple editors: VS Code, Cursor, and Windsurf.

> [!NOTE]
> The extension builds on VS Code-provided implementations of SSH. Make
> sure you have the correct SSH extension installed for your editor
> (`ms-vscode-remote.remote-ssh` or `codeium.windsurf-remote-openssh` for Windsurf).

![Demo](https://github.com/coder/vscode-coder/raw/main/demo.gif?raw=true)

## Getting Started

Launch VS Code Quick Open (Ctrl+P), paste the following command, and press
enter.

```shell
ext install coder.coder-remote
```

Alternatively, manually install the VSIX from the
[latest release](https://github.com/coder/vscode-coder/releases/latest).

### Variables Reference

Coder uses `${userHome}` from VS Code's
[variables reference](https://code.visualstudio.com/docs/editor/variables-reference).
Use this when formatting paths in the Coder extension settings rather than `~`
or `$HOME`.

Example: ${userHome}/foo/bar.baz
