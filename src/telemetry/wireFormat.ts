import { z } from "zod";

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

/** Session attributes plus the deployment URL active at emit time. */
const TelemetryContextSchema = SessionContextSchema.extend({
	deploymentUrl: z.string(),
});

/**
 * Canonical telemetry event. Derived TS types (`TelemetryEvent`,
 * `TelemetryContext`, `SessionContext`) come straight from these schemas,
 * so the wire format and the in-memory shape can't drift.
 */
const TelemetryEventSchema = z.object({
	eventId: z.string(),
	eventName: z.string(),
	timestamp: z.iso.datetime({ offset: true }),
	eventSequence: z.number(),
	context: TelemetryContextSchema,
	properties: z.record(z.string(), z.string()),
	measurements: z.record(z.string(), z.number()),
	/** Shared by all events in a trace. Maps to OTel `trace_id`. */
	traceId: z.string().optional(),
	/** Parent event in the same trace. Maps to OTel `parent_span_id`. */
	parentEventId: z.string().optional(),
	error: z
		.object({
			message: z.string(),
			type: z.string().optional(),
			code: z.string().optional(),
		})
		.optional(),
});

/** Deep `readonly` since zod's inferred types are mutable by default. */
type DeepReadonly<T> = T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T;

export type SessionContext = DeepReadonly<z.infer<typeof SessionContextSchema>>;
export type TelemetryContext = DeepReadonly<
	z.infer<typeof TelemetryContextSchema>
>;
export type TelemetryEvent = DeepReadonly<z.infer<typeof TelemetryEventSchema>>;

/** Lets stream readers tell a parse failure apart from an IO failure. */
export class TelemetryFileParseError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "TelemetryFileParseError";
	}
}

/** Snake-case row written to disk by the sink and read back by the exporter. */
export function serializeTelemetryEvent(
	event: TelemetryEvent,
): Record<string, unknown> {
	return {
		event_id: event.eventId,
		event_name: event.eventName,
		timestamp: event.timestamp,
		event_sequence: event.eventSequence,
		context: {
			extension_version: event.context.extensionVersion,
			machine_id: event.context.machineId,
			session_id: event.context.sessionId,
			os_type: event.context.osType,
			os_version: event.context.osVersion,
			host_arch: event.context.hostArch,
			platform_name: event.context.platformName,
			platform_version: event.context.platformVersion,
			deployment_url: event.context.deploymentUrl,
		},
		properties: event.properties,
		measurements: event.measurements,
		...(event.traceId !== undefined && { trace_id: event.traceId }),
		...(event.parentEventId !== undefined && {
			parent_event_id: event.parentEventId,
		}),
		...(event.error !== undefined && { error: event.error }),
	};
}

/** Parses one JSONL row. Throws `TelemetryFileParseError` on bad input. */
export function parseTelemetryEventLine(
	line: string,
	source: string,
	lineNumber: number,
): TelemetryEvent {
	try {
		return TelemetryEventSchema.parse(wireToCamel(JSON.parse(line)));
	} catch (err) {
		throw new TelemetryFileParseError(
			`Failed to parse telemetry file ${source}:${lineNumber}: ${describeParseError(err)}`,
			{ cause: err },
		);
	}
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
