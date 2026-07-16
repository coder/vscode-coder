# Change Log

<!-- When cutting a stable release, consolidate all pre-release entries into a
     single release section and remove them. The "Unreleased" header is omitted
     from published versions since it shows up in the VS Code extension changelog
     tab and is confusing to users. Add it back between releases if needed. -->

## Unreleased

### Added

- Show active deployment announcements in a megaphone status bar item, with a
  popup for announcements you haven't seen yet (respecting
  `coder.disableNotifications`; suppressed announcements highlight the status
  bar item instead). A new **Coder: View Announcements** command opens the full
  messages in a markdown preview.

### Changed

- Filter the Shared Workspaces view with the server-side `shared_with_user`
  query instead of filtering `shared:true` results on the client, so fewer
  workspaces are fetched and the view loads faster. Deployments too old to
  support the new filter now show a message explaining why instead of an
  empty list.

### Fixed

- Apply a 60-second default timeout to REST requests, so requests hung on a
  half-open TCP connection don't stall pollers forever.
- Change `coder.binarySource`, `coder.binaryDestination`, `coder.headerCommand`,
  `coder.tlsCertFile`, `coder.tlsKeyFile`, `coder.tlsCaFile`, `coder.tlsAltHost`,
  `coder.tlsCertRefreshCommand`, `coder.proxyLogDirectory`, `coder.proxyBypass`,
  `coder.sshConfig`, `coder.sshFlags`, and `coder.globalFlags` from `machine`
  to `application` scope (still `ignoreSync`, unchanged from before). This
  keeps workspace/folder `settings.json` from overriding them (the original
  SEC-200 goal) while fixing #1032, where a `machine`-scoped value could
  revert to its default in a remote window.

## [v1.15.2](https://github.com/coder/vscode-coder/releases/tag/v1.15.2) 2026-06-30

> **Breaking:** API requests now respect `http.proxySupport: off`. Previously
> the extension applied VS Code's proxy settings (`http.proxy`, `http.noProxy`,
> `coder.proxyBypass`) to API requests even when `http.proxySupport` was `off`.
> Now `off` ignores those settings and only proxy environment variables are
> used. If you set those settings and relied on them while proxy support was
> `off`, either set `http.proxySupport` to `on` to keep using them, or move the
> values into the `HTTP_PROXY`/`HTTPS_PROXY` (from `http.proxy`) and `NO_PROXY`
> (from `http.noProxy`/`coder.proxyBypass`) environment variables.

### Fixed

- Honor `http.proxySupport: off` when deriving proxy settings for SSH and API
  connections, so VS Code's proxy settings are ignored while inherited proxy
  environment variables still apply.

## [v1.15.1](https://github.com/coder/vscode-coder/releases/tag/v1.15.1) 2026-06-26

### Added

- New **Coder: Network Check** command to run
  [`coder netcheck`](https://coder.com/docs/reference/cli/netcheck) from the
  command palette or the My Workspaces view menu. The report opens in a panel
  with an overall health banner, any warnings, a connectivity summary (UDP,
  IPv4/IPv6, NAT mapping, hairpinning, port mapping), per-region DERP/STUN
  results with latencies, and local interfaces. A View JSON action exposes the
  raw output. When a slow connection is detected, the network status bar
  tooltip also links to the network check alongside the latency test, for a
  deployment-wide view of the network path.
- Share login with the terminal `coder` CLI by setting `--global-config=<dir>`
  in `coder.globalFlags`; the extension reads file-based CLI credentials from
  that directory (requires a deployment on 2.31.0+).

### Changed

- File-based credentials are now written and cleared through `coder login` and
  `coder logout` rather than by the extension directly. The minimum supported
  Coder version is now v0.25.0.

- Workspace opens and `coder://` URI handling now log more diagnostics (target
  workspace, agent, and handoff) to make failed opens easier to trace. URI
  parameter values, including tokens, are never logged.

### Fixed

- Propagate VS Code's proxy settings (`http.proxy`, `http.noProxy`, and
  `coder.proxyBypass`) to the SSH environment as `HTTP_PROXY`/`HTTPS_PROXY`/
  `NO_PROXY`, so the `coder ssh` ProxyCommand connects through the configured
  proxy whether SSH runs as a child process or in a terminal.

## [v1.15.0](https://github.com/coder/vscode-coder/releases/tag/v1.15.0) 2026-06-12

### Added

- New **Shared Workspaces** view in the Coder sidebar that lists workspaces
  other users have shared with you, with search and refresh actions, so you
  can find and open them just like your own.
