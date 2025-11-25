# Change Log

## Unreleased

### Fixed

- Fixed race condition when multiple VS Code windows download the Coder CLI binary simultaneously.
  Other windows now wait and display real-time progress instead of attempting concurrent downloads,
  preventing corruption and failures.

### Changed

- WebSocket connections now automatically reconnect on network failures, improving reliability when
  communicating with Coder deployments.

## [v1.11.4](https://github.com/coder/vscode-coder/releases/tag/v1.11.4) 2025-11-20

### Fixed

- Add support for `google.antigravity-remote-openssh` Remote SSH extension.

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

- Always enable verbose (`-v`) flag when a log directory is configured (`coder.proxyLogDir`).
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

- Coder extension sidebar now displays available app statuses, and let's
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
