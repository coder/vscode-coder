import { describe, expect, it } from "vitest";

import {
	type MetricDescriptor,
	type MetricMeasurement,
} from "@/telemetry/export/metrics";
import {
	type CumulativeState,
	logRecord,
	metricRecords,
	newCumulativeState,
	otlpResource,
	otlpScope,
	spanRecord,
} from "@/telemetry/export/writers/otlp/records";

import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

import { TRACE_ID, attrs } from "./helpers";

const makeEvent = createTelemetryEventFactory();

/** Per-event identity that every record carries, derived from the factory defaults. */
const EVENT_CONTEXT_ATTRS = {
	"coder.event.extension_version": "1.14.5",
	"coder.event.session_id": "session-id",
	"coder.event.deployment_url": "https://coder.example.com",
} as const;

const makeSpanEvent = (overrides: Parameters<typeof makeEvent>[0] = {}) => ({
	...makeEvent({ traceId: TRACE_ID, ...overrides }),
	traceId: TRACE_ID,
});

const gauge = (name: string, value: number, unit = "1"): MetricMeasurement => ({
	name,
	value,
	kind: "gauge",
	unit,
});
const counter = (
	name: string,
	value: number,
	unit = "{request}",
): MetricMeasurement => ({ name, value, kind: "counter", unit });

describe("otlpResource", () => {
	it("maps the session context onto OTel-standard semconv keys", () => {
		const { context } = makeEvent();
		expect(attrs(otlpResource(context).attributes)).toEqual({
			"service.name": "coder-vscode-extension",
			"service.version": "1.14.5",
			"service.instance.id": "session-id",
			"host.id": "machine-id",
			"host.arch": "x64",
			"os.type": "linux",
			"os.version": "6.0.0",
			"vscode.platform.name": "Visual Studio Code",
			"vscode.platform.version": "1.106.0",
			"coder.deployment.url": "https://coder.example.com",
		});
	});
});

describe("otlpScope", () => {
	it("names the scope and stamps the extension version", () => {
		expect(otlpScope("9.9.9")).toEqual({
			name: "coder.vscode-coder.telemetry.export",
			version: "9.9.9",
		});
	});
});

describe("logRecord", () => {
	it("emits INFO records merging properties and measurements", () => {
		const record = logRecord(
			makeEvent({
				eventName: "log.info",
				properties: { source: "unit" },
				measurements: { count: 3 },
			}),
		);

		expect(record).toMatchObject({
			severityNumber: 9,
			severityText: "INFO",
			body: { stringValue: "log.info" },
		});
		expect(record.timeUnixNano).toBe(record.observedTimeUnixNano);
		expect(attrs(record.attributes)).toEqual({
			...EVENT_CONTEXT_ATTRS,
			source: "unit",
			count: 3,
		});
	});

	it("emits ERROR records and omits optional exception fields when unset", () => {
		const full = logRecord(
			makeEvent({
				error: { message: "boom", type: "RangeError", code: "E_RANGE" },
			}),
		);
		const minimal = logRecord(makeEvent({ error: { message: "boom" } }));

		expect(full).toMatchObject({ severityNumber: 17, severityText: "ERROR" });
		expect(attrs(full.attributes)).toMatchObject({
			"exception.message": "boom",
			"exception.type": "RangeError",
			"exception.code": "E_RANGE",
		});
		expect(attrs(minimal.attributes)).toEqual({
			...EVENT_CONTEXT_ATTRS,
			"exception.message": "boom",
		});
	});

	it("stamps each event's own context onto its record", () => {
		const base = makeEvent();
		const record = logRecord({
			...base,
			context: {
				...base.context,
				extensionVersion: "0.9.0",
				sessionId: "older-session",
				deploymentUrl: "https://prev.coder.example.com",
			},
		});

		expect(attrs(record.attributes)).toMatchObject({
			"coder.event.extension_version": "0.9.0",
			"coder.event.session_id": "older-session",
			"coder.event.deployment_url": "https://prev.coder.example.com",
		});
	});
});

