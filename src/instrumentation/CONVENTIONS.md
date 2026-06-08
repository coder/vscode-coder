# Telemetry conventions

How to add telemetry so every instrumentation reads the same way. The framework
lives in `src/telemetry`; the per-domain instrumentation business code talks to
lives here in `src/instrumentation`. See `cli.ts` (spans + phases) and `ssh.ts`
(point-in-time logs) as references.

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
- No secrets, tokens, query strings, or unbounded values in properties; routes
  go through `normalizeRoute`.
- Let the framework set `result`; add a domain `outcome` only when an operation
  has several success modes. Failures go to a typed union; non-error early exits
  call `markAborted`.

## Layers

- **Framework** (`src/telemetry`): `TelemetryService` (`trace`/`log`/`logError`)
  hands out `Span` handles and owns IDs, timing, `result`, level-gating, and the
  wire format. Telemetry-off is handled here (`NOOP_SPAN`), so instrumentation
  never checks whether telemetry is enabled.
- **Instrumentation** (`src/instrumentation/*`): one typed class per domain, the
  only telemetry surface business code sees.

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
| Property / measurement key | lowercase; `_` splits words, `.` for groups | `cache_source`, `failure_category`, `status.from`         |
| Enumerated value           | typed `snake_case` union                    | `"cache_hit"`, `"session_token"`, `"unrecoverable_close"` |

This is the [OTel attribute convention](https://opentelemetry.io/docs/specs/semconv/general/naming/):
`.` is the namespace delimiter, `_` joins words within a segment, never
camelCase. Default to a flat `snake_case` key; use `.` only to group genuinely
related attributes (a `status.from` / `status.to` pair). Keep phase names
subject-first within a domain (`agent_resolve`, not `resolve_agent`).

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
- **Units.** There is no unit field at emit time, so put the unit in the
  measurement key as a `_ms` / `_mbits` suffix, the same way for every event.
  The OTLP exporter then resolves it per signal: for metric events
  (`http.requests`, `ssh.network.sampled`) it moves the suffix into the OTLP
  `unit` field and drops it from the metric name (`latency_ms` exports as metric
  `latency`, unit `ms`, which Prometheus then suffixes itself); log and span
  attributes keep the key as written. You always author `latency_ms`; only the
  exported metric name changes.

## Outcomes, failures, aborts

- The framework sets `result` (`success` / `error` / `aborted`) on every span;
  don't duplicate it.
- Add a domain `outcome` property only when an operation has several success
  modes worth distinguishing (e.g. `cli.resolve`: `cache_hit`, `downloaded`).
- Classify failures into a typed union (`failure_category`, or a domain
  `reason`) via a `categorize*Failure` helper rather than emitting raw error
  strings; the
  framework already captures the error block.
- For a non-error early exit (cancelled, not-found), call `span.markAborted()`
  rather than throwing.

## Safety

Never put tokens, credentials, full URLs with query strings, or unbounded user
input into properties. Routes go through `normalizeRoute`
(`src/logging/routeNormalization.ts`). Prefer a closed union over a free-form
string for any property a dashboard groups by.
