# Telemetry events

Every event, property, and measurement the extension emits. Conventions for
adding new ones live in `CONVENTIONS.md`.

## Event index

| Category                                        | Events                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Activation](#activation)                       | `activation`, `activation.deployment_init`                                                                                                                                                                                                                              |
| [Auth](#auth)                                   | `auth.login`, `auth.logout`, `auth.login_prompted`, `auth.token_refresh.completed`, `auth.token_refresh.deduped`, `auth.unauthorized_intercepted`, `auth.session_lookup`, `auth.credential.store`, `auth.credential.clear`                                              |
| [CLI](#cli)                                     | `cli.resolve`, `cli.download`, `cli.configure`                                                                                                                                                                                                                          |
| [Commands](#commands)                           | `command.invoked`, `command.diagnostic.completed`                                                                                                                                                                                                                       |
| [Deployment](#deployment)                       | `deployment.suspended`, `deployment.recovered`, `deployment.cross_window.detected`, `deployment.auth_config.recovery_failed`                                                                                                                                            |
| [Remote setup](#remote-setup)                   | `remote.setup`                                                                                                                                                                                                                                                          |
| [SSH](#ssh)                                     | `ssh.process.discovered`, `ssh.process.lost`, `ssh.process.recovered`, `ssh.process.replaced`, `ssh.process.disposed`, `ssh.network.sampled`                                                                                                                            |
| [HTTP](#http)                                   | `http.requests`                                                                                                                                                                                                                                                         |
| [WebSocket connections](#websocket-connections) | `connection.state_transitioned`, `connection.opened`, `connection.dropped`, `connection.reconnect_resolved`                                                                                                                                                             |
| [Workspace](#workspace)                         | `workspace.state_transitioned`, `workspace.agent.state_transitioned`, `workspace.start.triggered`, `workspace.start.prompted`, `workspace.update.triggered`, `workspace.update.prompted`, `workspace.open`, `workspace.picker.prompted`, `workspace.dev_container.open` |

Signal kinds:

- **span**: a traced operation; the framework adds `result`
  (`success` / `aborted` / `error`) and `durationMs`.
- **phase**: a child span, named `parent.child`; same framework attributes.
- **log**: a point-in-time event with no `result` / `durationMs`. Logs emitted
  under a span carry its `trace_id` / `parent_event_id`.
- **metric**: a log the OTLP exporter converts to metric data points instead
  of a log record.

## Attributes on every event

Framework-managed envelope fields (wire keys, JSONL):

| Field             | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| `event_id`        | Unique per event (OTel span id, 16 hex)                      |
| `event_name`      | The event names below                                        |
| `timestamp`       | ISO 8601 emission time                                       |
| `event_sequence`  | Monotonic per-session counter                                |
| `schema_version`  | Wire format version (currently 1)                            |
| `trace_id`        | Spans and their child events only (OTel trace id, 32 hex)    |
| `parent_event_id` | Phases and span logs only; the parent span's `event_id`      |
| `error`           | `{ message, type?, code? }`, only when an error was captured |

Session context, stamped on every event under `context`:

| Field                                  | Source                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `extension_version`                    | package.json version                                                      |
| `machine_id`                           | `vscode.env.machineId`                                                    |
| `session_id`                           | Generated per session                                                     |
| `os_type` / `os_version` / `host_arch` | `process.platform` (windows normalized) / `os.release()` / `process.arch` |
| `platform_name` / `platform_version`   | `vscode.env.appName` / `vscode.version`                                   |
| `deployment_url`                       | Set once known via `setDeploymentUrl`                                     |

On OTLP export the context becomes resource attributes (`service.name:
coder-vscode-extension`, `service.version`, `service.instance.id`, `host.id`,
`host.arch`, `os.type`, `os.version`, `vscode.platform.name`,
`vscode.platform.version`, `coder.deployment.url`) plus per-record provenance
(`coder.event.extension_version`, `coder.event.session_id`,
`coder.event.deployment_url`).

## Reading the tables

Every event below has its own heading, marked with its signal kind, and an
attribute table. Attributes are properties (string dimensions; numbers and
booleans are stringified) unless marked **(M)** for measurement, a raw number.
Measurements carry their unit in the key suffix (`_ms`, `_seconds`, `_mbits`,
`_bytes`) and `<entity>.count` keys are counts, so the tables do not repeat
units. Notes about when an attribute is set, or where its value comes from,
follow the values in parentheses.

Two attributes follow the same rule on every span, so the tables do not repeat
it:

- `error.type`: a typed error category, present only on spans that ended in
  `result: error`.
- `abort_stage`: where the user backed out, present only on aborted spans.
  Aborts never set `error.type`; an abort with no recorded stage or reason
  carries just `result: aborted`.

## Activation

Emitted by `ActivationTelemetry`.

### `activation` (span)

| Attribute    | Values                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `auth_state` | `none`, `stored`, `valid_token`, `auth_failed`, `unknown` (starts `none`, updated as activation learns more) |

### `activation.deployment_init` (span)

A sibling of `activation` rather than a child, because deployment init
outlives the activation span.

| Attribute    | Values                                                              |
| ------------ | ------------------------------------------------------------------- |
| `auth_state` | `unknown`, then `valid_token` or `auth_failed` from the init result |

## Auth

Emitted by `AuthTelemetry` and `CredentialTelemetry`.

### `auth.login` (span)

| Attribute    | Values                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `source`     | `auto_login`, `command`, `switch_deployment`, `uri`                                                           |
| `method`     | `mtls`, `provided_token`, `stored_token`, `keyring_token`, `cli_token`, `oauth`, `unknown` (starts `unknown`) |
| `reason`     | `user_dismissed`, `no_url_provided` (aborted logins only)                                                     |
| `error.type` | `auth_failed`, `exception`                                                                                    |

### `auth.logout` (span)

| Attribute    | Values                                     |
| ------------ | ------------------------------------------ |
| `reason`     | `not_authenticated` (aborted logouts only) |
| `error.type` | `exception`                                |

### `auth.login_prompted` (span)

| Attribute    | Values                                            |
| ------------ | ------------------------------------------------- |
| `trigger`    | `auth_required`, `missing_session`                |
| `reason`     | `user_dismissed`, `no_url_provided` (aborts only) |
| `error.type` | `auth_failed`                                     |

### `auth.token_refresh.completed` (span) / `auth.token_refresh.deduped` (log)

`deduped` is logged when a refresh call joins an in-flight refresh and emits
no span of its own.

| Attribute | Values                                    |
| --------- | ----------------------------------------- |
| `trigger` | `background`, `reactive` (on both events) |

### `auth.unauthorized_intercepted` (span)

Wraps the auth-recovery path triggered by a 401. Child log
`auth.unauthorized_intercepted.received` (no attributes) marks the 401 arrival.

| Attribute           | Values                                                      |
| ------------------- | ----------------------------------------------------------- |
| `recovery`          | `refresh_success`, `login_required`, `none` (starts `none`) |
| `refresh_attempted` | `true`, `false` (starts `false`)                            |

### `auth.session_lookup` (span)

Secret-storage session read during remote setup. No custom attributes.

### `auth.credential.store` / `auth.credential.clear` (spans)

| Attribute         | Values                                            |
| ----------------- | ------------------------------------------------- |
| `keyring_enabled` | `true`, `false` (from settings)                   |
| `category`        | `keyring`, `file` (the storage actually involved) |
| `error.type`      | `binary`, `cli`, `file`                           |

## CLI

Emitted by `CliTelemetry`; attributes set from `CliManager`.

### `cli.resolve` (span)

Resolving a usable CLI binary (cache, download, or fallback).

| Attribute         | Values                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `outcome`         | `cache_hit`, `downloaded`, `lock_wait_cache_hit`, `download_disabled_fallback`, `fallback_to_existing_binary` |
| `cache_source`    | `file_path`, `directory`, `not_found` (mirrored from the `cache_lookup` phase)                                |
| `version_check`   | `missing`, `match`, `mismatch`, `unreadable` (mirrored from the `version_check` phase)                        |
| `download_reason` | `missing`, `version_mismatch`, `unreadable` (set when a download is considered)                               |
| `download_action` | `download`, `fallback`, `blocked` (the decision taken)                                                        |
| `fallback_reason` | `downloads_disabled`, `download`, `fallback_declined` (why fallback ran, even if it succeeded)                |
| `error.type`      | `downloads_disabled`, `download`, `fallback_declined`, `unknown`                                              |

Phases: `cli.resolve.cache_lookup` (`source`, same values as `cache_source`),
`cli.resolve.version_check` (`outcome`), `cli.resolve.lock_wait` (`waited`:
boolean), `cli.resolve.lock_wait_recheck` (`outcome`),
`cli.resolve.fallback_to_existing_binary` (`error.type` if the fallback also
fails).

### `cli.download` (span)

| Attribute              | Values                                        |
| ---------------------- | --------------------------------------------- |
| `reason`               | `missing`, `version_mismatch`, `unreadable`   |
| `downloaded_bytes` (M) | omitted when nothing was written (e.g. a 304) |

Phase `cli.download.verify` covers binary signature verification:

| Attribute    | Values                                  |
| ------------ | --------------------------------------- |
| `outcome`    | `verified`, `bypassed`, `sig_not_found` |
| `sig_status` | HTTP status (only with `sig_not_found`) |

### `cli.configure` (span)

| Attribute           | Values                                      |
| ------------------- | ------------------------------------------- |
| `silent`            | `true`, `false`                             |
| `credential_source` | `session_token`, `empty_token`              |
| `abort_stage`       | `credential_store`                          |
| `error.type`        | `filesystem`, `credential_store`, `unknown` |

## Commands

### `command.invoked` (span)

Emitted by `CommandManager` around every registered `coder.*` command.

| Attribute    | Values                 |
| ------------ | ---------------------- |
| `command_id` | a `coder.*` command id |

### `command.diagnostic.completed` (span)

Emitted by `DiagnosticTelemetry` around each diagnostic command.

| Attribute                        | Values                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| `command`                        | `speed_test`, `support_bundle`, `export_telemetry`               |
| `abort_stage`                    | `workspace_picker`, `input`, `prompt`, `save_dialog`, `progress` |
| `error.type`                     | `fetch_error`, `parse_error`, `unsupported_cli`, `error`         |
| `format`                         | `json`, `otlp` (telemetry export only)                           |
| `requested_duration_seconds` (M) | speed test only                                                  |
| `interval.count` (M)             | speed test only                                                  |
| `throughput_mbits` (M)           | speed test only                                                  |
| `event.count` (M)                | telemetry export only                                            |

## Deployment

Emitted by `DeploymentTelemetry`.

### `deployment.suspended` (log)

| Attribute | Values                                                                |
| --------- | --------------------------------------------------------------------- |
| `reason`  | `auth_config_change`, `auth_failure`, `credentials_removed`, `logout` |

### `deployment.recovered` (log)

| Attribute | Values                                        |
| --------- | --------------------------------------------- |
| `trigger` | `auth_config`, `cross_window`, `token_update` |

### `deployment.cross_window.detected` / `deployment.auth_config.recovery_failed` (logs)

No attributes.

## Remote setup

### `remote.setup` (span)

Emitted by `RemoteSetupTelemetry` around connecting to a remote workspace.

| Attribute | Values                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `outcome` | `workspace_not_found`, `incompatible_server` (non-throwing early exits; the span is aborted) |

Phases (`remote.setup.<name>`): `cli_resolve`, `cli_configure`,
`compatibility_check`, `workspace_lookup`, `workspace_monitor_setup`,
`workspace_ready`, `agent_resolve`, `ssh_config_write`, `ssh_monitor_setup`,
`connection_handoff`.

## SSH

Emitted by `SshTelemetry`.

### `ssh.process.discovered` (span)

| Attribute      | Values                                    |
| -------------- | ----------------------------------------- |
| `found`        | `true`, `false` (whether a PID was found) |
| `attempts` (M) | discovery attempts                        |

### `ssh.process.lost` (log)

| Attribute       | Values                                       |
| --------------- | -------------------------------------------- |
| `cause`         | `stale_network_info`, `missing_network_info` |
| `uptime_ms` (M) | since process start                          |

### `ssh.process.recovered` (log)

| Attribute                  | Values     |
| -------------------------- | ---------- |
| `recovery_duration_ms` (M) | since loss |

### `ssh.process.replaced` (log)

| Attribute                | Values                 |
| ------------------------ | ---------------------- |
| `was_lost`               | `true`, `false`        |
| `previous_uptime_ms` (M) | prior process lifetime |
| `lost_duration_ms` (M)   | only when `was_lost`   |

### `ssh.process.disposed` (log)

| Attribute       | Values              |
| --------------- | ------------------- |
| `was_lost`      | `true`, `false`     |
| `uptime_ms` (M) | since process start |

### `ssh.network.sampled` (metric)

Tunnel network sample. Emitted on a p2p flip, a preferred-DERP change, a
meaningful latency change (at least 25 ms or 20 %), or a roughly 60 s
heartbeat.

| Attribute            | Values                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `p2p`                | `true`, `false`                                                    |
| `preferred_derp`     | DERP region name                                                   |
| `latency_ms` (M)     | exports as gauge `ssh.network.sampled.latency` with unit `ms`      |
| `download_mbits` (M) | exports as gauge `ssh.network.sampled.download` with unit `Mbit/s` |
| `upload_mbits` (M)   | exports as gauge `ssh.network.sampled.upload` with unit `Mbit/s`   |

## HTTP

### `http.requests` (metric)

Emitted by `HttpRequestsTelemetry`, which lives with the HTTP logging in
`src/logging`. A per-minute rollup of REST traffic, one event per method and
route bucket.

| Attribute                                                   | Values                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `method`                                                    | HTTP method                                                         |
| `route`                                                     | normalized route (ids replaced by placeholders)                     |
| `window_seconds` (M)                                        | actual window length                                                |
| `count.1xx` through `count.5xx`, `count.network_error` (M)  | export as cumulative counters with unit `{request}`                 |
| `duration.p50_ms`, `duration.p95_ms`, `duration.p99_ms` (M) | export as gauges (`http.requests.duration.p50` etc.) with unit `ms` |

## WebSocket connections

Emitted by `WebSocketTelemetry`.

These events share one value set, **ConnectionStateReason**: `initial_connect`,
`manual_reconnect`, `certificate_refresh`, `scheduled_reconnect`, `open`,
`disconnect`, `dispose`, `unrecoverable_close`, `unrecoverable_http`,
`certificate_error`, `connection_error`, `normal_close`, `unexpected_close`.

### `connection.state_transitioned` (log)

| Attribute    | Values                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `from`, `to` | `idle`, `connecting`, `connected`, `awaiting_retry`, `disconnected`, `disposed` (the `ReconnectingWebSocket` states) |
| `reason`     | ConnectionStateReason                                                                                                |

### `connection.opened` (log)

| Attribute                 | Values             |
| ------------------------- | ------------------ |
| `route`                   | normalized route   |
| `connect_duration_ms` (M) | from connect start |

### `connection.dropped` (log)

Emitted as an error log (with the `error` block) when a socket error caused
the drop.

| Attribute                    | Values                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `cause`                      | `manual_disconnect`, `replaced`, `unrecoverable_close`, `normal_close`, `unexpected_close`, `disposed`, `error` |
| `close_code`                 | WebSocket close code (when known)                                                                               |
| `connection_duration_ms` (M) | time the connection was open                                                                                    |

### `connection.reconnect_resolved` (log)

Closes a reconnect cycle (opened on the first drop, resolved on reconnect
success or termination).

| Attribute               | Values                                                 |
| ----------------------- | ------------------------------------------------------ |
| `outcome`               | `success`, `error` (how the cycle resolved)            |
| `reason`                | ConnectionStateReason (why the cycle started)          |
| `termination_reason`    | ConnectionStateReason (only when `outcome` is `error`) |
| `attempts` (M)          | connect attempts in the cycle                          |
| `max_backoff_ms` (M)    | largest backoff scheduled                              |
| `total_duration_ms` (M) | cycle wall time                                        |

## Workspace

Emitted by `WorkspaceStateTelemetry`, `WorkspaceAgentTelemetry`,
`WorkspaceOperationTelemetry`, and `WorkspaceOpenTelemetry`. `WorkspaceStatus`,
`WorkspaceAgentStatus`, and `WorkspaceAgentLifecycle` are the server-defined
unions from the Coder API.

### `workspace.state_transitioned` (log)

| Attribute                        | Values                                                   |
| -------------------------------- | -------------------------------------------------------- |
| `workspace_name`                 | deliberately tracked here, omitted on command events     |
| `from`, `to`                     | WorkspaceStatus (`from` is `none` on first observation)  |
| `build.transition`               | `start`, `stop`, `delete`                                |
| `build.reason`                   | build reason from the server                             |
| `observed_duration_ms` (M)       | time in the previous state; omitted on first observation |
| `observed_build_duration_ms` (M) | only when a provisioner run resolves                     |

### `workspace.agent.state_transitioned` (log)

| Attribute                                    | Values                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| `workspace_name`, `agent_name`               | names                                                |
| `status.from`, `status.to`                   | WorkspaceAgentStatus (`from` is `none` initially)    |
| `lifecycle_state.from`, `lifecycle_state.to` | WorkspaceAgentLifecycle (`from` is `none` initially) |
| `observed_duration_ms` (M)                   | omitted on first observation                         |

### `workspace.start.triggered` / `workspace.update.triggered` (spans)

| Attribute        | Values |
| ---------------- | ------ |
| `workspace_name` | name   |

### `workspace.start.prompted` (span)

| Attribute        | Values                                                      |
| ---------------- | ----------------------------------------------------------- |
| `workspace_name` | name                                                        |
| `update_offered` | `true`, `false` (whether the workspace was outdated)        |
| `action`         | `start`, `update` (aborted with no `action` when dismissed) |

### `workspace.update.prompted` (span)

| Attribute        | Values                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `prompt`         | `parameters`, `confirmation`                                             |
| `workspace_name` | name                                                                     |
| `action`         | `update` (set when the confirmation is accepted; aborted when dismissed) |

### `workspace.open` (span)

Opening a workspace from any entry point.

| Attribute                   | Values                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `source`                    | `command`, `sidebar_agent`, `sidebar_workspace`, `sidebar_fallback`, `uri` |
| `workspace_status`          | WorkspaceStatus (once a workspace is selected)                             |
| `workspace_outdated`        | `true`, `false` (once a workspace is selected)                             |
| `agent_status`              | WorkspaceAgentStatus (only when an agent was selected)                     |
| `agent_lifecycle_state`     | WorkspaceAgentLifecycle (only when an agent was selected)                  |
| `handoff`                   | `folder`, `empty_window` (how the remote window opened)                    |
| `abort_stage`               | `workspace_picker`, `agent_picker`, `recent_folder_picker`                 |
| `error.type`                | `fetch_error`, `error`                                                     |
| `agent.count` (M)           | agents in the workspace                                                    |
| `agent.connected_count` (M) | connected agents                                                           |

### `workspace.picker.prompted` (span)

| Attribute                                      | Values                                                 |
| ---------------------------------------------- | ------------------------------------------------------ |
| `source`                                       | `workspace_open`, `diagnostic`                         |
| `workspace_status`, `workspace_outdated`       | as in `workspace.open` (when a workspace was selected) |
| `error.type`                                   | `fetch_error`                                          |
| `workspace.count` (M)                          | workspaces listed                                      |
| `agent.count` (M), `agent.connected_count` (M) | when a workspace was selected                          |

### `workspace.dev_container.open` (span)

| Attribute    | Values                                |
| ------------ | ------------------------------------- |
| `mode`       | `dev_container`, `attached_container` |
| `error.type` | `error`                               |
