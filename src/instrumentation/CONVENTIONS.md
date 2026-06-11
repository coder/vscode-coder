# Telemetry conventions

How to add telemetry so every instrumentation reads the same way. The framework
lives in `src/telemetry`; the per-domain instrumentation business code talks to
lives here in `src/instrumentation`.

## Checklist

- One instrumentation class per domain (`FooTelemetry`) wrapping
  `TelemetryService`; business code imports that, never a raw span.
- Event name is `domain.snake_case`; point-in-time logs use past tense.
- Event names and attribute keys follow OTel: lowercase, `.` for hierarchy, `_`
  to split words, never camelCase. Enumerated values are typed `snake_case`
  unions, never bare `string`.
- Numbers go in `measurements` (raw), never pre-bucketed into string properties.
- Set attributes imperatively with `setProperty`/`setMeasurement`; never add a
  return value that exists only to be logged.
- No secrets, tokens, query strings, file paths, or other unbounded user
  content in properties; routes go through `normalizeRoute`.
- Let the framework set `result`; add a domain `outcome` only when an operation
  has several success modes. Errors go to a typed `error.type` union; non-error
  early exits call `markAborted`.

## Layers

- **Framework** (`src/telemetry`): `TelemetryService` (`trace`/`log`/`logError`)
  hands out `Span` handles and owns IDs, timing, `result`, level-gating, and the
  wire format. Telemetry-off is handled here (`NOOP_SPAN`), so instrumentation
  never checks whether telemetry is enabled.
- **Instrumentation** (`src/instrumentation/*`): one typed class per domain, the
  only telemetry surface business code sees.

## Structure

- Split instrumentation files along the same boundaries as the business code,
  not one catch-all module.
- Shared span helpers (`recordError`, `recordAborted`) live in one shared module,
  not duplicated per file.
- Record-error-then-rethrow-outside-the-span logic lives once per class, in a
  single private helper, not in every `traceX` method.

## Threading

Spans are passed **explicitly** as a callback argument; there is no
ambient/active-span context. Two patterns keep telemetry out of business logic:

1. **Imperative attributes** — `span.setProperty("outcome", "cache_hit")` at the
   point the value is known. This is the standard OpenTelemetry model.
2. **Typed phases** — wrap an async step in `span.phase(...)` and read one
   property off its _natural_ return value, e.g.
   `trace.versionCheck(() => this.checkBinary(...))`. Extraction stays out of
   the business function.

Never return a value purely so a caller can log it; that couples the return type
to observability. Returning is fine when the business uses the value too.

## Callers

- Declare telemetry dimensions explicitly at the call site; pass `source: "uri"`
  rather than inferring it from which arguments happen to be set.
- Keep business bodies in named private `runX(args, trace)` methods; the public
  method just opens the span and wraps them. Small diffs, named telemetry seam.
- When sibling events share a correlating property, emit it on every event in the
  family; don't drop it from new ones.

## Spans, phases, logs

- `trace(name, fn, props?, meas?)` — a span with framework-set `result` and
  `durationMs`. Use for an operation with a start and end.
- `span.phase(name, fn, ...)` — the same, nested (composed as `parent.child`);
  child names cannot contain `.`.
- `span.log(name, ...)` / `span.logError(name, error, ...)` — point-in-time
  events under a span, no `result`/`durationMs`. Use for discrete signals.

## Naming

| Thing                      | Convention                                  | Examples                                                  |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Event name                 | `domain.snake_case`                         | `cli.resolve`, `remote.setup`, `connection.dropped`       |
| Point-in-time log          | past tense                                  | `connection.dropped`, `ssh.process.lost`                  |
| Child phase                | bare `snake_case`                           | `cache_lookup`, `version_check`, `connection_handoff`     |
| Property / measurement key | lowercase; `_` splits words, `.` for groups | `cache_source`, `error.type`, `status.from`               |
| Enumerated value           | typed `snake_case` union                    | `"cache_hit"`, `"session_token"`, `"unrecoverable_close"` |

