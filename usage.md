# Usage

## How to share extensions with code-server

When you install extensions remotely with VSCode, they are stored on the machine
here:

```shell
~/.vscode-server/extensions
```

If you're using code-server and want to use those same extensions, you can use
the `--extensions-dir` flag like so:

```shell
code-server --extensions-dir ~/.vscode-server/extensions
```
