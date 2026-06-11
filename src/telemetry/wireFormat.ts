import { z } from "zod";

/**
 * Wire schema version stamped on the header line of every telemetry file and
 * applied to all rows below it. Bump only on a breaking change to the JSONL
 * shape (a renamed, removed, or retyped field); additive optional fields do
 * not need a bump.
 */
export const CURRENT_TELEMETRY_SCHEMA_VERSION = 1;

/** Session-stable resource attributes captured once per VS Code session. */
const SessionContextSchema = z.object({
	extensionVersion: z.string(),
	machineId: z.string(),
	sessionId: z.string(),
	osType: z.string(),
	osVersion: z.string(),
	hostArch: z.string(),
	platformName: z.string(),
	platformVersion: z.string(),
});

/** First line of every telemetry file: schema version, start time, session context. */
const TelemetryFileHeaderSchema = z.object({
	kind: z.literal("header"),
	schemaVersion: z.number().int().positive(),
	/** Sink start time; at or before every row's timestamp. */
	timestamp: z.iso.datetime({ offset: true }),
	context: SessionContextSchema,
});

const TelemetryEventBaseSchema = z.object({
	eventId: z.string(),
	eventName: z.string(),
	timestamp: z.iso.datetime({ offset: true }),
	eventSequence: z.number(),
	properties: z.record(z.string(), z.string()),
	measurements: z.record(z.string(), z.number()),
	/** Shared by all events in a trace. Maps to OTel `trace_id`. */
	traceId: z.string().optional(),
	/**
	 * Parent span in the same trace. For phase children this maps to OTel
	 * `parent_span_id`. For span logs it maps to OTel `span_id` on the log
	 * record (the span the log belongs to).
	 */
	parentEventId: z.string().optional(),
	error: z
		.object({
			message: z.string(),
			type: z.string().optional(),
			code: z.string().optional(),
		})
		.optional(),
});

/**
 * Event row as stored on disk. Session-constant fields live in the file
 * header; the row adds only the mutable deployment URL.
 */
const TelemetryEventRowSchema = TelemetryEventBaseSchema.extend({
	deploymentUrl: z.string(),
});

/** Deep `readonly` since zod's inferred types are mutable by default. */
type DeepReadonly<T> = T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T;

export type SessionContext = DeepReadonly<z.infer<typeof SessionContextSchema>>;

/** Session attributes plus the deployment URL active at emit time. */
export type TelemetryContext = DeepReadonly<
	z.infer<typeof SessionContextSchema> & { deploymentUrl: string }
>;

/**
 * Canonical in-memory telemetry event: the row fields plus the schema version
 * and session context carried by the file header. Derived from the wire
 * schemas so the wire format and the in-memory shape can't drift.
 */
export type TelemetryEvent = DeepReadonly<
	z.infer<typeof TelemetryEventBaseSchema> & {
		/** Wire schema version of the file the event came from. See `CURRENT_TELEMETRY_SCHEMA_VERSION`. */
		schemaVersion: number;
		context: TelemetryContext;
	}
>;

/** Lets stream readers tell a parse failure apart from an IO failure. */
export class TelemetryFileParseError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "TelemetryFileParseError";
	}
}

/** Per-event fields in their snake_case wire form. */
function eventWireFields(event: TelemetryEvent): Record<string, unknown> {
	return {
		event_id: event.eventId,
		event_name: event.eventName,
		timestamp: event.timestamp,
		event_sequence: event.eventSequence,
		properties: event.properties,
		measurements: event.measurements,
		...(event.traceId !== undefined && { trace_id: event.traceId }),
		...(event.parentEventId !== undefined && {
			parent_event_id: event.parentEventId,
		}),
		...(event.error !== undefined && { error: event.error }),
	};
}

