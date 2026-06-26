# Telemetry events

Every event, property, and measurement the extension emits, grouped by
category and, within each category, by signal kind. Conventions for adding
new ones live in `CONVENTIONS.md`.

## Event index

| Category                                        | Events                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Activation](#activation)                       | `activation`, `activation.deployment_init`                                                                                                                                                                                                                              |
| [Auth](#auth)                                   | `auth.login`, `auth.logout`, `auth.login_prompted`, `auth.token_refresh.completed`, `auth.unauthorized_intercepted`, `auth.session_lookup`, `auth.credential.store`, `auth.credential.clear`, `auth.token_refresh.deduped`                                              |
| [CLI](#cli)                                     | `cli.resolve`, `cli.download`, `cli.configure`                                                                                                                                                                                                                          |
| [Commands](#commands)                           | `command.invoked`, `command.diagnostic.completed`                                                                                                                                                                                                                       |
| [Deployment](#deployment)                       | `deployment.suspended`, `deployment.recovered`, `deployment.cross_window.detected`, `deployment.auth_config.recovery_failed`                                                                                                                                            |
| [Remote setup](#remote-setup)                   | `remote.setup`                                                                                                                                                                                                                                                          |
| [SSH](#ssh)                                     | `ssh.process.discovered`, `ssh.process.lost`, `ssh.process.recovered`, `ssh.process.replaced`, `ssh.process.disposed`, `ssh.network.sampled`                                                                                                                            |
| [HTTP](#http)                                   | `http.requests`                                                                                                                                                                                                                                                         |
| [WebSocket connections](#websocket-connections) | `connection.state_transitioned`, `connection.opened`, `connection.dropped`, `connection.reconnect_resolved`                                                                                                                                                             |
| [Workspace](#workspace)                         | `workspace.start.triggered`, `workspace.update.triggered`, `workspace.start.prompted`, `workspace.update.prompted`, `workspace.open`, `workspace.picker.prompted`, `workspace.dev_container.open`, `workspace.state_transitioned`, `workspace.agent.state_transitioned` |

Signal kinds, which each category groups its events by:

- **span**: a traced operation; the framework adds `result`
  (`success` / `aborted` / `error`) and `durationMs`.
- **phase**: a child span, named `parent.child`; same framework attributes.
  Phases are documented with their parent span.
- **log**: a point-in-time event with no `result` / `durationMs`. Logs emitted
  under a span carry its `trace_id` / `parent_event_id`.
- **metric**: a log the OTLP exporter converts to metric data points instead
  of a log record.

## Attributes on every event

Framework-managed envelope fields (wire keys, JSONL):

| Field             | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `event_id`        | Unique per event (OTel span id, 16 hex)                                |
| `event_name`      | The event names below                                                  |
| `timestamp`       | ISO 8601 emission time                                                 |
| `event_sequence`  | Monotonic per-session counter                                          |
| `deployment_url`  | Deployment active at emit time; empty until set via `setDeploymentUrl` |
| `trace_id`        | Spans and their child events only (OTel trace id, 32 hex)              |
| `parent_event_id` | Phases and span logs only; the parent span's `event_id`                |
| `error`           | `{ message, type?, code? }`, only when an error was captured           |

Session-constant context is written once per file instead of on every row:
the first line of every telemetry file (including rotated `.N` segments) is
a header carrying the wire schema version, the sink start time, and the
session context; each row below it implicitly inherits the version and
context.

```json
{
	"kind": "header",
	"schema_version": 1,
	"timestamp": "...",
	"context": {
		"extension_version": "...",
		"machine_id": "...",
		"session_id": "...",
		"os_type": "...",
		"os_version": "...",
		"host_arch": "...",
		"platform_name": "...",
		"platform_version": "..."
	}
}
```

| Field                                  | Source                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `schema_version`                       | Integer, currently `1`; bumped only on breaking wire changes, additive fields never bump it |
| `timestamp`                            | ISO 8601 sink start time; at or before every row's timestamp                                |
| `extension_version`                    | package.json version                                                                        |
| `machine_id`                           | `vscode.env.machineId`                                                                      |
| `session_id`                           | Generated per session                                                                       |
| `os_type` / `os_version` / `host_arch` | `process.platform` (windows normalized) / `os.release()` / `process.arch`                   |
| `platform_name` / `platform_version`   | `vscode.env.appName` / `vscode.version`                                                     |

On OTLP export the context becomes resource attributes (`service.name:
coder-vscode-extension`, `service.version`, `service.instance.id`, `host.id`,
`host.arch`, `os.type`, `os.version`, `vscode.platform.name`,
`vscode.platform.version`, `coder.deployment.url`) on the resource block
holding the producing session's records.

## Consuming exports

Events buffer on disk as JSONL; nothing leaves the machine on its own. The
**Coder: Export Telemetry** command flushes the buffer and writes a chosen
date range in one of two formats:

- **JSON**: one file holding an array of self-contained events, each
  carrying its full context and schema version, for direct inspection or
  ad-hoc processing.
- **OTLP**: a zip of standard OTLP/JSON envelopes (spans in `traces.json`,
  logs in `logs.json`, metric events as data points in `metrics.json`) plus
  a `manifest.json` describing the export. Each envelope holds one resource
  block per producing session and UTC date, carrying that session's context
  as resource attributes; within a block, metric data points are grouped
  under one `metrics[]` entry per metric name and unit, and cumulative
  counters restart at the block boundary. Feed these to any OTel-compatible
  tool that ingests OTLP/JSON, such as an OpenTelemetry Collector pipeline or
  your observability backend's import tooling.

The **Coder: Create Support Bundle** command also packs the raw JSONL
telemetry files into its bundle (under `vscode-logs/telemetry`), so a support
bundle alone is enough to inspect what was emitted.

## Reading the tables

Every event below has its own heading, grouped by category and signal kind,
and an attribute table. Event names go out on the wire exactly as written,
with no `coder.` prefix. Attributes are properties (string dimensions; numbers
and booleans are stringified) unless marked **(measurement)**, a raw number.
Measurements carry their unit in the key suffix (`_ms`, `_seconds`, `_mbits`,
`_bytes`) and `<entity>.count` keys are counts, so the tables do not repeat
units. Notes about when an attribute is set, or where its value comes from,
follow the values in parentheses. `WorkspaceStatus`, `WorkspaceAgentStatus`,
and `WorkspaceAgentLifecycle` are the server-defined unions from the Coder
API.

Two attributes follow the same rule on every span, so the tables do not repeat
it:

- `error.type`: a typed error category, present only on spans that ended in
  `result: error`.
- `abort_stage`: where the user backed out, present only on aborted spans.
  Aborts never set `error.type`; an abort with no recorded stage or reason
  carries just `result: aborted`.

## Activation

Emitted by `ActivationTelemetry`.

### Spans

#### `activation`

| Attribute    | Values                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `auth_state` | `none`, `stored`, `valid_token`, `auth_failed`, `unknown` (starts `none`, updated as activation learns more) |

#### `activation.deployment_init`

A sibling of `activation` rather than a child, because deployment init
outlives the activation span.

| Attribute    | Values                                                              |
| ------------ | ------------------------------------------------------------------- |
| `auth_state` | `unknown`, then `valid_token` or `auth_failed` from the init result |

## Auth

Emitted by `AuthTelemetry`; the credential events by `CredentialTelemetry`.

### Spans

#### `auth.login`

| Attribute    | Values                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `source`     | `auto_login`, `command`, `switch_deployment`, `uri`                                                           |
| `method`     | `mtls`, `provided_token`, `stored_token`, `keyring_token`, `cli_token`, `oauth`, `unknown` (starts `unknown`) |
| `reason`     | `user_dismissed`, `no_url_provided` (aborted logins only)                                                     |
| `error.type` | `auth_failed`, `exception`                                                                                    |

#### `auth.logout`

| Attribute    | Values                                     |
| ------------ | ------------------------------------------ |
| `reason`     | `not_authenticated` (aborted logouts only) |
| `error.type` | `exception`                                |

#### `auth.login_prompted`

| Attribute    | Values                                            |
| ------------ | ------------------------------------------------- |
| `trigger`    | `auth_required`, `missing_session`                |
| `reason`     | `user_dismissed`, `no_url_provided` (aborts only) |
| `error.type` | `auth_failed`                                     |

#### `auth.token_refresh.completed`

A refresh call that joins an in-flight refresh emits the
`auth.token_refresh.deduped` log instead of a span.

| Attribute | Values                   |
| --------- | ------------------------ |
| `trigger` | `background`, `reactive` |

#### `auth.unauthorized_intercepted`

Wraps the auth-recovery path triggered by a 401. Child log
`auth.unauthorized_intercepted.received` (no attributes) marks the 401 arrival.

| Attribute           | Values                                                      |
| ------------------- | ----------------------------------------------------------- |
| `recovery`          | `refresh_success`, `login_required`, `none` (starts `none`) |
| `refresh_attempted` | `true`, `false` (starts `false`)                            |

#### `auth.session_lookup`

Secret-storage session read during remote setup. No custom attributes.

#### `auth.credential.store` / `auth.credential.clear`

| Attribute         | Values                                            |
| ----------------- | ------------------------------------------------- |
| `keyring_enabled` | `true`, `false` (from settings)                   |
| `category`        | `keyring`, `file` (the storage actually involved) |
| `error.type`      | `binary`, `cli`                                   |

### Logs

#### `auth.token_refresh.deduped`

Logged when a refresh call joins an in-flight refresh and emits no
`auth.token_refresh.completed` span of its own.

| Attribute | Values                   |
| --------- | ------------------------ |
| `trigger` | `background`, `reactive` |

## CLI

Emitted by `CliTelemetry`; attributes set from `CliManager`.

### Spans

#### `cli.resolve`

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

#### `cli.download`

| Attribute                        | Values                                        |
| -------------------------------- | --------------------------------------------- |
| `reason`                         | `missing`, `version_mismatch`, `unreadable`   |
| `downloaded_bytes` (measurement) | omitted when nothing was written (e.g. a 304) |

Phase `cli.download.verify` covers binary signature verification:

| Attribute    | Values                                  |
| ------------ | --------------------------------------- |
| `outcome`    | `verified`, `bypassed`, `sig_not_found` |
| `sig_status` | HTTP status (only with `sig_not_found`) |

#### `cli.configure`

| Attribute           | Values                         |
| ------------------- | ------------------------------ |
| `silent`            | `true`, `false`                |
| `credential_source` | `session_token`, `empty_token` |
| `abort_stage`       | `credential_store`             |
| `error.type`        | `credential_store`, `unknown`  |

## Commands

### Spans

#### `command.invoked`

Emitted by `CommandManager` around every registered `coder.*` command.

| Attribute    | Values                 |
| ------------ | ---------------------- |
| `command_id` | a `coder.*` command id |

#### `command.diagnostic.completed`

Emitted by `DiagnosticTelemetry` around each diagnostic command.

| Attribute                                  | Values                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `command`                                  | `speed_test`, `netcheck`, `support_bundle`, `export_telemetry`   |
| `abort_stage`                              | `workspace_picker`, `input`, `prompt`, `save_dialog`, `progress` |
| `error.type`                               | `fetch_error`, `parse_error`, `unsupported_cli`, `error`         |
| `format`                                   | `json`, `otlp` (telemetry export only)                           |
| `severity`                                 | `ok`, `warning`, `error` (netcheck only)                         |
| `requested_duration_seconds` (measurement) | speed test only                                                  |
| `interval.count` (measurement)             | speed test only                                                  |
| `throughput_mbits` (measurement)           | speed test only                                                  |
| `region.count` (measurement)               | netcheck only; DERP regions in the report                        |
| `warning.count` (measurement)              | netcheck only; warnings across report sections                   |
| `event.count` (measurement)                | telemetry export only                                            |
| `file.skipped_count` (measurement)         | telemetry export only; unreadable files skipped, omitted at zero |

## Deployment

Emitted by `DeploymentTelemetry`.

### Logs

#### `deployment.suspended`

| Attribute | Values                                                                |
| --------- | --------------------------------------------------------------------- |
| `reason`  | `auth_config_change`, `auth_failure`, `credentials_removed`, `logout` |

#### `deployment.recovered`

| Attribute | Values                                        |
| --------- | --------------------------------------------- |
| `trigger` | `auth_config`, `cross_window`, `token_update` |

#### `deployment.cross_window.detected` / `deployment.auth_config.recovery_failed`

No attributes.

## Remote setup

### Spans

#### `remote.setup`

Emitted by `RemoteSetupTelemetry` around connecting to a remote workspace.

| Attribute | Values                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `outcome` | `workspace_not_found`, `incompatible_server` (non-throwing early exits; the span is aborted) |

Phases (`remote.setup.<name>`): `cli_resolve`, `compatibility_check`,
`cli_configure`, `workspace_lookup`, `workspace_monitor_setup`,
`workspace_ready`, `agent_resolve`, `ssh_config_write`, `ssh_monitor_setup`,
`connection_handoff`.

## SSH

Emitted by `SshTelemetry`.

### Spans

#### `ssh.process.discovered`

| Attribute                | Values                                    |
| ------------------------ | ----------------------------------------- |
| `found`                  | `true`, `false` (whether a PID was found) |
| `attempts` (measurement) | discovery attempts                        |

### Logs

#### `ssh.process.lost`

| Attribute                 | Values                                       |
| ------------------------- | -------------------------------------------- |
| `cause`                   | `stale_network_info`, `missing_network_info` |
| `uptime_ms` (measurement) | since process start                          |

#### `ssh.process.recovered`

| Attribute                            | Values     |
| ------------------------------------ | ---------- |
| `recovery_duration_ms` (measurement) | since loss |

#### `ssh.process.replaced`

| Attribute                          | Values                 |
| ---------------------------------- | ---------------------- |
| `was_lost`                         | `true`, `false`        |
| `previous_uptime_ms` (measurement) | prior process lifetime |
| `lost_duration_ms` (measurement)   | only when `was_lost`   |

#### `ssh.process.disposed`

| Attribute                 | Values              |
| ------------------------- | ------------------- |
| `was_lost`                | `true`, `false`     |
| `uptime_ms` (measurement) | since process start |

### Metrics

#### `ssh.network.sampled`

Tunnel network sample. Emitted on a roughly 60 s heartbeat, or on a p2p
flip, a preferred-DERP change, or a meaningful latency change (at least
25 ms and at least 20 %). Change-triggered emissions are limited to one per
15 s; a change that persists past that cooldown is emitted when it expires.

| Attribute                      | Values                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `p2p`                          | `true`, `false`                                                    |
| `preferred_derp`               | DERP region name                                                   |
| `latency_ms` (measurement)     | exports as gauge `ssh.network.sampled.latency` with unit `ms`      |
| `download_mbits` (measurement) | exports as gauge `ssh.network.sampled.download` with unit `Mbit/s` |
| `upload_mbits` (measurement)   | exports as gauge `ssh.network.sampled.upload` with unit `Mbit/s`   |

## HTTP

### Metrics

#### `http.requests`

Emitted by `HttpRequestsTelemetry`, which lives with the HTTP logging in
`src/logging`. A per-minute rollup of REST traffic, one event per method and
route bucket.

| Attribute                                                              | Values                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `method`                                                               | HTTP method                                                                                                          |
| `route`                                                                | normalized route (ids replaced by placeholders)                                                                      |
| `window_seconds` (measurement)                                         | actual window length                                                                                                 |
| `count.1xx` through `count.5xx`, `count.network_error` (measurements)  | omitted when 0; export as cumulative counters with unit `{request}`                                                  |
| `duration.p50_ms`, `duration.p95_ms`, `duration.p99_ms` (measurements) | omitted when no request carried timing metadata; export as gauges (`http.requests.duration.p50` etc.) with unit `ms` |

## WebSocket connections

Emitted by `WebSocketTelemetry`.

These events share one value set, **ConnectionStateReason**: `initial_connect`,
`manual_reconnect`, `certificate_refresh`, `scheduled_reconnect`, `open`,
`disconnect`, `dispose`, `unrecoverable_close`, `unrecoverable_http`,
`certificate_error`, `connection_error`, `normal_close`, `unexpected_close`.

### Logs

#### `connection.state_transitioned`

| Attribute    | Values                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `from`, `to` | `idle`, `connecting`, `connected`, `awaiting_retry`, `disconnected`, `disposed` (the `ReconnectingWebSocket` states) |
| `reason`     | ConnectionStateReason                                                                                                |

#### `connection.opened`

| Attribute                           | Values             |
| ----------------------------------- | ------------------ |
| `route`                             | normalized route   |
| `connect_duration_ms` (measurement) | from connect start |

#### `connection.dropped`

Emitted as an error log (with the `error` block) when a socket error caused
the drop.

| Attribute                              | Values                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `cause`                                | `manual_disconnect`, `replaced`, `unrecoverable_close`, `normal_close`, `unexpected_close`, `disposed`, `error` |
| `close_code`                           | WebSocket close code (when known)                                                                               |
| `connection_duration_ms` (measurement) | time the connection was open                                                                                    |

#### `connection.reconnect_resolved`

Closes a reconnect cycle (opened on the first drop, resolved on reconnect
success or termination).

| Attribute                         | Values                                                 |
| --------------------------------- | ------------------------------------------------------ |
| `outcome`                         | `success`, `error` (how the cycle resolved)            |
| `reason`                          | ConnectionStateReason (why the cycle started)          |
| `termination_reason`              | ConnectionStateReason (only when `outcome` is `error`) |
| `attempts` (measurement)          | connect attempts in the cycle                          |
| `max_backoff_ms` (measurement)    | largest backoff scheduled                              |
| `total_duration_ms` (measurement) | cycle wall time                                        |

## Workspace

Emitted by `WorkspaceOperationTelemetry` (start and update),
`WorkspaceOpenTelemetry` (open, picker, dev container), and
`WorkspaceStateTelemetry` / `WorkspaceAgentTelemetry` (the state-transition
logs).

### Spans

#### `workspace.start.triggered` / `workspace.update.triggered`

| Attribute        | Values |
| ---------------- | ------ |
| `workspace_name` | name   |

#### `workspace.start.prompted`

| Attribute        | Values                                                      |
| ---------------- | ----------------------------------------------------------- |
| `workspace_name` | name                                                        |
| `update_offered` | `true`, `false` (whether the workspace was outdated)        |
| `action`         | `start`, `update` (aborted with no `action` when dismissed) |

#### `workspace.update.prompted`

| Attribute        | Values                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `prompt`         | `parameters`, `confirmation`                                             |
| `workspace_name` | name                                                                     |
| `action`         | `update` (set when the confirmation is accepted; aborted when dismissed) |

#### `workspace.open`

Opening a workspace from any entry point.

| Attribute                             | Values                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `source`                              | `command`, `sidebar_agent`, `sidebar_workspace`, `sidebar_fallback`, `uri` |
| `workspace_status`                    | WorkspaceStatus (once a workspace is selected)                             |
| `workspace_outdated`                  | `true`, `false` (once a workspace is selected)                             |
| `agent_status`                        | WorkspaceAgentStatus (only when an agent was selected)                     |
| `agent_lifecycle_state`               | WorkspaceAgentLifecycle (only when an agent was selected)                  |
| `handoff`                             | `folder`, `empty_window` (how the remote window opened)                    |
| `abort_stage`                         | `workspace_picker`, `agent_picker`, `recent_folder_picker`                 |
| `error.type`                          | `fetch_error`, `error`                                                     |
| `agent.count` (measurement)           | agents in the workspace                                                    |
| `agent.connected_count` (measurement) | connected agents                                                           |

#### `workspace.picker.prompted`

| Attribute                                             | Values                                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `source`                                              | `workspace_open`, `diagnostic`                         |
| `workspace_status`, `workspace_outdated`              | as in `workspace.open` (when a workspace was selected) |
| `error.type`                                          | `fetch_error`                                          |
| `workspace.count` (measurement)                       | workspaces listed                                      |
| `agent.count`, `agent.connected_count` (measurements) | when a workspace was selected                          |

#### `workspace.dev_container.open`

| Attribute    | Values                                |
| ------------ | ------------------------------------- |
| `mode`       | `dev_container`, `attached_container` |
| `error.type` | `error`                               |

### Logs

#### `workspace.state_transitioned`

| Attribute                                  | Values                                                   |
| ------------------------------------------ | -------------------------------------------------------- |
| `workspace_name`                           | deliberately tracked here, omitted on command events     |
| `from`, `to`                               | WorkspaceStatus (`from` is `none` on first observation)  |
| `build.transition`                         | `start`, `stop`, `delete`                                |
| `build.reason`                             | build reason from the server                             |
| `observed_duration_ms` (measurement)       | time in the previous state; omitted on first observation |
| `observed_build_duration_ms` (measurement) | only when a provisioner run resolves                     |

#### `workspace.agent.state_transitioned`

| Attribute                                    | Values                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| `workspace_name`, `agent_name`               | names                                                |
| `status.from`, `status.to`                   | WorkspaceAgentStatus (`from` is `none` initially)    |
| `lifecycle_state.from`, `lifecycle_state.to` | WorkspaceAgentLifecycle (`from` is `none` initially) |
| `observed_duration_ms` (measurement)         | omitted on first observation                         |