- New `coder.alternativeWebUrl` setting to open browser pages (dashboard,
  workspace pages, login) on a different URL than the one used for API, SSH,
  and CLI traffic. Useful when the API runs on a browser-restricted port
  (e.g. 7004) but the web UI is served on a standard one (e.g. 443).
- Local extension telemetry to help diagnose issues. Events are recorded on
  this machine only and never sent anywhere; payloads are bounded and never
  include raw workspace names, paths, queries, or command output. Configure
  via the new `coder.telemetry.level` setting (`local` by default, `off` to
  disable); see `coder.telemetry.local` for tunables. Every event, property,
  and measurement is documented in
  [EVENTS.md](https://github.com/coder/vscode-coder/blob/main/src/instrumentation/EVENTS.md).
  Coverage:
  - **Activation and commands**: extension activation phases and every
    `coder.*` command invocation, with durations and outcomes.
  - **Auth and deployment**: login/logout, token refresh, credential
    store/clear, recovery prompts, and session suspend/recover events.
  - **CLI**: binary resolution, download and signature verification, and
    SSH configuration, with durations and typed failure categories.
  - **Remote setup**: each phase of connecting to a workspace, from auth
    retrieval and workspace lookup through workspace and agent readiness,
    SSH config write, and connection handoff.
  - **Connections**: SSH process discovery/loss/recovery with sampled
    network stats, and reconnecting WebSocket open/drop/reconnect state
    transitions.
  - **Workspaces and HTTP**: workspace and agent state transitions with
    observed durations, start/update/open flows, and per-route
    `http.requests` rollups for HTTP health without one event per request.
- The new **Coder: Export Telemetry** command writes locally recorded
  telemetry for a selected date range to a file you choose, as a JSON array
  or an OTLP/JSON zip ready for OpenTelemetry tooling. The OTLP zip includes
  a `manifest.json` summarizing the export: date range, source file and
  event counts, per-signal record counts, and the telemetry schema version.
- **Coder: Create Support Bundle** now captures VS Code-side diagnostics in
  the bundle: a snapshot of `coder.*` and `remote.*` settings (values that
  can hold secrets are masked), recent extension and SSH proxy logs across
  sessions, and the local telemetry files, so a single bundle is usually
  enough to diagnose an issue.
- Path-like settings (`coder.binaryDestination`, `coder.tlsCertFile`,
  `coder.tlsKeyFile`, `coder.tlsCaFile`, `coder.tlsAltHost`,
  `coder.proxyLogDirectory`) and items in `coder.globalFlags` now support
  `${env:VAR}`, `${userHome}`, and a leading `~`. For `--flag=value` items
  in `coder.globalFlags`, the expansion applies to the value half, so
  `--cfg=~/coder` works.

### Changed

- The Coder CLI is now spawned directly instead of through a shell, so
  arguments reach the binary as-is. The extension no longer has to
  shell-escape values by hand. That escaping was error-prone (especially
  around `cmd.exe` on Windows) and a recurring command-injection risk
  when deployment-supplied values like workspace names or template
  parameters contained spaces, quotes, or shell metacharacters.

### Fixed

- Updating a workspace from VS Code no longer hangs when the new template
  version requires parameters. The extension now prompts for any missing
  required values through VS Code input boxes and passes them to
  `coder update` so the CLI runs non-interactively. If the CLI still asks
  for input, the update fails fast and the workspace falls back to starting
  on its existing template version with a warning, instead of stalling
  indefinitely.
- Updating a workspace on a CLI older than 2.24 (which can't run
  `coder update` non-interactively) now passes newly-required template
  parameters into the REST API fallback build, instead of silently omitting
  them and letting the server reject the build.
- Updating a workspace now re-prompts for an option or multi-select
  parameter whose stored value is no longer offered by the new template
  version, instead of carrying the stale value forward and failing the
  build. Immutable parameters without a stored value are prompted as well,
  matching the web dashboard's behavior.
- Workspaces on hostnames containing `--`, such as internationalized (IDN)
  domains with Punycode (`xn--`) labels, can now be opened from recent
  connections. The SSH authority parser previously split these names at the
  wrong separator and rejected the host as invalid.

## [v1.14.6](https://github.com/coder/vscode-coder/releases/tag/v1.14.6) 2026-05-26

### Changed

- Minimum supported VS Code lowered to 1.105 for Cursor compatibility.

### Removed

- The "Coder Chat (Experimental)" secondary sidebar and its `agents`
  experiment gate. Deeplinks that still include `chatId` continue to open
  the workspace; the parameter is now silently ignored.

### Fixed

- Sessions suspended by an mTLS or `coder.headerCommand` failure now
  auto-recover once the setting is corrected; a 401 from a mid-flight
  settings change is retried silently with the new settings and fresh
  headers instead of escalating to an interactive prompt.
- Logout, deployment switch, or dispose during an in-flight auth verify
  is no longer overwritten when the verify finishes, and no longer
  leaves stale deployment data in storage.
- Cross-window login keeps listening when the first token observed from
  another window is invalid, so a follow-up valid write still resolves
  the dialog.
- Config-change side-effects (reload prompt, recovery, reconnects) fire
  once after edits settle instead of on every event in a burst.

### Security

- Hardened the configuration scope of security-sensitive settings so that a
  malicious `.vscode/settings.json` cannot override them (SEC-200). Workspace
  and folder values are now ignored by VS Code for these settings. This closes
  a path where a workspace could redirect command execution
  (`coder.headerCommand`, `coder.tlsCertRefreshCommand`), substitute the CLI
  binary or its source (`coder.binarySource`, `coder.binaryDestination`,
  `coder.disableSignatureVerification`, `coder.enableDownloads`), inject
  CLI/SSH flags (`coder.globalFlags`, `coder.sshFlags`), swap TLS material or
  disable TLS verification (`coder.tlsCertFile`, `coder.tlsKeyFile`,
  `coder.tlsCaFile`, `coder.tlsAltHost`, `coder.insecure`), or override
  identity, networking, and credential storage (`coder.defaultUrl`,
  `coder.autologin`, `coder.useKeyring`, `coder.proxyBypass`,
  `coder.proxyLogDirectory`).
- Path-, command-, and network-dependent settings use `"scope": "machine"`
  (per-machine, not synced via Settings Sync), while user-wide preferences
  (`coder.defaultUrl`, `coder.autologin`, `coder.useKeyring`, `coder.insecure`,
  `coder.disableSignatureVerification`, `coder.enableDownloads`) use
  `"scope": "application"`, which preserves Settings Sync across your
  machines while still blocking workspace overrides. This follows VS Code's
  [recommended scope semantics](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration).

## [v1.14.5](https://github.com/coder/vscode-coder/releases/tag/v1.14.5) 2026-04-30

### Added

- `coder.binaryDestination` now accepts a full file path (e.g. `/usr/bin/coder`) in addition
  to a directory. The extension checks the binary's version against the server and downloads a
  replacement when needed. When set to a directory, the simple name (`coder` / `coder.exe`) is
  tried as a fallback after the platform-specific name, so package-manager-installed CLIs work
  without symlinking.
- New **Coder: Speed Test Workspace** command to run
  [`coder speedtest`](https://coder.com/docs/reference/cli/speedtest) from the command palette or
  workspace sidebar. Choose a running workspace, optionally set the test duration, and view results
  in an interactive throughput chart with hover tooltips, a summary header, and a real-time progress
  bar while the CLI runs. A View JSON action exposes the raw output.
- New **Coder: Ping Workspace** command to run
  [`coder ping`](https://coder.com/docs/reference/cli/ping) from the command palette or workspace
  sidebar, with live connectivity diagnostics in a terminal.
- New **Coder: Create Support Bundle** command to run
  [`coder support bundle`](https://coder.com/docs/reference/cli/support_bundle) from VS Code and
  save the resulting diagnostics zip for troubleshooting. The bundle also includes VS Code-side
  logs (Remote SSH extension, SSH proxy, and extension output channels) for easier debugging.
  Available when your deployment supports support bundles.
- Coder SSH connections now default to `ServerAliveInterval=10` and `ServerAliveCountMax=3`,
  helping keep sessions alive through NATs and firewalls while detecting dead connections within
  about 30 seconds.
- New `coder.networkThreshold.latencyMs` setting (default: 250ms, set to `0` to disable) to warn
  when workspace latency stays high. The network status bar indicator turns yellow and offers quick
  actions to run **Coder: Ping Workspace** or open the setting.
- Opening a workspace that's already connected in another VS Code window now shows a prompt
  to **Duplicate Window** (preserving tabs and panels) or **Open Without Folder**, instead of
  just focusing the existing window with no way to open a second view of the same workspace.

### Fixed

- Cleanup of old/temp files in shared directories like `/usr/bin` is now scoped to the binary's
  own basename, preventing accidental removal of unrelated files.
- The **Coder: Update Workspace** flow now goes through the normal startup path for more reliable
  updates and restarts, and reconnecting to a stopped outdated workspace now offers **Start** or
  **Update and Start**.
- Outdated workspace notifications are now deferred until setup completes, so they no longer appear
  during an in-progress update.
- Workspace build logs now reliably appear in the **Coder: Workspace Build** output channel during
  startup.
- The **Coder: Workspace Build** output channel is no longer created when reconnecting to an
  already-running workspace, so the Output panel doesn't pop open empty.
- **Speed Test**, **Ping**, **Create Support Bundle**, and the app status terminal now refresh
  the stored credential file (or keyring on supported systems) before each invocation, so they
  no longer fail with a stale token after the session has been refreshed since the workspace was
  first opened. mTLS deployments continue to work with an empty token.
- Cancelling a long-running CLI command no longer surfaces as a misleading CLI failure.

## [v1.14.3](https://github.com/coder/vscode-coder/releases/tag/v1.14.3) 2026-03-30

### Added

- Coder Chat panel: delegate development tasks to AI coding agents directly from VS Code's
  sidebar. Describe a task and the agent handles workspace provisioning and execution
  automatically. Requires [Coder Agents](https://coder.com/docs/ai-coder/agents) (Early
  Access) to be enabled on your deployment.
- New `coder.disableNotifications` setting to suppress all notification prompts from the
  Coder deployment, including workspace update reminders and scheduling alerts.
- Automatically set `reconnectionGraceTime`, `serverShutdownTimeout`, and `maxReconnectionAttempts`
  on first connection to prevent disconnects during overnight workspace sleep.
- New **Coder: Apply Recommended SSH Settings** command to overwrite all recommended SSH settings at once.
- Proxy log directory now defaults to the extension's global storage when `coder.proxyLogDirectory`
  is not set, so SSH connection logs are always captured without manual configuration. Also respects
  the `CODER_SSH_LOG_DIR` environment variable as a fallback.
- SSH options from `coder config-ssh --ssh-option` are now applied to VS Code connections,
  with priority order: VS Code setting > `coder config-ssh` options > deployment config.
- Re-introduced OS keyring support for session tokens (reverted in v1.13.2), now delegating
  to the Coder CLI instead of native `@napi-rs/keyring` binaries. This keeps the credential
  format in sync with the CLI automatically.

### Fixed

- URI handler no longer falls back to the agent's `expanded_directory` when the `folder`
  query parameter is absent. An absent `folder` now opens a bare remote window, restoring
  pre-v1.10.0 behavior.
- Fixed SSH connections failing when a custom `RemoteCommand` is configured in SSH config.
- SSH connections now recover faster after laptop sleep/wake by detecting port changes
  and re-registering the label formatter.
- SSH process discovery now uses `ss` -> `netstat` -> `lsof` on Linux
  and `netstat` -> `lsof` on macOS, fixing systems where `netstat` was unavailable
  and the SSH PID could not be resolved, which broke network info display and log viewing.
- Fixed SSH config writes failing on Windows when antivirus, cloud sync software,
  or another process briefly locks the file.
- Fixed Tasks view container not showing in Cursor when not authenticated.
- `--use-keyring` and `--global-config` are now explicitly filtered from user-configured
  global CLI flags to prevent conflicts with the extension's auth mode.

### Changed

- **Breaking**: Minimum VS Code version is now 1.106.0.
- `coder.useKeyring` is now opt-in (default: false). Keyring storage requires CLI >= 2.29.0 for
  storage and logout sync, and >= 2.31.0 for syncing login from CLI to VS Code.
- Session tokens are now saved to the OS keyring at login time (when enabled and CLI >= 2.29.0),
  not only when connecting to a workspace.

## [v1.13.2](https://github.com/coder/vscode-coder/releases/tag/v1.13.2) 2026-03-05

### Fixed

- Removed OS Keyring behavior changes

## [v1.13.1](https://github.com/coder/vscode-coder/releases/tag/v1.13.1) 2026-03-04

### Added

- Session tokens are now stored in the OS keyring (Keychain on macOS, Credential Manager on
  Windows) instead of plaintext files, when using CLI >= 2.29.0. Falls back to file storage on
  Linux, older CLIs, or if the keyring write fails. Controlled via the `coder.useKeyring` setting.

### Fixed

- Fixed CLI binary downloads failing when servers or proxies compress responses unexpectedly.
- Clarified CLI download progress notification wording.

## [v1.13.0](https://github.com/coder/vscode-coder/releases/tag/v1.13.0) 2026-03-03

### Added

- Tasks panel: a new sidebar panel to create, view, and manage AI tasks directly from VS Code.
  Includes a task list with status indicators, a detail view with chat-style log streaming and
  real-time workspace build logs, and the ability to send messages or pause the agent without
  leaving the editor.
- New "Switch Deployment" command to change deployments without clearing credentials.
- New "Manage Credentials" command to view and remove stored credentials for individual deployments.

### Changed

- Logout now clears stored credentials for the current deployment.
- The workspace update confirmation button now reads "Update and Restart" to clarify that updating
  will restart the workspace.

## [v1.12.2](https://github.com/coder/vscode-coder/releases/tag/v1.12.2) 2026-01-27

### Added

- Support for VS Code's built-in proxy settings: `http.noProxy` (as fallback when `coder.proxyBypass`
  is not set), `http.proxyAuthorization`, and `http.proxyStrictSSL`.

### Fixed

- Fixed proxy scheme handling where URLs with schemes got duplicated and URLs without schemes
  were not normalized.

### Changed

- WebSocket connections are now more robust and reconnect less frequently, only when truly
  necessary, reducing unnecessary disconnections and improving stability.

## [v1.12.1](https://github.com/coder/vscode-coder/releases/tag/v1.12.1) 2026-01-23

### Fixed

- Fixed GPG signature verification failing when public keys have been reformatted.
- Fixed race conditions when multiple VS Code windows access deployments simultaneously.

### Changed

- Refined logging with clearer messages and more accurate severity levels for easier troubleshooting.

## [v1.12.0](https://github.com/coder/vscode-coder/releases/tag/v1.12.0) 2026-01-21

### Added

- Automatic TLS client certificate refresh via new `coder.tlsCertRefreshCommand` setting. Detects
  certificate errors (expired, revoked, etc.) and automatically refreshes and retries.
- OAuth 2.1 authentication support (experimental): Enable via `coder.experimental.oauth` setting.
  When connecting to an OAuth-enabled Coder deployment, you can choose between OAuth (with automatic
  token refresh) or legacy session tokens. OAuth tokens refresh automatically in the background,
  eliminating manual re-authentication.
- Multi-deployment support: The extension now remembers credentials for multiple Coder deployments.
  When you log into a different deployment, existing credentials are preserved and automatically
  restored if you log back in. Credentials sync automatically across VS Code windows.
- WebSocket connections now automatically reconnect when proxy, TLS, or header settings change
  (`coder.headerCommand`, `coder.insecure`, `coder.tlsCertFile`, `coder.tlsKeyFile`, `coder.tlsCaFile`,
  `coder.tlsAltHost`, `http.proxy`, `coder.proxyBypass`).

### Fixed

- Fixed `SetEnv` SSH config parsing and accumulation with user-defined values.
- Improved WebSocket error handling for more consistent behavior across connection failures.
- Commands now correctly appear/hide in the command palette based on login state and remote connection.
- Opening a workspace via URI (`vscode://coder.coder-remote/open?...`) now properly prompts for login
  when credentials are missing.
- Network info files are now automatically cleaned up, and the SSH process is re-detected after
  repeated failures to read network info.
- Proxy log files are now automatically cleaned up when the count exceeds 20 and the oldest files
  are more than 7 days old.

### Changed

- **Breaking**: Minimum VS Code version is now 1.95.0.

## [v1.11.6](https://github.com/coder/vscode-coder/releases/tag/v1.11.6) 2025-12-15

### Added

- Log file picker when viewing logs without an active workspace connection.

### Fixed

- Fixed false "setting changed" notifications appearing when connecting to a remote workspace.

## [v1.11.5](https://github.com/coder/vscode-coder/releases/tag/v1.11.5) 2025-12-10

### Added

- Support for paths that begin with a tilde (`~`).
- Support for `coder ssh` flag configurations through the `coder.sshFlags` setting.

### Fixed

- Fixed race condition when multiple VS Code windows download the Coder CLI binary simultaneously.
  Other windows now wait and display real-time progress instead of attempting concurrent downloads,
  preventing corruption and failures.
- Remove duplicate "Cancel" buttons on the workspace update dialog.

### Changed

- WebSocket connections now automatically reconnect on network failures, improving reliability when
  communicating with Coder deployments.
- Improved SSH process and log file discovery with better reconnect handling and support for
  VS Code forks (Cursor, Windsurf, Antigravity).

## [v1.11.4](https://github.com/coder/vscode-coder/releases/tag/v1.11.4) 2025-11-20

### Added

- Support for the `google.antigravity-remote-openssh` Remote SSH extension.

### Changed

- Improved workspace connection progress messages and enhanced the workspace build terminal
  with better log streaming. The extension now also waits for blocking startup scripts to
  complete before connecting, providing clear progress indicators during the wait.

## [v1.11.3](https://github.com/coder/vscode-coder/releases/tag/v1.11.3) 2025-10-22

### Fixed

- Fixed WebSocket connections not receiving headers from the configured header command
  (`coder.headerCommand`), which could cause authentication failures with remote workspaces.

## [v1.11.2](https://github.com/coder/vscode-coder/releases/tag/v1.11.2) 2025-10-07

### Changed

- Updated Visual Studio Marketplace badge in README to use img.shields.io service instead of vsmarketplacebadges.

## [v1.11.1](https://github.com/coder/vscode-coder/releases/tag/v1.11.1) 2025-10-07

### Fixed

- Logging in or out in one VS Code window now properly updates the authentication status in all other open windows.
- Fix an issue with JSON stringification errors occurring when logging circular objects.
- Fix resource cleanup issues that could leave lingering components after extension deactivation.

### Added

- Support for `CODER_BINARY_DESTINATION` environment variable to set CLI download location (overridden by extension setting `coder.binaryDestination` if configured).
- Search filter button to Coder Workspaces tree views for easier workspace discovery.

## [v1.11.0](https://github.com/coder/vscode-coder/releases/tag/v1.11.0) 2025-09-24

### Changed

- Always enable verbose (`-v`) flag when a log directory is configured (`coder.proxyLogDirectory`).
- Automatically start a workspace without prompting if it is explicitly opened but not running.

### Added

- Add support for CLI global flag configurations through the `coder.globalFlags` setting.
- Add logging for all REST traffic. Verbosity is configurable via `coder.httpClientLogLevel` (`none`, `basic`, `headers`, `body`).
- Add lifecycle logs for WebSocket creation, errors, and closures.
- Include UUIDs in REST and WebSocket logs to correlate events and measure duration.

## [1.10.1](https://github.com/coder/vscode-coder/releases/tag/v1.10.1) 2025-08-13

### Fixed

- The signature download fallback now uses only major.minor.patch without any
  extra labels (like the hash), since the releases server does not include those
  labels with its artifacts.

## [v1.10.0](https://github.com/coder/vscode-coder/releases/tag/v1.10.0) 2025-08-05

### Changed

- Coder output panel enhancements: all log entries now include timestamps, and
  you can filter messages by log level in the panel.

### Added

- Update `/openDevContainer` to support all dev container features when hostPath
  and configFile are provided.
- Add `coder.disableUpdateNotifications` setting to disable workspace template
  update notifications.
- Consistently use the same session for each agent. Previously, depending on how
  you connected, it could be possible to get two different sessions for an
  agent. Existing connections may still have this problem; only new connections
  are fixed.
- Add an agent metadata monitor status bar item, so you can view your active
  agent metadata at a glance.
- Add binary signature verification. This can be disabled with
  `coder.disableSignatureVerification` if you purposefully run a binary that is
  not signed by Coder (for example a binary you built yourself).

## [v1.9.2](https://github.com/coder/vscode-coder/releases/tag/v1.9.2) 2025-06-25

### Fixed

- Use `--header-command` properly when starting a workspace.

- Handle `agent` parameter when opening workspace.

### Changed

- The Coder logo has been updated.

## [v1.9.1](https://github.com/coder/vscode-coder/releases/tag/v1.9.1) 2025-05-27

### Fixed

- Missing or otherwise malformed `START CODER VSCODE` / `END CODER VSCODE`
  blocks in `${HOME}/.ssh/config` will now result in an error when attempting to
  update the file. These will need to be manually fixed before proceeding.
- Multiple open instances of the extension could potentially clobber writes to
  `~/.ssh/config`. Updates to this file are now atomic.
- Add support for `anysphere.remote-ssh` Remote SSH extension.

## [v1.9.0](https://github.com/coder/vscode-coder/releases/tag/v1.9.0) 2025-05-15

### Fixed

- The connection indicator will now show for VS Code on Windows, Windsurf, and
  when using the `jeanp413.open-remote-ssh` extension.

### Changed

- The connection indicator now shows if connecting through Coder Desktop.

## [v1.8.0](https://github.com/coder/vscode-coder/releases/tag/v1.8.0) (2025-04-22)

### Added

- Coder extension sidebar now displays available app statuses, and lets
  the user click them to drop into a session with a running AI Agent.

## [v1.7.1](https://github.com/coder/vscode-coder/releases/tag/v1.7.1) (2025-04-14)

### Fixed

- Fix bug where we were leaking SSE connections

## [v1.7.0](https://github.com/coder/vscode-coder/releases/tag/v1.7.0) (2025-04-03)

### Added

- Add new `/openDevContainer` path, similar to the `/open` path, except this
  allows connecting to a dev container inside a workspace. For now, the dev
  container must already be running for this to work.

### Fixed

- When not using token authentication, avoid setting `undefined` for the token
  header, as Node will throw an error when headers are undefined. Now, we will
  not set any header at all.

## [v1.6.0](https://github.com/coder/vscode-coder/releases/tag/v1.6.0) (2025-04-01)

### Added

- Add support for Coder inbox.

## [v1.5.0](https://github.com/coder/vscode-coder/releases/tag/v1.5.0) (2025-03-20)

### Fixed

- Fixed regression where autostart needed to be disabled.

### Changed

- Make the MS Remote SSH extension part of an extension pack rather than a hard dependency, to enable
  using the plugin in other VSCode likes (cursor, windsurf, etc.)

## [v1.4.2](https://github.com/coder/vscode-coder/releases/tag/v1.4.2) (2025-03-07)

### Fixed

- Remove agent singleton so that client TLS certificates are reloaded on every API request.
- Use Axios client to receive event stream so TLS settings are properly applied.
- Set `usage-app=vscode` on `coder ssh` to fix deployment session counting.
- Fix version comparison logic for checking wildcard support in "coder ssh"

## [v1.4.1](https://github.com/coder/vscode-coder/releases/tag/v1.4.1) (2025-02-19)

### Fixed

- Recreate REST client in spots where confirmStart may have waited indefinitely.

## [v1.4.0](https://github.com/coder/vscode-coder/releases/tag/v1.4.0) (2025-02-04)

### Fixed

- Recreate REST client after starting a workspace to ensure fresh TLS certificates.

### Changed

- Use `coder ssh` subcommand in place of `coder vscodessh`.

## [v1.3.10](https://github.com/coder/vscode-coder/releases/tag/v1.3.10) (2025-01-17)

### Fixed

- Fix bug where checking for overridden properties incorrectly converted host name pattern to regular expression.

## [v1.3.9](https://github.com/coder/vscode-coder/releases/tag/v1.3.9) (2024-12-12)

### Fixed

- Only show a login failure dialog for explicit logins (and not autologins).

## [v1.3.8](https://github.com/coder/vscode-coder/releases/tag/v1.3.8) (2024-12-06)

### Changed

- When starting a workspace, shell out to the Coder binary instead of making an
  API call. This reduces drift between what the plugin does and the CLI does. As
  part of this, the `session_token` file was renamed to `session` since that is
  what the CLI expects.

## [v1.3.7](https://github.com/coder/vscode-coder/releases/tag/v1.3.7) (2024-11-04)

### Added

- New setting `coder.tlsAltHost` to configure an alternative hostname to use for
  TLS verification. This is useful when the hostname in the certificate does not
  match the hostname used to connect.

## [v1.3.6](https://github.com/coder/vscode-coder/releases/tag/v1.3.6) (2024-11-04)

### Added

- Default URL setting that takes precedence over CODER_URL.
- Autologin setting that automatically initiates login when the extension
  activates using either the default URL or CODER_URL.

### Changed

- When a client certificate and/or key is configured, skip token authentication.

## [v1.3.5](https://github.com/coder/vscode-coder/releases/tag/v1.3.5) (2024-10-16)

### Fixed

- Error messages from the workspace watch endpoint were not logged correctly.
- Delay notifying about workspaces shutting down since the connection might bump
  the activity, making the notification misleading.

## [v1.3.4](https://github.com/coder/vscode-coder/releases/tag/v1.3.4) (2024-10-14)

### Fixed

- The "All Workspaces" view was not being populated due to visibility check.

### Added

- Log workspaces queries when running with `--log=debug`.
- Coder output logs will now have the date prefixed to each line.

## [v1.3.3](https://github.com/coder/vscode-coder/releases/tag/v1.3.3) (2024-10-14)

### Fixed

- The plugin no longer immediately starts polling workspaces when connecting to
  a remote. It will only do this when the Coder sidebar is open.

### Changed

- Instead of monitoring all workspaces for impending autostops and deletions,
  the plugin now only monitors the connected workspace.

## [v1.3.2](https://github.com/coder/vscode-coder/releases/tag/v1.3.2) (2024-09-10)

### Fixed

- Previously, if a workspace stopped or restarted causing the "Start" dialog to
  appear in VS Code, the start button would fire a start workspace request
  regardless of the workspace status.
  Now we perform a check to see if the workspace is still stopped or failed. If
  its status has changed out from under the IDE, it will not fire a redundant
  start request.
- Fix a conflict with HTTP proxies and the library we use to make HTTP
  requests. If you were getting 400 errors or similar from your proxy, please
  try again.

### Changed

- Previously, the extension would always log SSH proxy diagnostics to a fixed
  directory. Now this must be explicitly enabled by configuring a new setting
  `coder.proxyLogDirectory`. If you are having connectivity issues, please
  configure this setting and gather the logs before submitting an issue.

## [v1.3.1](https://github.com/coder/vscode-coder/releases/tag/v1.3.1) (2024-07-15)

### Fixed

- Avoid deleting the existing token when launching with a link that omits the
  token.

## [v1.3.0](https://github.com/coder/vscode-coder/releases/tag/v1.3.0) (2024-07-01)

### Added

- If there are multiple agents, the plugin will now ask which to use.

### Fixed

- If the workspace is stopping as the plugin tries to connect, it will wait for
  the stop and then try to start the workspace. Previously it would only start
  the workspace if it happened to be in a fully stopped state when connecting.
- Whenever the plugin wants to start a workspace, it will ask the user first to
  prevent constantly keeping a workspace up and defeating the point of
  auto-stop.

## [v1.2.1](https://github.com/coder/vscode-coder/releases/tag/v1.2.1) (2024-06-25)

### Fixed

- Fix the update dialog continually reappearing.

## [v1.2.0](https://github.com/coder/vscode-coder/releases/tag/v1.2.0) (2024-06-21)

### Added

- New setting `coder.proxyBypass` which is the equivalent of `no_proxy`. This
  only takes effect if `http.proxySupport` is `on` or `off`, otherwise VS Code
  overrides the HTTP agent the plugin sets.

## [v1.1.0](https://github.com/coder/vscode-coder/releases/tag/v1.1.0) (2024-06-17)

### Added

- Workspace and agent statuses now show in the sidebar. These are updated every
  five seconds.
- Support `http.proxy` setting and proxy environment variables. These only take
  effect if `http.proxySupport` is `on` or `off`, otherwise VS Code overrides
  the HTTP agent the plugin sets.

## [v1.0.2](https://github.com/coder/vscode-coder/releases/tag/v1.0.2) (2024-06-12)

### Fixed

- Redirects will now be followed when watching a workspace build, like when a
  workspace is automatically started.

## [v1.0.1](https://github.com/coder/vscode-coder/releases/tag/v1.0.1) (2024-06-07)

### Changed

- Improve an error message for when watching a build fails.

## [v1.0.0](https://github.com/coder/vscode-coder/releases/tag/v1.0.0) (2024-06-05)

### Added

- Support opening workspaces that belong to a different deployment than the one
  which is currently logged in. This will only work for new connections. If you
  have an existing connection that errors when connecting because of this,
  please connect it again using the plugin or the Coder dashboard. Optionally,
  you may also want to delete your old workspaces from the recents list.

### Fixed

- Escape variables in the header command. If you have a variable in the header
  command itself, like `echo TEST=$CODER_URL`, it will now work as expected
  instead of being substituted with a blank or erroneous value.

## [v0.1.37](https://github.com/coder/vscode-coder/releases/tag/v0.1.37) (2024-05-24)

### Added

- openRecent query parameter to open the most recent workspace or directory for
  that remote.
- Setting to disable downloading the binary. When disabled, the existing binary
  will be used as-is. If the binary is missing, the plugin will error.

### Fixed

- Increased timeout will apply to reconnects as well.

### Changed

- Show certificate errors under the token input.

## [v0.1.36](https://github.com/coder/vscode-coder/releases/tag/v0.1.36) (2024-04-09)

### Changed

- Automatically update a workspace if required by the template.
- Show more information when remote setup fails.

### Fixed

- Abort remote connection when remote setup fails.

## [v0.1.35](https://github.com/coder/vscode-coder/releases/tag/v0.1.35) (2024-03-12)

### Changed

- Support running within Cursor.

## [v0.1.34](https://github.com/coder/vscode-coder/releases/tag/v0.1.34) (2024-03-03)

### Changed

- Improve fetching the Coder binary. This is mostly just better logging but it
  also will avoid fetching if the existing binary version already matches, to
  support scenarios where the ETag is ignored.

## [v0.1.33](https://github.com/coder/vscode-coder/releases/tag/v0.1.33) (2024-02-20)

### Fixed

- Prevent updating template when automatically starting workspace.
