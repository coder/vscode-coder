# Contributing

## Architecture

When the Coder Remote plugin handles a request to open a workspace, it invokes
Microsoft's [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh)
extension using the following URI structure:

```text
vscode://ssh-remote+<hostname><path>
```

The `ssh-remote` scheme is registered by Microsoft's Remote - SSH extension and
indicates that it should connect to the provided host name using SSH.

The host name takes the format
`coder-vscode.<domain>--<username>--<workspace>`. This is parsed by the CLI
(which is invoked via SSH's `ProxyCommand`) to route SSH to the right workspace.

The Coder Remote extension also registers for the
`onResolveRemoteAuthority:ssh-remote` [extension activation
event](https://code.visualstudio.com/api/references/activation-events) to hook
into this process, running before the Remote - SSH extension actually connects.

On activation of this event, we check if `vscode.workspace.workspaceFolders`
contains the `coder-vscode` prefix, and if so we delay activation to:

1. Parse the host name to get the domain, username, and workspace.
2. Ensure the workspace is running.
3. Download the matching server binary to the client.
4. Configure the binary with the URL and token, asking the user for them if they
   are missing. Each domain gets its own config directory.
5. Add an entry to the user's SSH config for `coder-vscode.<domain>--*`.

```text
Host coder-vscode.dev.coder.com--*
	ProxyCommand "/tmp/coder" --global-config "/home/kyle/.config/Code/User/globalStorage/coder.coder-remote/dev.coder.com" ssh --stdio --network-info-dir "/home/kyle/.config/Code/User/globalStorage/coder.coder-remote/net" --ssh-host-prefix coder-vscode.dev.coder.com-- %h
	ConnectTimeout 0
	StrictHostKeyChecking no
	UserKnownHostsFile /dev/null
	LogLevel ERROR
```

If any step fails, we show an error message. Once the error message is closed
we close the remote so the Remote - SSH connection does not continue to
connection. Otherwise, we yield, which lets the Remote - SSH continue.

VS Code SSH uses the `ssh -D <port>` flag to start a SOCKS server on the
specified port. This port is printed to the `Remote - SSH` log file in the VS
Code Output panel in the format `-> socksPort <port> ->`. We use this port to
find the SSH process ID that is being used by the remote session.

The `ssh` subcommand on the `coder` binary periodically flushes its network
information to `network-info-dir + "/" + process.ppid`. SSH executes
`ProxyCommand`, which means the `process.ppid` will always be the matching SSH
command.

Coder Remote periodically reads the `network-info-dir + "/" + matchingSSHPID`
file to display network information.

## Other features

There is a sidebar that shows all the user's workspaces, and all users'
workspaces if the user has the required permissions.

There are also notifications for an outdated workspace and for workspaces that
are close to shutting down.

## Webviews

The extension uses React-based webviews for rich UI panels, built with Vite and
organized as a pnpm workspace in `packages/`.

### Project Structure

```text
packages/
├── webview-shared/      # Shared types, React hooks, and Vite config
│   └── extension.d.ts   # Types exposed to extension (excludes React)
└── tasks/               # Example webview (copy this for new webviews)

src/webviews/
├── util.ts          # getWebviewHtml() helper
└── tasks/           # Extension-side provider for tasks panel
```

Key patterns:

- **Type sharing**: Extension imports types from `@repo/webview-shared` via path mapping
  to `extension.d.ts`. Webviews import directly from `@repo/webview-shared/react`.
- **Message passing**: Use `postMessage()`/`useMessage()` hooks for communication.
- **Lifecycle**: Dispose event listeners properly (see `TasksPanel.ts` for example).

### Development

```bash
pnpm watch:all  # Rebuild extension and webviews on changes
```

Press F5 to launch the Extension Development Host. Use "Developer: Reload Webviews"
to see webview changes.

### Adding a New Webview

1. Copy `packages/tasks` to `packages/<name>` and update the package name
2. Create a provider in `src/webviews/<name>/` (see `TasksPanel.ts` for reference)
3. Register the view in `package.json` under `contributes.views`
4. Register the provider in `src/extension.ts`

## Testing

There are a few ways you can test the "Open in VS Code" flow:

- Use the "VS Code Desktop" button from a Coder dashboard.
- Manually open the link with `Developer: Open URL` from inside VS Code.
- Use `code --open-url` on the command line.

The link format is `vscode://coder.coder-remote/open?${query}`. For example:

```bash
code --open-url 'vscode://coder.coder-remote/open?url=dev.coder.com&owner=my-username&workspace=my-ws&agent=my-agent'
```

### Unit Tests

The project uses Vitest with separate test configurations for extension and webview code:

```bash
pnpm test:extension  # Extension tests (runs in Electron with mocked VS Code APIs)
pnpm test:webview    # Webview tests (runs in jsdom)
pnpm test:all        # Both extension and webview tests
pnpm test:ci         # CI mode (same as test:all with CI=true)
```

Test files are organized by type:

```text
test/
├── unit/           # Extension unit tests
├── webview/        # Webview unit tests (jsdom environment)
├── integration/    # Integration tests (real VS Code)
└── mocks/          # Shared test mocks
```

### Integration Tests

Integration tests run inside a real VS Code instance:

```bash
pnpm test:integration
```

**Limitations:**

- Must use Mocha (VS Code test runner requirement), not Vitest
- Cannot run while another VS Code instance is open (they share state)
- Requires closing VS Code or running in a clean environment
- Test files in `test/integration/` are compiled to `out/` before running

## Development

> [!IMPORTANT]
> Reasoning about networking gets really wonky trying to develop
> this extension from a coder workspace. We currently recommend cloning the
> repo locally

1. Run `pnpm watch` in the background.
2. OPTIONAL: Compile the `coder` binary and place it in the equivalent of
   `os.tmpdir() + "/coder"`. If this is missing, it will download the binary
   from the Coder deployment, as it normally would. Reading from `/tmp/coder` is
   only done in development mode.

   On Linux or Mac:

   ```bash
   # Inside https://github.com/coder/coder
   $ go build -o /tmp/coder ./cmd/coder
   ```

3. Press `F5` or navigate to the "Run and Debug" tab of VS Code and click "Run
   Extension".
4. If your change is something users ought to be aware of, add an entry in the
   changelog.

## Node.js Version

This extension targets the Node.js version bundled with VS Code's Electron:

| VS Code | Electron | Node.js | Status            |
| ------- | -------- | ------- | ----------------- |
| 1.95    | 32       | 20      | Minimum supported |
| stable  | latest   | varies  | Also tested in CI |

When updating the minimum Node.js version, update these files:

- **package.json**: `engines.vscode`, `engines.node`, `@types/node`, `@tsconfig/nodeXX`
- **tsconfig.json**: `extends` (the `@tsconfig/nodeXX` package), `lib` (match base ESNext version)
- **esbuild.mjs**: `target`
- **.github/workflows/ci.yaml**: `electron-version` and `vscode-version` matrices

## Dependencies

Some dependencies are not directly used in the source but are required anyway.

- `bufferutil` and `utf-8-validate` are peer dependencies of `ws`.
- `ua-parser-js` and `dayjs` are used by the Coder API client.

The coder client is vendored from coder/coder. Every now and then, we should be running `pnpm update coder`
to make sure we're using up to date versions of the client.

## Releasing

1. Check that the changelog lists all the important changes.
2. Update the package.json version and add a version heading to the changelog.
3. Push a tag matching the new package.json version.
4. Update the resulting draft release with the changelog contents.
5. Publish the draft release.
6. Download the `.vsix` file from the release and upload to both the [official VS Code Extension Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), and the [open-source VSX Registry](https://open-vsx.org/).
