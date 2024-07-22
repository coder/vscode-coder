# Coder Remote

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version/coder.coder-remote.svg)](https://marketplace.visualstudio.com/items?itemName=coder.coder-remote)
[!["Join us on
Discord"](https://badgen.net/discord/online-members/coder)](https://coder.com/chat?utm_source=github.com/coder/vscode-coder&utm_medium=github&utm_campaign=readme.md)

The Coder Remote VS Code extension lets you open
[Coder](https://github.com/coder/coder) workspaces with a single click.

- Open workspaces from the dashboard in a single click.
- Automatically start workspaces when opened.
- No command-line or local dependencies required - just install VS Code!
- Works in air-gapped or restricted networks. Just connect to your Coder
  deployment!

![Demo](https://github.com/coder/vscode-coder/raw/main/demo.gif?raw=true)

## Getting Started

Launch VS Code Quick Open (Ctrl+P), paste the following command, and press
enter.

```text
ext install coder.coder-remote
```

Alternatively, manually install the VSIX from the
[latest release](https://github.com/coder/vscode-coder/releases/latest).

#### Variables Reference

Coder uses
${userHome} from VS Code's
[variables reference](https://code.visualstudio.com/docs/editor/variables-reference).
Use this when formatting paths in the Coder extension settings rather than ~ or
$HOME.

Example: ${userHome}/foo/bar.baz
