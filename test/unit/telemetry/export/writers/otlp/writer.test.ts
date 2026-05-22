import { unzipSync } from "fflate";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeOtlpZipExport } from "@/telemetry/export/writers/otlp/writer";

import { asyncIterable } from "../../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

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

type Rec = Record<string, unknown>;

interface ParsedEnvelope {
	resource: { attributes: unknown };
	schemaUrl: unknown;
	scope: { name: string; version: string };
	records: unknown[];
}

function parseEnvelope(
	files: Record<string, Uint8Array>,
	name: string,
	resourceKey: string,
	scopeKey: string,
	recordsKey: string,
): ParsedEnvelope {
	const env = JSON.parse(new TextDecoder().decode(files[name])) as Rec;
	const wrapper = (env[resourceKey] as Rec[])[0];
	const scopeWrapper = (wrapper[scopeKey] as Rec[])[0];
	return {
		resource: wrapper.resource as { attributes: unknown },
		schemaUrl: wrapper.schemaUrl,
		scope: scopeWrapper.scope as { name: string; version: string },
		records: scopeWrapper[recordsKey] as unknown[],
	};
}

/** Reads the zip and returns the parsed envelope for each signal. */
async function exportAndRead(events: readonly TelemetryEvent[]) {
	const counts = await writeOtlpZipExport(
		OUT,
		asyncIterable(events),
		context,
		() => {},
	);
	const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);
	return {
		counts,
		logs: parseEnvelope(
			files,
			"logs.json",
			"resourceLogs",
			"scopeLogs",
			"logRecords",
		),
		traces: parseEnvelope(
			files,
			"traces.json",
			"resourceSpans",
			"scopeSpans",
			"spans",
		),
		metrics: parseEnvelope(
			files,
			"metrics.json",
			"resourceMetrics",
			"scopeMetrics",
			"metrics",
		),
	};
}

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

describe("writeOtlpZipExport", () => {
	it("packs logs.json, traces.json, and metrics.json into the zip", async () => {
		await writeOtlpZipExport(
			OUT,
			asyncIterable([makeEvent()]),
			context,
			() => {},
		);
		const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);
		expect(Object.keys(files).sort()).toEqual([
			"logs.json",
			"metrics.json",
			"traces.json",
		]);
	});

	it("counts events by signal even when a metric event fans out into multiple records", async () => {
		const { counts, logs, traces, metrics } = await exportAndRead([
			makeEvent({ eventName: "log.info" }),
			makeEvent({ eventName: "log.warn" }),
			makeEvent({ eventName: "trace.x", traceId: TRACE_ID }),
			makeEvent({
				eventName: "http.requests",
				measurements: { window_seconds: 60, count_2xx: 1, p95_duration_ms: 5 },
			}),
		]);

		expect(counts).toEqual({ logs: 2, traces: 1, metrics: 1 });
		expect([
			logs.records.length,
			traces.records.length,
			metrics.records.length,
		]).toEqual([2, 1, 2]);
	});

	it("writes the same resource and scope into every envelope file", async () => {
		const { logs, traces, metrics } = await exportAndRead([
			makeEvent({ eventName: "log.info" }),
			makeEvent({ eventName: "trace.x", traceId: TRACE_ID }),
			makeEvent({
				eventName: "http.requests",
				measurements: { window_seconds: 60, count_2xx: 1 },
			}),
		]);

		const expectedResource = {
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
		};
		const expectedScope = {
			name: "coder.vscode-coder.telemetry.export",
			version: "1.14.5",
		};

		for (const env of [logs, traces, metrics]) {
			expect(attrs(env.resource.attributes)).toEqual(expectedResource);
			expect(env.scope).toEqual(expectedScope);
			expect(env.schemaUrl).toBe("https://opentelemetry.io/schemas/1.24.0");
		}
	});

	it("propagates midstream iterator errors", async () => {
		const failing = (async function* () {
			yield makeEvent();
			await Promise.resolve();
			throw new Error("boom");
		})();

		await expect(
			writeOtlpZipExport(OUT, failing, context, () => {}),
		).rejects.toThrow(/boom/);
	});

	it("wraps per-event mapping failures with the event identity", async () => {
		await expect(
			writeOtlpZipExport(
				OUT,
				asyncIterable([
					makeEvent({ eventId: "id-bad", timestamp: "not-a-date" }),
				]),
				context,
				() => {},
			),
		).rejects.toThrow(
			/Failed to export event id-bad .*Invalid telemetry timestamp/,
		);
	});
});