describe("spanRecord", () => {
	it("encodes an INTERNAL span with derived start time and parent linkage", () => {
		const span = spanRecord(
			makeSpanEvent({
				eventName: "remote.setup.workspace_ready",
				parentEventId: "parent-span-id",
				properties: { result: "success", route: "/api" },
				measurements: { durationMs: 250, retries: 2 },
			}),
		);

		expect(span).toMatchObject({
			traceId: TRACE_ID,
			parentSpanId: "parent-span-id",
			name: "remote.setup.workspace_ready",
			kind: 1, // OTel SpanKind.INTERNAL (0) + 1 OTLP proto offset.
			status: { code: 1 },
		});
		expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(
			250_000_000n,
		);
		expect(attrs(span.attributes)).toEqual({
			"coder.event_name": "remote.setup.workspace_ready",
			...EVENT_CONTEXT_ATTRS,
			result: "success",
			route: "/api",
			retries: 2,
		});
	});

	it("collapses start to end and omits parentSpanId on a minimal span", () => {
		const span = spanRecord(makeSpanEvent());

		expect(span).not.toHaveProperty("parentSpanId");
		expect(span.startTimeUnixNano).toBe(span.endTimeUnixNano);
	});

	it.each([
		[{ properties: { result: "success" } }, { code: 1 }],
		[{ properties: { result: "error" } }, { code: 2 }],
		[
			{ properties: { result: "error" }, error: { message: "boom" } },
			{ code: 2, message: "boom" },
		],
		[{ error: { message: "boom" } }, { code: 2, message: "boom" }],
		[{}, { code: 0 }],
	])("maps span status: %j -> %j", (overrides, expected) => {
		const span = spanRecord(makeSpanEvent(overrides));
		expect(span.status).toEqual(expected);
	});

	it("attaches an `exception` event to errored spans", () => {
		const span = spanRecord(
			makeSpanEvent({
				error: { message: "boom", type: "Error" },
			}),
		);
		const [exception] = span.events ?? [];

		expect(exception.name).toBe("exception");
		expect(exception.timeUnixNano).toBe(span.endTimeUnixNano);
		expect(attrs(exception.attributes)).toEqual({
			"exception.message": "boom",
			"exception.type": "Error",
		});
	});
});

