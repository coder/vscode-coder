import { describe, expect, it } from "vitest";

import {
	parseTelemetryEventLine,
	serializeTelemetryEvent,
	TelemetryFileParseError,
} from "@/telemetry/wireFormat";

import { createTelemetryEventFactory } from "../../mocks/telemetry";

import type { TelemetryEvent } from "@/telemetry/event";

const makeEvent = createTelemetryEventFactory();

describe("serializeTelemetryEvent", () => {
	it("writes snake_case keys at the top level and inside context", () => {
		const wire = serializeTelemetryEvent(
			makeEvent({ traceId: "trace-1", parentEventId: "parent-1" }),
		);

		expect(wire).toMatchObject({
			event_id: expect.any(String),
			event_name: "test.event",
			event_sequence: expect.any(Number),
			trace_id: "trace-1",
			parent_event_id: "parent-1",
			context: {
				extension_version: "1.14.5",
				machine_id: "machine-id",
				deployment_url: "https://coder.example.com",
			},
		});
	});

	it("omits trace_id, parent_event_id, and error when unset", () => {
		const wire = serializeTelemetryEvent(makeEvent());

		expect(wire).not.toHaveProperty("trace_id");
		expect(wire).not.toHaveProperty("parent_event_id");
		expect(wire).not.toHaveProperty("error");
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

describe("parseTelemetryEventLine", () => {
	it("round-trips serialize -> parse to the original event", () => {
		const event = makeEvent({
			traceId: "trace-1",
			parentEventId: "parent-1",
			error: { message: "boom", type: "Error", code: "E_BOOM" },
			properties: { a: "1" },
			measurements: { b: 2 },
		});

		const parsed = parseTelemetryEventLine(
			JSON.stringify(serializeTelemetryEvent(event)),
			"<test>",
			1,
		);

		expect(parsed).toEqual(event);
	});

	it("throws TelemetryFileParseError tagged with source:lineNumber", () => {
		expect.assertions(3);
		try {
			parseTelemetryEventLine("{not-json}", "events.jsonl", 7);
		} catch (err) {
			expect(err).toBeInstanceOf(TelemetryFileParseError);
			expect((err as Error).message).toMatch(/events\.jsonl:7/);
			expect((err as Error).cause).toBeDefined();
		}
	});

	it("rejects events with timestamps that are not valid ISO datetimes", () => {
		const wire = serializeTelemetryEvent(
			makeEvent({ timestamp: "2026-02-30T00:00:00.000Z" }),
		);

		expect(() =>
			parseTelemetryEventLine(JSON.stringify(wire), "<test>", 1),
		).toThrow(TelemetryFileParseError);
	});

	it("rejects rows missing required structural fields", () => {
		const wire = serializeTelemetryEvent(makeEvent());
		delete wire.context;

		expect(() =>
			parseTelemetryEventLine(JSON.stringify(wire), "<test>", 1),
		).toThrow(TelemetryFileParseError);
	});

	it("preserves arbitrary keys in properties and measurements", () => {
		const event: TelemetryEvent = makeEvent({
			properties: { user_id: "alice", camelCase: "kept" },
			measurements: { duration_ms: 42 },
		});

		const parsed = parseTelemetryEventLine(
			JSON.stringify(serializeTelemetryEvent(event)),
			"<test>",
			1,
		);

		expect(parsed.properties).toEqual({
			user_id: "alice",
			camelCase: "kept",
		});
		expect(parsed.measurements).toEqual({ duration_ms: 42 });
	});
});
