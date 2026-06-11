import { afterEach, describe, expect, it, vi } from "vitest";

import {
	CURRENT_TELEMETRY_SCHEMA_VERSION,
	serializeTelemetryEvent,
	serializeTelemetryEventLine,
	serializeTelemetryFileHeaderLine,
	TelemetryFileParseError,
	TelemetryFileParser,
} from "@/telemetry/wireFormat";

import { createTelemetryEventFactory } from "../../mocks/telemetry";

import type { TelemetryEvent } from "@/telemetry/event";

const makeEvent = createTelemetryEventFactory();

/** Header line for the factory's session context. */
const headerLineFor = (event: TelemetryEvent): string =>
	serializeTelemetryFileHeaderLine(event.context);

afterEach(() => vi.useRealTimers());

describe("serializeTelemetryFileHeaderLine", () => {
	it("writes kind, schema version, timestamp, and the snake_case session context", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
		const header = JSON.parse(headerLineFor(makeEvent()));

		// Exact match: also proves the mutable deployment URL is not written.
		expect(header).toEqual({
			kind: "header",
			schema_version: CURRENT_TELEMETRY_SCHEMA_VERSION,
			timestamp: "2026-05-04T12:00:00.000Z",
			context: {
				extension_version: "1.14.5",
				machine_id: "machine-id",
				session_id: "session-id",
				os_type: "linux",
				os_version: "6.0.0",
				host_arch: "x64",
				platform_name: "Visual Studio Code",
				platform_version: "1.106.0",
			},
		});
	});
});

describe("serializeTelemetryEventLine", () => {
	it("writes snake_case per-event fields plus the deployment URL", () => {
		const row = JSON.parse(
			serializeTelemetryEventLine(
				makeEvent({ traceId: "trace-1", parentEventId: "parent-1" }),
			),
		);

		expect(row).toMatchObject({
			event_id: expect.any(String),
			event_name: "test.event",
			event_sequence: expect.any(Number),
			deployment_url: "https://coder.example.com",
			trace_id: "trace-1",
			parent_event_id: "parent-1",
		});
	});

	it("omits the session context, schema version, and unset optional fields", () => {
		const row = JSON.parse(serializeTelemetryEventLine(makeEvent()));

		expect(row).not.toHaveProperty("context");
		expect(row).not.toHaveProperty("schema_version");
		expect(row).not.toHaveProperty("trace_id");
		expect(row).not.toHaveProperty("parent_event_id");
		expect(row).not.toHaveProperty("error");
	});
});

describe("serializeTelemetryEvent", () => {
	it("writes the self-contained export shape with context and schema version", () => {
		const wire = serializeTelemetryEvent(
			makeEvent({ traceId: "trace-1", parentEventId: "parent-1" }),
		);

		expect(wire).toMatchObject({
			event_id: expect.any(String),
			event_name: "test.event",
			event_sequence: expect.any(Number),
			schema_version: CURRENT_TELEMETRY_SCHEMA_VERSION,
			trace_id: "trace-1",
			parent_event_id: "parent-1",
			context: {
				extension_version: "1.14.5",
				machine_id: "machine-id",
				deployment_url: "https://coder.example.com",
			},
		});
	});

	it("passes properties and measurements through unchanged", () => {
		const wire = serializeTelemetryEvent(
			makeEvent({
				properties: { user_id: "alice", camelCase: "kept" },
				measurements: { duration_ms: 42 },
			}),
		);

		expect(wire.properties).toEqual({ user_id: "alice", camelCase: "kept" });
		expect(wire.measurements).toEqual({ duration_ms: 42 });
	});
});

describe("TelemetryFileParser", () => {
	const parse = (
		lines: readonly string[],
	): Array<TelemetryEvent | undefined> => {
		const parser = new TelemetryFileParser("<test>");
		return lines.map((line, i) => parser.parseLine(line, i + 1));
	};

	it("round-trips header + row back to the original event", () => {
		const event = makeEvent({
			traceId: "trace-1",
			parentEventId: "parent-1",
			error: { message: "boom", type: "Error", code: "E_BOOM" },
			// Snake and camel keys prove caller-supplied property/measurement
			// keys survive the structural key renaming untouched.
			properties: { user_id: "alice", camelCase: "kept" },
			measurements: { duration_ms: 42 },
		});

		const [header, parsed] = parse([
			headerLineFor(event),
			serializeTelemetryEventLine(event),
		]);

		expect(header).toBeUndefined();
		expect(parsed).toEqual(event);
	});

	it("applies the header's schema version and context to every row", () => {
		const first = makeEvent();
		const second = makeEvent({
			context: { ...first.context, deploymentUrl: "https://other.example" },
		});

		const [, a, b] = parse([
			headerLineFor(first),
			serializeTelemetryEventLine(first),
			serializeTelemetryEventLine(second),
		]);

		expect(a?.schemaVersion).toBe(CURRENT_TELEMETRY_SCHEMA_VERSION);
		expect(a?.context.deploymentUrl).toBe("https://coder.example.com");
		expect(b?.context).toEqual({
			...first.context,
			deploymentUrl: "https://other.example",
		});
	});

	it("accepts a header with no rows as a valid, empty file", () => {
		expect(parse([headerLineFor(makeEvent())])).toEqual([undefined]);
	});

	it("rejects rows that appear before any header", () => {
		expect(() => parse([serializeTelemetryEventLine(makeEvent())])).toThrow(
			/expected a file header before event rows/,
		);
	});

	it("rejects a second header in the same file", () => {
		const header = headerLineFor(makeEvent());

		expect(() => parse([header, header])).toThrow(
			/unexpected second file header/,
		);
	});

	it("rejects lines with an unknown kind", () => {
		expect(() => parse(['{"kind":"trailer"}'])).toThrow(
			TelemetryFileParseError,
		);
	});

	it("throws TelemetryFileParseError tagged with source:lineNumber", () => {
		expect.assertions(3);
		const parser = new TelemetryFileParser("events.jsonl");
		try {
			parser.parseLine("{not-json}", 7);
		} catch (err) {
			expect(err).toBeInstanceOf(TelemetryFileParseError);
			expect((err as Error).message).toMatch(/events\.jsonl:7/);
			expect((err as Error).cause).toBeDefined();
		}
	});

	it("rejects rows with timestamps that are not valid ISO datetimes", () => {
		const event = makeEvent({ timestamp: "2026-02-30T00:00:00.000Z" });

		expect(() =>
			parse([headerLineFor(event), serializeTelemetryEventLine(event)]),
		).toThrow(TelemetryFileParseError);
	});

	it("rejects rows missing required structural fields", () => {
		const row = JSON.parse(serializeTelemetryEventLine(makeEvent())) as Record<
			string,
			unknown
		>;
		delete row.deployment_url;

		expect(() =>
			parse([headerLineFor(makeEvent()), JSON.stringify(row)]),
		).toThrow(TelemetryFileParseError);
	});
});