describe("metricRecords", () => {
	it("emits one gauge per measurement when the descriptor has no window", () => {
		const event = makeEvent({
			eventName: "ssh.network.sampled",
			properties: { p2p: "true" },
		});
		const descriptor: MetricDescriptor = {
			measurements: [
				gauge("latencyMs", 35, "ms"),
				gauge("downloadMbits", 10, "Mbit/s"),
			],
		};

		const records = metricRecords(event, descriptor, newCumulativeState());

		expect(records.map((r) => [r.name, r.unit])).toEqual([
			["ssh.network.sampled.latencyMs", "ms"],
			["ssh.network.sampled.downloadMbits", "Mbit/s"],
		]);
		const point = records[0].gauge!.dataPoints[0];
		expect(point).not.toHaveProperty("startTimeUnixNano");
		expect(point).toMatchObject({ asDouble: 35 });
		expect(attrs(point.attributes)).toMatchObject({
			"coder.event_name": "ssh.network.sampled",
			p2p: "true",
		});
	});

	it("accumulates counter values into cumulative monotonic sums anchored at the first window", () => {
		const state = newCumulativeState();
		const first = metricRecords(
			makeEvent({
				eventName: "http.requests",
				properties: { method: "GET", route: "/a" },
				timestamp: "2026-05-04T12:01:00.000Z",
			}),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 2)] },
			state,
		);
		const second = metricRecords(
			makeEvent({
				eventName: "http.requests",
				properties: { method: "GET", route: "/a" },
				timestamp: "2026-05-04T12:02:00.000Z",
			}),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 3)] },
			state,
		);
		// 2026-05-04T12:00:00.000Z (window start = first event time − 60s) in ns:
		const expectedStart = String(
			BigInt(Date.parse("2026-05-04T12:00:00.000Z")) * 1_000_000n,
		);

		expect([
			first[0].sum!.dataPoints[0].asInt,
			second[0].sum!.dataPoints[0].asInt,
		]).toEqual(["2", "5"]);
		expect(first[0].sum!.aggregationTemporality).toBe(2);
		expect(first[0].sum!.isMonotonic).toBe(true);
		expect(first[0].sum!.dataPoints[0].startTimeUnixNano).toBe(expectedStart);
		expect(second[0].sum!.dataPoints[0].startTimeUnixNano).toBe(expectedStart);
	});

	it("clamps startTimeUnixNano <= timeUnixNano for events that arrive before the anchor", () => {
		const state = newCumulativeState();
		// First event lands at T=12:03 with a 60s window → anchor = 12:02.
		metricRecords(
			makeEvent({
				eventName: "http.requests",
				timestamp: "2026-05-04T12:03:00.000Z",
			}),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 1)] },
			state,
		);
		// Out-of-order event at T=12:01:30 (earlier than the anchor).
		const records = metricRecords(
			makeEvent({
				eventName: "http.requests",
				timestamp: "2026-05-04T12:01:30.000Z",
			}),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 1)] },
			state,
		);
		const point = records[0].sum!.dataPoints[0];

		expect(BigInt(point.startTimeUnixNano)).toBeLessThanOrEqual(
			BigInt(point.timeUnixNano),
		);
	});

	it("keeps cumulative totals separate by properties so distinct routes don't merge", () => {
		const state = newCumulativeState();
		const a = metricRecords(
			makeEvent({
				eventName: "http.requests",
				properties: { method: "GET", route: "/api/health" },
			}),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 3)] },
			state,
		);
		// Same eventName and measurement name but a different route must not
		// merge: without property participation in the key, /api/workspaces
		// would inherit /api/health's total.
		const b = metricRecords(
			makeEvent({
				eventName: "http.requests",
				properties: { method: "GET", route: "/api/workspaces" },
			}),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 5)] },
			state,
		);

		expect(a[0].sum!.dataPoints[0].asInt).toBe("3");
		expect(b[0].sum!.dataPoints[0].asInt).toBe("5");
	});

	it("coerces NaN/Infinity inputs to safe zeros instead of throwing", () => {
		// durationMs=NaN in a span; counter=Infinity in a metric; windowSeconds=NaN.
		expect(() =>
			spanRecord(
				makeSpanEvent({
					measurements: { durationMs: NaN, retries: 1 },
				}),
			),
		).not.toThrow();

		const state = newCumulativeState();
		const records = metricRecords(
			makeEvent({ eventName: "http.requests" }),
			{ windowSeconds: NaN, measurements: [counter("count.2xx", Infinity)] },
			state,
		);

		// Infinity counter coerces to 0 → suppressed.
		expect(records).toEqual([]);
	});

	it("stamps gauges with a window start when the descriptor declares one", () => {
		const event = makeEvent({ eventName: "http.requests" });
		const descriptor: MetricDescriptor = {
			windowSeconds: 60,
			measurements: [gauge("p95_duration_ms", 42, "ms")],
		};

		const [record] = metricRecords(event, descriptor, newCumulativeState());
		const point = record.gauge!.dataPoints[0];

		expect(BigInt(point.timeUnixNano) - BigInt(point.startTimeUnixNano!)).toBe(
			60_000_000_000n,
		);
	});

	it("suppresses zero-valued cumulative counters", () => {
		const state: CumulativeState = newCumulativeState();
		const records = metricRecords(
			makeEvent({ eventName: "http.requests" }),
			{
				windowSeconds: 60,
				measurements: [
					counter("count.2xx", 0),
					counter("count.5xx", 0),
					gauge("p95_duration_ms", 10, "ms"),
				],
			},
			state,
		);

		expect(records.map((r) => r.name)).toEqual([
			"http.requests.p95_duration_ms",
		]);
	});

	it("clamps negative counter deltas so the cumulative total never decreases", () => {
		// Without Math.max(0, ...) a negative delta would shrink the total; backends
		// read a decreasing monotonic sum as a counter reset.
		const state = newCumulativeState();
		metricRecords(
			makeEvent({ eventName: "http.requests" }),
			{ windowSeconds: 60, measurements: [counter("count.2xx", 5)] },
			state,
		);
		const [record] = metricRecords(
			makeEvent({ eventName: "http.requests" }),
			{ windowSeconds: 60, measurements: [counter("count.2xx", -3)] },
			state,
		);

		expect(record.sum!.dataPoints[0].asInt).toBe("5");
	});

	it("treats windowSeconds=0 as a zero-width window", () => {
		const [record] = metricRecords(
			makeEvent({ eventName: "http.requests" }),
			{ windowSeconds: 0, measurements: [counter("count.2xx", 1)] },
			newCumulativeState(),
		);
		const point = record.sum!.dataPoints[0];

		expect(point.startTimeUnixNano).toBe(point.timeUnixNano);
	});
});
