import { unzipSync } from "fflate";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENVELOPES } from "@/telemetry/export/writers/otlp/records";
import { writeOtlpZipExport } from "@/telemetry/export/writers/otlp/writer";

import { asyncIterable } from "../../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

import { TRACE_ID, attrs, parseEnvelope } from "./helpers";

import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const OUT = "/exports/telemetry.otlp.zip";

const makeEvent = createTelemetryEventFactory();
const { context } = makeEvent();

beforeEach(() => {
	vol.reset();
	vol.mkdirSync("/exports", { recursive: true });
});

afterEach(() => vol.reset());

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
		logs: parseEnvelope(files, "logs"),
		traces: parseEnvelope(files, "traces"),
		metrics: parseEnvelope(files, "metrics"),
	};
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
		expect(Object.keys(files).sort()).toEqual(
			Object.values(ENVELOPES)
				.map((e) => e.file)
				.sort(),
		);
	});

	it("produces three empty-array envelopes for an empty event stream", async () => {
		const { counts, logs, traces, metrics } = await exportAndRead([]);

		expect(counts).toEqual({ logs: 0, traces: 0, metrics: 0 });
		expect(logs.records).toEqual([]);
		expect(traces.records).toEqual([]);
		expect(metrics.records).toEqual([]);
	});

	it("routes metric-named events to metrics even when a traceId is present", async () => {
		const { counts, traces, metrics } = await exportAndRead([
			makeEvent({
				eventName: "http.requests",
				traceId: TRACE_ID,
				measurements: { window_seconds: 60, "count.2xx": 1 },
			}),
		]);

		expect(counts).toEqual({ logs: 0, traces: 0, metrics: 1 });
		expect(traces.records).toEqual([]);
		expect(metrics.records.length).toBeGreaterThan(0);
	});

	it("counts events by signal even when a metric event fans out into multiple records", async () => {
		const { counts, logs, traces, metrics } = await exportAndRead([
			makeEvent({ eventName: "log.info" }),
			makeEvent({ eventName: "log.warn" }),
			makeEvent({ eventName: "trace.x", traceId: TRACE_ID }),
			makeEvent({
				eventName: "http.requests",
				measurements: {
					window_seconds: 60,
					"count.2xx": 1,
					"duration.p95_ms": 5,
				},
			}),
		]);

		expect(counts).toEqual({ logs: 2, traces: 1, metrics: 1 });
		expect([
			logs.records.length,
			traces.records.length,
			metrics.records.length,
		]).toEqual([2, 1, 2]);
	});

	it("writes identical resource, scope, and schemaUrl into every envelope file", async () => {
		const { logs, traces, metrics } = await exportAndRead([
			makeEvent({ eventName: "log.info" }),
			makeEvent({ eventName: "trace.x", traceId: TRACE_ID }),
			makeEvent({
				eventName: "http.requests",
				measurements: { window_seconds: 60, "count.2xx": 1 },
			}),
		]);

		for (const other of [traces, metrics]) {
			expect(other.resource).toEqual(logs.resource);
			expect(other.scope).toEqual(logs.scope);
			expect(other.schemaUrl).toBe(logs.schemaUrl);
		}
		// Spot-check the resource carries the extension identity; full shape is
		// asserted in records.test.ts.
		expect(attrs(logs.resource.attributes)).toMatchObject({
			"service.name": "coder-vscode-extension",
			"service.version": "1.14.5",
		});
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
