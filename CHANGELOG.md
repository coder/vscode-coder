# Change Log

## Unreleased

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
