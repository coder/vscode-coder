import { unzipSync } from "fflate";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeOtlpZipExport } from "@/telemetry/export/writers/otlp";

import { asyncIterable } from "../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../mocks/telemetry";

import type { TelemetryContext, TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const OUT = "/exports/telemetry.otlp.zip";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let makeEvent: ReturnType<typeof createTelemetryEventFactory>;
let context: TelemetryContext;

beforeEach(() => {
	vol.reset();
	vol.mkdirSync("/exports", { recursive: true });
	makeEvent = createTelemetryEventFactory();
	context = makeEvent().context;
});

afterEach(() => vol.reset());

/** Flatten OTLP `[{key, value: {stringValue|doubleValue}}]` to `{key: value}`. */
function attrs(raw: unknown): Record<string, string | number> {
	const list = raw as Array<{
		key: string;
		value: { stringValue?: string; doubleValue?: number };
	}>;
	return Object.fromEntries(
		list.map((a) => [a.key, a.value.doubleValue ?? a.value.stringValue!]),
	);
}

type RawRecord = Record<string, unknown>;

interface LogsFile {
	resourceLogs: [
		{
			resource: { attributes: unknown };
			scopeLogs: [{ logRecords: RawRecord[] }];
		},
	];
}
interface TracesFile {
	resourceSpans: [{ scopeSpans: [{ spans: RawRecord[] }] }];
}
interface MetricsFile {
	resourceMetrics: [{ scopeMetrics: [{ metrics: RawRecord[] }] }];
}

interface Captured {
	counts: Awaited<ReturnType<typeof writeOtlpZipExport>>;
	logResource: { attributes: unknown };
	logs: RawRecord[];
	spans: RawRecord[];
	metrics: RawRecord[];
}

const noopCleanup = () => {};

/** Writes `events` through the public API and reads the resulting envelopes. */
async function capture(events: readonly TelemetryEvent[]): Promise<Captured> {
	const counts = await writeOtlpZipExport(
		OUT,
		asyncIterable(events),
		context,
		noopCleanup,
	);
	const zip = unzipSync(vol.readFileSync(OUT) as Uint8Array);
	const parse = <T>(file: string): T =>
		JSON.parse(new TextDecoder().decode(zip[file])) as T;

	const logs = parse<LogsFile>("logs.json").resourceLogs[0];
	const traces = parse<TracesFile>("traces.json").resourceSpans[0];
	const metrics = parse<MetricsFile>("metrics.json").resourceMetrics[0];

	return {
		counts,
		logResource: logs.resource,
		logs: logs.scopeLogs[0].logRecords,
		spans: traces.scopeSpans[0].spans,
		metrics: metrics.scopeMetrics[0].metrics,
	};
}

describe("writeOtlpZipExport: resource", () => {
	it("emits service, OS, host, vscode, and coder attributes from the context", async () => {
		const { logResource } = await capture([makeEvent()]);

		expect(attrs(logResource.attributes)).toEqual({
			"service.name": "coder-vscode-extension",
			"service.version": "1.14.5",
			"coder.machine.id": "machine-id",
			"coder.session.id": "session-id",
			"os.type": "linux",
			"os.version": "6.0.0",
			"host.arch": "x64",
			"vscode.platform.name": "Visual Studio Code",
			"vscode.platform.version": "1.106.0",
			"coder.deployment.url": "https://coder.example.com",
		});
	});
});

describe("writeOtlpZipExport: logs", () => {
	it("emits INFO records with merged properties and measurements", async () => {
		const { logs } = await capture([
			makeEvent({
				eventName: "log.info",
				properties: { source: "unit" },
				measurements: { count: 3 },
			}),
		]);

		expect(logs[0]).toMatchObject({
			severityNumber: 9,
			severityText: "INFO",
			body: { stringValue: "log.info" },
		});
		expect(logs[0].timeUnixNano).toBe(logs[0].observedTimeUnixNano);
		expect(attrs(logs[0].attributes)).toEqual({ source: "unit", count: 3 });
	});

	it("emits ERROR records with optional exception fields skipped when unset", async () => {
		const { logs } = await capture([
			makeEvent({
				error: { message: "boom", type: "RangeError", code: "E_RANGE" },
			}),
			makeEvent({ error: { message: "boom" } }),
		]);

		expect(logs[0]).toMatchObject({
			severityNumber: 17,
			severityText: "ERROR",
		});
		expect(attrs(logs[0].attributes)).toMatchObject({
			"exception.message": "boom",
			"exception.type": "RangeError",
			"exception.code": "E_RANGE",
		});
		expect(attrs(logs[1].attributes)).toEqual({ "exception.message": "boom" });
	});
});

describe("writeOtlpZipExport: spans", () => {
	it("emits an INTERNAL span with derived start time and parent linkage", async () => {
		const { spans } = await capture([
			makeEvent({
				eventName: "remote.setup.workspace_ready",
				traceId: TRACE_ID,
				parentEventId: "parent-span-id",
				properties: { result: "success", route: "/api" },
				measurements: { durationMs: 250, retries: 2 },
			}),
		]);

		expect(spans[0]).toMatchObject({
			traceId: TRACE_ID,
			parentSpanId: "parent-span-id",
			name: "remote.setup.workspace_ready",
			kind: 1, // OTel api SpanKind.INTERNAL (0) + 1 for the OTLP proto offset
			status: { code: 1 },
		});
		expect(
			BigInt(spans[0].endTimeUnixNano as string) -
				BigInt(spans[0].startTimeUnixNano as string),
		).toBe(250_000_000n);
		expect(attrs(spans[0].attributes)).toEqual({
			"coder.event_name": "remote.setup.workspace_ready",
			result: "success",
			route: "/api",
			retries: 2,
		});
	});

	it("collapses start to end and omits parentSpanId on a minimal span", async () => {
		const { spans } = await capture([makeEvent({ traceId: TRACE_ID })]);

		expect(spans[0]).not.toHaveProperty("parentSpanId");
		expect(spans[0].startTimeUnixNano).toBe(spans[0].endTimeUnixNano);
	});

	it.each([
		[{ properties: { result: "success" } }, { code: 1 }],
		[{ properties: { result: "error" } }, { code: 2 }],
		[{ error: { message: "boom" } }, { code: 2, message: "boom" }],
		[{}, { code: 0 }],
	])("maps span status: %j -> %j", async (overrides, expected) => {
		const { spans } = await capture([
			makeEvent({ traceId: TRACE_ID, ...overrides }),
		]);
		expect(spans[0].status).toEqual(expected);
	});

	it("attaches an `exception` event when the event has an error", async () => {
		const { spans } = await capture([
			makeEvent({
				traceId: TRACE_ID,
				error: { message: "boom", type: "Error" },
			}),
		]);
		const [exceptionEvent] = spans[0].events as Array<{
			name: string;
			timeUnixNano: string;
			attributes: unknown;
		}>;

		expect(exceptionEvent.name).toBe("exception");
		expect(exceptionEvent.timeUnixNano).toBe(spans[0].endTimeUnixNano);
		expect(attrs(exceptionEvent.attributes)).toEqual({
			"exception.message": "boom",
			"exception.type": "Error",
		});
	});
});

describe("writeOtlpZipExport: metrics", () => {
	it("emits one gauge per measurement for non-http events, with no startTimeUnixNano", async () => {
		const { metrics } = await capture([
			makeEvent({
				eventName: "ssh.network.sampled",
				properties: { p2p: "true" },
				measurements: { latencyMs: 35, downloadMbits: 10 },
			}),
		]);

		expect(metrics.map((m) => [m.name, m.unit])).toEqual([
			["ssh.network.sampled.latencyMs", "ms"],
			["ssh.network.sampled.downloadMbits", "Mbit/s"],
		]);
		const [point] = (metrics[0].gauge as { dataPoints: [unknown] }).dataPoints;
		expect(point).not.toHaveProperty("startTimeUnixNano");
		expect(point).toMatchObject({ asDouble: 35 });
		expect(attrs((point as { attributes: unknown }).attributes)).toMatchObject({
			"coder.event_name": "ssh.network.sampled",
			p2p: "true",
		});
	});

	it("splits http.requests into monotonic count sums and gauges sharing the window", async () => {
		const { metrics } = await capture([
			makeEvent({
				eventName: "http.requests",
				measurements: { window_seconds: 60, count_2xx: 2, p95_duration_ms: 42 },
			}),
		]);
		const count = metrics[0].sum as {
			aggregationTemporality: number;
			isMonotonic: boolean;
			dataPoints: [
				{ asInt: string; startTimeUnixNano: string; timeUnixNano: string },
			];
		};
		const p95Point = (
			metrics[1].gauge as { dataPoints: [{ startTimeUnixNano: string }] }
		).dataPoints[0];

		expect(metrics.map((m) => [m.name, m.unit])).toEqual([
			["http.requests.count_2xx", "{request}"],
			["http.requests.p95_duration_ms", "ms"],
		]);
		expect(count).toMatchObject({
			aggregationTemporality: 1,
			isMonotonic: true,
		});
		expect(count.dataPoints[0].asInt).toBe("2");
		expect(
			BigInt(count.dataPoints[0].timeUnixNano) -
				BigInt(count.dataPoints[0].startTimeUnixNano),
		).toBe(60_000_000_000n);
		expect(p95Point.startTimeUnixNano).toBe(
			count.dataPoints[0].startTimeUnixNano,
		);
	});

	it("treats http.requests without window_seconds as a zero-width window", async () => {
		const { metrics } = await capture([
			makeEvent({
				eventName: "http.requests",
				measurements: { count_2xx: 1 },
			}),
		]);
		const point = (
			metrics[0].sum as {
				dataPoints: [{ startTimeUnixNano: string; timeUnixNano: string }];
			}
		).dataPoints[0];

		expect(point.startTimeUnixNano).toBe(point.timeUnixNano);
	});

	it.each([
		["latency_ms", "ms"],
		["durationMs", "ms"],
		["downloadMbits", "Mbit/s"],
		["something", "1"],
	])("derives unit for measurement '%s' -> '%s'", async (measurement, unit) => {
		const { metrics } = await capture([
			makeEvent({
				eventName: "ssh.network.sampled",
				measurements: { [measurement]: 1 },
			}),
		]);
		expect(metrics[0].unit).toBe(unit);
	});
});

describe("writeOtlpZipExport: routing & counts", () => {
	it("counts events routed to each signal, even when one event fans out into multiple records", async () => {
		const { counts, logs, spans, metrics } = await capture([
			makeEvent({ eventName: "log.info" }),
			makeEvent({ eventName: "log.warn" }),
			makeEvent({ eventName: "trace.x", traceId: TRACE_ID }),
			makeEvent({
				eventName: "http.requests",
				measurements: { window_seconds: 60, count_2xx: 1, p95_duration_ms: 5 },
			}),
		]);

		expect(counts).toEqual({ logs: 2, traces: 1, metrics: 1 });
		expect(logs).toHaveLength(2);
		expect(spans).toHaveLength(1);
		expect(metrics).toHaveLength(2);
	});

	it("propagates midstream errors", async () => {
		const failing = (async function* () {
			yield makeEvent();
			await Promise.resolve();
			throw new Error("boom");
		})();

		await expect(
			writeOtlpZipExport(OUT, failing, context, noopCleanup),
		).rejects.toThrow(/boom/);
	});

	it("rejects on an unparseable event timestamp", async () => {
		await expect(
			writeOtlpZipExport(
				OUT,
				asyncIterable([makeEvent({ timestamp: "not-a-date" })]),
				context,
				noopCleanup,
			),
		).rejects.toThrow(/Invalid telemetry timestamp/);
	});
});
