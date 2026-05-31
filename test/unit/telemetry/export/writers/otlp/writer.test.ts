import { unzipSync } from "fflate";
import { vol } from "memfs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENVELOPES } from "@/telemetry/export/writers/otlp/records";
import { writeOtlpZipExport } from "@/telemetry/export/writers/otlp/writer";

import { asyncIterable } from "../../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

import {
	GOLDEN_CONTEXT,
	GOLDEN_EVENTS,
	TRACE_ID,
	attrs,
	parseEnvelope,
} from "./helpers";

import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return { ...actual, tmpdir: () => "/tmp" };
});

const OUT = "/exports/telemetry.otlp.zip";
/** Matches what writer.ts passes to fs.mkdtemp on every platform. */
const STAGING_PREFIX = path.join("/tmp", "coder-telemetry-otlp-");

const makeEvent = createTelemetryEventFactory();
const { context } = makeEvent();

beforeEach(() => {
	vol.reset();
	vol.mkdirSync("/exports", { recursive: true });
	vol.mkdirSync("/tmp", { recursive: true });
});

afterEach(() => vol.reset());

/** Reads the zip and returns the parsed envelope for each signal. */
async function exportAndRead(events: readonly TelemetryEvent[]) {
	const counts = await writeOtlpZipExport(OUT, asyncIterable(events), context);
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
		await writeOtlpZipExport(OUT, asyncIterable([makeEvent()]), context);
		const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);
		expect(Object.keys(files).sort()).toEqual(
			Object.values(ENVELOPES)
				.map((e) => e.file)
				.sort(),
		);
	});

	// Golden files capture the full serialized envelope per signal so schema
	// changes show up as a reviewable JSON diff. Regenerate with `pnpm test ... -u`.
	it("matches the golden OTLP envelopes for a representative export", async () => {
		await writeOtlpZipExport(
			OUT,
			asyncIterable(Object.values(GOLDEN_EVENTS)),
			GOLDEN_CONTEXT,
		);
		const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);

		for (const { file } of Object.values(ENVELOPES)) {
			const pretty = JSON.stringify(
				JSON.parse(new TextDecoder().decode(files[file])),
				null,
				2,
			);
			await expect(pretty).toMatchFileSnapshot(`./__golden__/envelope-${file}`);
		}
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

		await expect(writeOtlpZipExport(OUT, failing, context)).rejects.toThrow(
			/boom/,
		);
	});

	it("wraps per-event mapping failures with the event identity", async () => {
		await expect(
			writeOtlpZipExport(
				OUT,
				asyncIterable([
					makeEvent({ eventId: "id-bad", timestamp: "not-a-date" }),
				]),
				context,
			),
		).rejects.toThrow(
			/Failed to export event id-bad .*Invalid telemetry timestamp/,
		);
	});

	it("stages envelopes under os.tmpdir(), not next to the user's save path", async () => {
		const fsPromises = await import("node:fs/promises");
		const mkdtempSpy = vi.spyOn(fsPromises, "mkdtemp");

		try {
			await writeOtlpZipExport(OUT, asyncIterable([makeEvent()]), context);

			expect(vol.readdirSync("/exports")).toEqual(["telemetry.otlp.zip"]);
			expect(mkdtempSpy).toHaveBeenCalledWith(STAGING_PREFIX);
		} finally {
			mkdtempSpy.mockRestore();
		}
	});

	it("counts metric events even when every record is suppressed", async () => {
		// A window with only zero counters emits no records, but JSON and OTLP
		// totals must still agree on event count.
		const { counts, metrics } = await exportAndRead([
			makeEvent({
				eventName: "http.requests",
				measurements: { window_seconds: 60, "count.2xx": 0 },
			}),
		]);

		expect(counts).toEqual({ logs: 0, traces: 0, metrics: 1 });
		expect(metrics.records).toEqual([]);
	});

	it("reports staging cleanup failures via onStagingCleanupError instead of masking success", async () => {
		const fsPromises = await import("node:fs/promises");
		const cleanupErrors: Array<{ err: unknown; dir: string }> = [];
		const spy = vi
			.spyOn(fsPromises, "rm")
			.mockRejectedValueOnce(
				Object.assign(new Error("EBUSY"), { code: "EBUSY" }),
			);

		try {
			const counts = await writeOtlpZipExport(
				OUT,
				asyncIterable([makeEvent()]),
				context,
				{
					onStagingCleanupError: (err, dir) => cleanupErrors.push({ err, dir }),
				},
			);

			expect(counts.logs).toBe(1);
			expect(cleanupErrors).toHaveLength(1);
			expect(cleanupErrors[0].dir.startsWith(STAGING_PREFIX)).toBe(true);
			expect((cleanupErrors[0].err as Error).message).toMatch(/EBUSY/);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not surface onStagingCleanupError throws to callers", async () => {
		const fsPromises = await import("node:fs/promises");
		const spy = vi
			.spyOn(fsPromises, "rm")
			.mockRejectedValueOnce(new Error("EBUSY"));

		try {
			const counts = await writeOtlpZipExport(
				OUT,
				asyncIterable([makeEvent()]),
				context,
				{
					onStagingCleanupError: () => {
						throw new Error("logger blew up");
					},
				},
			);
			expect(counts.logs).toBe(1);
		} finally {
			spy.mockRestore();
		}
	});

	it("aborts the export when the signal fires between events", async () => {
		const ac = new AbortController();
		const events = (async function* () {
			yield makeEvent();
			await Promise.resolve();
			ac.abort();
			yield makeEvent();
		})();

		await expect(
			writeOtlpZipExport(OUT, events, context, { signal: ac.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("preserves AbortError name when cancellation fires during zip packing", async () => {
		// Abort after events drain but before fflate finalizes; the cancellation
		// must not be wrapped by packZip's outer wrapError.
		const ac = new AbortController();
		const events = (async function* () {
			yield makeEvent();
			await Promise.resolve();
			ac.abort();
		})();

		await expect(
			writeOtlpZipExport(OUT, events, context, { signal: ac.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("coerces non-Error abort reasons into a named AbortError", async () => {
		const ac = new AbortController();
		ac.abort("user cancelled");

		await expect(
			writeOtlpZipExport(OUT, asyncIterable([makeEvent()]), context, {
				signal: ac.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError", message: "Aborted" });
	});
});
