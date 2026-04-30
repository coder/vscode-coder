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

The extension provides several sidebar panels:

- **My Workspaces / All Workspaces** - tree views showing workspaces with status
  indicators, quick actions, and search.
- **Coder Tasks** - a React webview for creating, monitoring, and managing AI
  agent tasks with real-time log streaming.
- **Coder Chat** - an embedded chat UI for delegating tasks to AI coding agents
  (gated behind the `coder.agentsEnabled` context flag).

There are also notifications for outdated workspace templates and for workspaces
that are close to shutting down.

## Webviews

The extension ships rich UI panels as webviews built with Vite, organized as a
pnpm workspace in `packages/`. The canonical guide for building one covers
the IPC contract, exhaustiveness rules, the "no dropped events" guarantee,
and a new-panel checklist. It lives next to the code:

**[`packages/webview-shared/README.md`](packages/webview-shared/README.md)**

Existing webviews as references:

- `packages/tasks` + `src/webviews/tasks/`: React (uses `useIpc`).
- `packages/speedtest` + `src/webviews/speedtest/`: vanilla TS (uses
  `onNotification` / `sendCommand`).

### Development

```bash
pnpm watch  # Rebuild extension and webviews on changes
```

Press F5 to launch the Extension Development Host. Use "Developer: Reload
Webviews" to see webview changes.

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
pnpm test:extension  # Extension tests (runs in Electron)
pnpm test:webview    # Webview tests (runs in Electron with jsdom)
pnpm test            # Both extension and webview tests (CI mode)
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
| 1.106   | 37       | 22      | Minimum supported |
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

After running `pnpm update`, always run `pnpm dedupe` to consolidate duplicate
package versions across the workspace. Without this, workspace packages can
resolve to different versions of the same dependency, causing issues like broken
React context propagation when two copies of a library are loaded.

## Releasing

For both stable and pre-releases:

1. Check that the changelog lists all the important changes.
2. Update the package.json version and add a version heading to the changelog.

### Stable Release

1. Push a tag `v<version>` (e.g. `v1.15.0`) from the `main` branch. The release
   pipeline will only run for tags on `main`.
2. The pipeline builds, publishes to the VS Code Marketplace and Open VSX, and
   creates a draft GitHub release.
3. Update the draft release with the changelog contents and publish it.

### Pre-Release

1. Push a tag `v<version>-pre` (e.g. `v1.15.0-pre`) from any branch. The version
   in the tag must match package.json (the `-pre` suffix is stripped during
   validation). Pre-release tags are not restricted to `main`.
2. The pipeline builds with `--pre-release`, publishes to both marketplaces, and
   creates a draft pre-release on GitHub.