This is the [OTel attribute convention](https://opentelemetry.io/docs/specs/semconv/general/naming/):
`.` is the namespace delimiter, `_` joins words within a segment, never
camelCase. Default to a flat `snake_case` key; use `.` only to group genuinely
related attributes (a `status.from` / `status.to` pair). Keep phase names
subject-first within a domain (`agent_resolve`, not `resolve_agent`).

**Methods.** Span-wrapper methods are `trace<Noun>` (`traceOpen`,
`traceConfirmationPrompt`); don't echo the event's past-tense suffix
(`traceUpdateConfirmationPrompted`), and drop qualifiers the class implies.

**Grouping.** Group related events under a shared dotted namespace so a prefix
query returns the whole family: `workspace.update.triggered` and
`workspace.update.prompted` both sit under `workspace.update.*`, as do
`auth.token_refresh.completed` / `.deduped` under `auth.token_refresh.*`. Keep
the namespace node a pure prefix; don't also emit an event with that exact name,
since dotted names otherwise read as span phases (`parent.child`). This is
[OTel namespacing](https://opentelemetry.io/docs/specs/semconv/general/naming/),
which exists precisely so related signals query together.

**Namespacing.** OTel suggests prefixing custom attributes (`com.acme.*`) to
avoid clashing with future semconv. We don't namespace event-level attributes:
each is already scoped by its (namespaced) event name and only flows into
Coder's own pipeline, so a bare `cache_source` can't collide with a future OTel
`cache.source`. Resource and provenance attributes stay namespaced
(`coder.deployment.url`, `coder.event.*`).

## Properties vs measurements

- **Properties** are low-cardinality string dimensions (the framework stringifies
  `string | number | boolean`). Use them for what you group or filter by.
- **Measurements** are raw numbers. Don't pre-bucket into string labels: both
  export as record attributes, and a query can bucket the raw number at read
  time. `result` and `durationMs` are framework-managed and cannot be set.
  `durationMs` never reaches OTLP; the export derives span start/end times
  from it.
- **Units.** There is no unit field at emit time, so put the unit in the
  measurement key as a `_ms` / `_seconds` / `_mbits` suffix, the same way for
  every event.
  The OTLP exporter then resolves it per signal: for metric events
  (`http.requests`, `ssh.network.sampled`) it moves the suffix into the OTLP
  `unit` field and drops it from the metric name (`latency_ms` exports as metric
  `latency`, unit `ms`, which Prometheus then suffixes itself); log and span
  attributes keep the key as written. You always author `latency_ms`; only the
  exported metric name changes.
- **Counts.** Name a count `<entity>.count`, singular entity (`agent.count`,
  `workspace.count`), per OTel (`system.process.count`) — not flat `agent_count`.
  Related counts share the namespace (`agent.count`, `agent.connected_count`); a
  count with no entity (`retry_count`) stays flat.

## Outcomes, errors, aborts

- The framework sets `result` (`success` / `error` / `aborted`) on every span;
  don't duplicate it.
- Add a domain `outcome` property only when an operation has several success
  modes worth distinguishing (e.g. `cli.resolve`: `cache_hit`, `downloaded`).
- Classify errors into a typed `error.type` union via a `categorize*Error` helper
  rather than emitting raw error strings; the framework captures the error block.
- For a non-error early exit (backed out, not-found), call `span.markAborted()`
  rather than throwing, recording its reason in a separate key, not `error.type`.
- A trace exposes one outcome trio — `abort(stage)`, `error(category?)`,
  `succeed*(payload)` — over the shared `recordAborted` / `recordError` helpers;
  each outcome sets one, never two.
- Prefer **error** over "failure" and **abort** over "cancel" here (`recordError`
  / `error.type` / `error()`; `recordAborted` / `markAborted` / `abort()`).
  Point-in-time logs keep past tense (`recovery_failed`) — they state what
  happened, not a span's `error` result.

## Safety

Never put tokens, credentials, file paths, full URLs with query strings, or
user-provided content (prompts, messages, titles) into properties. Routes go
through `normalizeRoute` (`src/logging/routeNormalization.ts`). Prefer a closed
union over a free-form string for any property a dashboard groups by, and keep
metric attributes low-cardinality: every distinct value combination becomes its
own series.

Identifying dimensions are deliberate, not default. `deployment_url`,
`machine_id`, and `session_id` ride along in the session context, so events
never repeat them as properties. Workspace and agent names are opt-in per
event: include them only where the event is useless without them
(`workspace.state_transitioned`), omit them everywhere else.

## Tests

- Telemetry-only tests of business code are `<subject>.telemetry.test.ts`;
  instrumentation modules keep `<module>.test.ts` and split when the module does.
- Assert what privacy intends to omit, not only what is present (e.g.
  `workspace_name` undefined on command events).