/** Session attributes in their snake_case wire form. */
function sessionWireFields(session: SessionContext): Record<string, unknown> {
	return {
		extension_version: session.extensionVersion,
		machine_id: session.machineId,
		session_id: session.sessionId,
		os_type: session.osType,
		os_version: session.osVersion,
		host_arch: session.hostArch,
		platform_name: session.platformName,
		platform_version: session.platformVersion,
	};
}

/** Serializes the newline-terminated header line opening a telemetry file, stamped with the current time. */
export function serializeTelemetryFileHeaderLine(
	session: SessionContext,
): string {
	return (
		JSON.stringify({
			kind: "header",
			schema_version: CURRENT_TELEMETRY_SCHEMA_VERSION,
			timestamp: new Date().toISOString(),
			context: sessionWireFields(session),
		}) + "\n"
	);
}

/**
 * Serializes one event to its newline-terminated JSONL row. Session-constant
 * fields are written once in the file header, so the row carries only the
 * per-event fields plus the deployment URL active at emit time.
 */
export function serializeTelemetryEventLine(event: TelemetryEvent): string {
	return (
		JSON.stringify({
			...eventWireFields(event),
			deployment_url: event.context.deploymentUrl,
		}) + "\n"
	);
}

/**
 * Snake-case object carrying the full event including its context, so each
 * exported record is self-contained. Used by the JSON export, not the sink.
 */
export function serializeTelemetryEvent(
	event: TelemetryEvent,
): Record<string, unknown> {
	return {
		...eventWireFields(event),
		schema_version: event.schemaVersion,
		context: {
			...sessionWireFields(event.context),
			deployment_url: event.context.deploymentUrl,
		},
	};
}

/**
 * Stateful parser for one telemetry JSONL file. The first line must be the
 * file header; every row below it combines with the header's session context
 * to yield a full `TelemetryEvent`. Throws `TelemetryFileParseError` on
 * malformed lines, rows before the header, duplicate headers, or an unknown
 * `kind`. A header with no rows is a valid, empty file.
 */
export class TelemetryFileParser {
	readonly #source: string;
	#header: z.infer<typeof TelemetryFileHeaderSchema> | undefined;

	constructor(source: string) {
		this.#source = source;
	}

	/** Parses one line, returning its event or undefined for the header line. */
	parseLine(line: string, lineNumber: number): TelemetryEvent | undefined {
		try {
			return this.#parse(line);
		} catch (err) {
			throw new TelemetryFileParseError(
				`Failed to parse telemetry file ${this.#source}:${lineNumber}: ${describeParseError(err)}`,
				{ cause: err },
			);
		}
	}

	#parse(line: string): TelemetryEvent | undefined {
		const value = wireToCamel(JSON.parse(line));
		if (hasKind(value)) {
			if (this.#header) {
				throw new Error("unexpected second file header");
			}
			this.#header = TelemetryFileHeaderSchema.parse(value);
			return undefined;
		}
		if (!this.#header) {
			throw new Error("expected a file header before event rows");
		}
		const { deploymentUrl, ...row } = TelemetryEventRowSchema.parse(value);
		return {
			...row,
			schemaVersion: this.#header.schemaVersion,
			context: { ...this.#header.context, deploymentUrl },
		};
	}
}

function hasKind(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Record<string, unknown>).kind !== undefined
	);
}

const SNAKE_TO_CAMEL = /_([a-z])/g;

/**
 * Snake-case to camelCase for structural keys only (top-level + `context`).
 * `properties` and `measurements` hold caller-supplied keys we must keep as-is.
 */
function wireToCamel(value: unknown): unknown {
	const obj = value as Record<string, unknown>;
	const next = renameKeys(obj);
	const context = next.context;
	if (typeof context === "object" && context !== null) {
		next.context = renameKeys(context as Record<string, unknown>);
	}
	return next;
}

function renameKeys(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		out[key.replace(SNAKE_TO_CAMEL, (_, ch: string) => ch.toUpperCase())] =
			value;
	}
	return out;
}

function describeParseError(err: unknown): string {
	if (err instanceof z.ZodError) {
		return z.prettifyError(err);
	}
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}
