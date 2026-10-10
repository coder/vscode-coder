# Architecture

How the extension opens workspaces and the internals worth knowing before
changing them. Where code lives is covered in
[CODE_STRUCTURE.md](CODE_STRUCTURE.md).

## Opening a workspace

When the Coder Remote plugin handles a request to open a workspace, it invokes
Microsoft's [Remote - SSH](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh)
extension using the following URI structure:

```text
vscode://ssh-remote+<hostname><path>
```

The `ssh-remote` scheme is registered by Microsoft's Remote - SSH extension and
indicates that it should connect to the provided host name using SSH.

The host name takes the format
`coder-<editor>.<domain>--<username>--<workspace>`, where `<editor>` comes from
that product's URI scheme, such as `vscode`, `cursor`, or `devin`/`windsurf`. The CLI is
invoked through SSH's `ProxyCommand` with this prefix so it can route SSH to the
right workspace. A legacy `coder-vscode` authority opened in another editor is
reopened once with that editor's prefix; legacy recent-folder entries remain
compatible when opening the same workspace.

The Coder Remote extension also registers for the
`onResolveRemoteAuthority:ssh-remote` [extension activation
event](https://code.visualstudio.com/api/references/activation-events) to hook
into this process, running before the Remote - SSH extension actually connects.

On activation of this event, we check whether the remote authority belongs to
the current editor, and if so we delay activation to:

1. Parse the host name to get the domain, username, and workspace.
2. Ensure the workspace is running.
3. Download the matching server binary to the client.
4. Configure the binary with the URL and token, asking the user for them if they
   are missing. Each domain gets its own config directory.
5. Write an entry for `coder-<editor>.<domain>--*` to a per-editor,
   per-deployment file in a data directory shared by every editor, such as
   `~/.local/share/coder.coder-remote/ssh/cursor--dev.coder.com.conf`.
6. Keep a shared `Include` block at the top of the user's SSH config that
   globs the whole directory. Every editor writes the identical block, so
   concurrent writers converge on the same content. The `CODER INCLUDE <id>`
   marker convention lets other Coder integrations recognize the block, since
   Coder-managed includes route disjoint hosts and are order-independent.

```text
# --- START CODER INCLUDE CODER-REMOTE ---
# Managed by the Coder extension for VS Code and its forks.
# Moves back to the top on connect; override options via coder.sshConfig.
Include "~/.local/share/coder.coder-remote/ssh/*.conf"
# --- END CODER INCLUDE CODER-REMOTE ---
```

Each generated file contains only its own editor's host entries for one
deployment, with keys sorted. The extension rewrites the whole file on every
connection:

```text
# Coder workspace hosts. Do not edit; the Coder extension rewrites this file
# on every connection. Override options with the "coder.sshConfig" setting.

Host coder-cursor.dev.coder.com--*
  ConnectTimeout 0
  LogLevel ERROR
  ProxyCommand /tmp/coder --global-config /home/kyle/.config/Cursor/User/globalStorage/coder.coder-remote/dev.coder.com ssh --stdio --usage-app=cursor --network-info-dir /home/kyle/.config/Cursor/User/globalStorage/coder.coder-remote/net --ssh-host-prefix coder-cursor.dev.coder.com-- %h
  ServerAliveCountMax 3
  ServerAliveInterval 10
  SetEnv CODER_SSH_SESSION_TYPE=cursor
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
```

Options merge from three sources, highest priority first: the
`coder.sshConfig` setting, `--ssh-option` flags from a `coder config-ssh`
block, and the deployment's SSH config. Only the deployment's options are
deny-listed (`DENIED_DEPLOYMENT_KEYS` in `src/remote/sshConfig.ts`), since the
other two are the user's own. `SetEnv` is written only when the local ssh
supports it, and `--usage-app` only when both the CLI and the deployment
accept custom session app names; otherwise the session reports as `vscode`.
CLIs without wildcard host support get a `coder vscodessh` ProxyCommand
instead.

Which main file gains the include depends on the Remote - SSH extension.
Microsoft's and Cursor's pass `remote.SSH.configFile` to ssh with `-F`, and
VSCodium's parses the file itself instead of running ssh, so all three connect
through it. Antigravity and Windsurf/Devin renamed the setting but spawn ssh
without `-F`, so ssh reads `~/.ssh/config` regardless; we ignore the renamed
setting there rather than add the include where the connection never looks.

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

### Windows SSH config permissions

Windows files inherit their permissions from the directory they live in, so a
config the extension generates under `%APPDATA%\coder.coder-remote\ssh` can end
up readable by other accounts. OpenSSH rejects such a file with "Bad owner or
permissions" and skips the whole `Include`, which blocks every Coder host, not
just the one it came from.

Before each managed write, `src/remote/windowsAcl.ts` locks the directory down
and lets its files inherit from it:

| Step                                                     | Command                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| Read the current user's SID                              | `whoami.exe /user /fo csv /nh`                       |
| Clear the directory's own grants                         | `icacls.exe <dir> /reset`                            |
| Grant that user, SYSTEM, and Administrators full control | `icacls.exe <dir> /inheritance:r /grant:r <trustee>` |
| Clear each `*.conf` file so it inherits the directory    | `icacls.exe <file> /reset`                           |

Resetting every `*.conf` file, not only the one being written, also repairs
files left behind by other deployments and editors.

Worth knowing:

- Like VS Code, the code checks exit codes but never reads ACLs back. It needs
  no script, native module, ownership change, or elevation, and it leaves the
  user's own SSH config alone.
- Links and non-files are rejected before the repair, because inheritable
  grants reach children even without `/T`. That stops mistakes, not an attacker
  racing the check.
- The repair is not atomic: a failure after `/reset` can leave the directory
  with its parent's grants.

`windowsAcl.native.test.ts` drives the real `icacls.exe`, `whoami.exe`, and
OpenSSH. Run it unelevated as well as in CI to catch privilege assumptions.

## Other features

The extension provides several sidebar panels:

- **My Workspaces / All Workspaces** - tree views showing workspaces with status
  indicators, quick actions, and search.
- **Coder Tasks** - a React webview for creating, monitoring, and managing AI
  agent tasks with real-time log streaming.

There are also notifications for outdated workspace templates and for workspaces
that are close to shutting down.

## Logging

The extension logs to the "Coder" output channel, a `LogOutputChannel` that gates
messages by the level chosen in its gear menu. To help Support diagnose
connection failures without asking users to reproduce with debug logging enabled,
a `FlightRecorder` ([`src/logging/flightRecorder.ts`](../src/logging/flightRecorder.ts))
wraps the channel and keeps a bounded, in-memory ring of the entries that sit
**below** the current level, which the channel would otherwise drop.

When a WebSocket fails terminally, a remote session closes after a failed or
canceled open, or you collect a support bundle, the extension replays the ring
into the channel. The first physical line of each replayed entry carries a
`[buffered]` marker with its original timestamp and level, and any continuation
lines carry the bare marker.
Capture is best-effort: the channel writes on its own schedule, so a bundle may
miss the most recent lines, but a later failure flush still replays them.
Transient reconnects and intentional teardown never flush, and neither does a
handshake `401` (a 401 explains itself, and with OAuth a refresh reconnects the
same socket). Nothing is recorded or flushed while the channel is at `Off`.

The buffer size is set by `coder.connectionLogBuffer.size` (number of entries;
`0` disables it) and lives in memory, so a hard kill or out-of-memory event
loses it. Extension SSH debug logs that pass through the shared logger are
buffered; the CLI `ProxyCommand` file logs under `coder.proxyLogDirectory` are
not, since support bundles already collect them from disk.
