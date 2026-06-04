import { unzipSync } from "fflate";
import { vol } from "memfs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENVELOPES } from "@/telemetry/export/writers/otlp/records";
import {
	type OtlpExportCounts,
	writeOtlpZipExport,
} from "@/telemetry/export/writers/otlp/writer";

import { asyncIterable } from "../../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

import {
	GOLDEN_CONTEXT,
	GOLDEN_EVENTS,
	TRACE_ID,
	attrs,
	parseEnvelope,
} from "./helpers";

import type { TelemetryContext, TelemetryEvent } from "@/telemetry/event";
import type {
	ExportDescriptor,
	ExportWriteOptions,
} from "@/telemetry/export/writers/types";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return { ...actual, tmpdir: () => "/tmp" };
});

const OUT = "/exports/telemetry.otlp.zip";
/** Matches what writer.ts passes to fs.mkdtemp on every platform. */
const STAGING_PREFIX = path.join("/tmp", "coder-telemetry-otlp-");

const DESCRIPTOR: ExportDescriptor = {
	range: {
		label: "Last 24 hours",
		filenamePart: "last-24-hours",
		startMs: 0,
		endMs: 86_400_000,
	},
	sourceFiles: 2,
};

const makeEvent = createTelemetryEventFactory();
const { context } = makeEvent();

beforeEach(() => {
	vol.reset();
	vol.mkdirSync("/exports", { recursive: true });
	vol.mkdirSync("/tmp", { recursive: true });
});

afterEach(() => vol.reset());

/** Exports to OUT with the default descriptor; tests override events/options/context. */
function writeZip(
	events: AsyncIterable<TelemetryEvent> | readonly TelemetryEvent[],
	options: ExportWriteOptions = {},
	ctx: TelemetryContext = context,
): Promise<OtlpExportCounts> {
	const stream =
		Symbol.asyncIterator in events ? events : asyncIterable(events);
	return writeOtlpZipExport(OUT, stream, ctx, DESCRIPTOR, options);
}

/** Reads the zip and returns the parsed envelope for each signal. */
async function exportAndRead(events: readonly TelemetryEvent[]) {
	const counts = await writeZip(events);
	const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);
	return {
		counts,
		logs: parseEnvelope(files, "logs"),
		traces: parseEnvelope(files, "traces"),
		metrics: parseEnvelope(files, "metrics"),
	};
}

describe("writeOtlpZipExport", () => {
	it("packs the three signal envelopes plus the manifest into the zip", async () => {
		await writeZip([makeEvent()]);
		const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);
		expect(Object.keys(files).sort()).toEqual(
			[...Object.values(ENVELOPES).map((e) => e.file), "manifest.json"].sort(),
		);
	});

	// Golden files capture the full serialized envelope per signal so schema
	// changes show up as a reviewable JSON diff. Regenerate with `pnpm test ... -u`.
	it("matches the golden OTLP envelopes for a representative export", async () => {
		await writeZip(Object.values(GOLDEN_EVENTS), {}, GOLDEN_CONTEXT);
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
			makeEvent({
				eventName: "trace.x",
				traceId: TRACE_ID,
				properties: { result: "success" },
			}),
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
			makeEvent({
				eventName: "trace.x",
				traceId: TRACE_ID,
				properties: { result: "success" },
			}),
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

		await expect(writeZip(failing)).rejects.toThrow(/boom/);
	});

	it("wraps per-event mapping failures with the event identity", async () => {
		await expect(
			writeZip([makeEvent({ eventId: "id-bad", timestamp: "not-a-date" })]),
		).rejects.toThrow(
			/Failed to export event id-bad .*Invalid telemetry timestamp/,
		);
	});

	it("stages envelopes under os.tmpdir(), not next to the user's save path", async () => {
		const fsPromises = await import("node:fs/promises");
		const mkdtempSpy = vi.spyOn(fsPromises, "mkdtemp");

		try {
			await writeZip([makeEvent()]);

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

	it("reports staging cleanup failures via onCleanupError instead of masking success", async () => {
		const fsPromises = await import("node:fs/promises");
		const cleanupErrors: Array<{ err: unknown; dir: string }> = [];
		const spy = vi
			.spyOn(fsPromises, "rm")
			.mockRejectedValueOnce(
				Object.assign(new Error("EBUSY"), { code: "EBUSY" }),
			);

		try {
			const counts = await writeZip([makeEvent()], {
				onCleanupError: (err, dir) => cleanupErrors.push({ err, dir }),
			});

			expect(counts.logs).toBe(1);
			expect(cleanupErrors).toHaveLength(1);
			expect(cleanupErrors[0].dir.startsWith(STAGING_PREFIX)).toBe(true);
			expect((cleanupErrors[0].err as Error).message).toMatch(/EBUSY/);
		} finally {
			spy.mockRestore();
		}
	});

	it("does not surface onCleanupError throws to callers", async () => {
		const fsPromises = await import("node:fs/promises");
		const spy = vi
			.spyOn(fsPromises, "rm")
			.mockRejectedValueOnce(new Error("EBUSY"));

		try {
			const counts = await writeZip([makeEvent()], {
				onCleanupError: () => {
					throw new Error("logger blew up");
				},
			});
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

		await expect(writeZip(events, { signal: ac.signal })).rejects.toMatchObject(
			{ name: "AbortError" },
		);
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

		await expect(writeZip(events, { signal: ac.signal })).rejects.toMatchObject(
			{ name: "AbortError" },
		);
	});

	it("coerces non-Error abort reasons into a named AbortError", async () => {
		const ac = new AbortController();
		ac.abort("user cancelled");

		await expect(
			writeZip([makeEvent()], { signal: ac.signal }),
		).rejects.toMatchObject({ name: "AbortError", message: "Aborted" });
	});
});

describe("writeOtlpZipExport manifest", () => {
	interface Manifest {
		schemaVersion: number;
		telemetrySchemaVersion: number;
		format: string;
		sourceFiles: number;
		sourceEvents: number;
		records: { logs: number; traces: number; metrics: number };
		range: { label: string; start: string | null; end: string | null };
	}

	async function exportWithManifest(
		events: readonly TelemetryEvent[],
	): Promise<{ files: Record<string, Uint8Array>; manifest: Manifest }> {
		await writeZip(events);
		const files = unzipSync(vol.readFileSync(OUT) as Uint8Array);
		const manifest = JSON.parse(
			new TextDecoder().decode(files["manifest.json"]),
		) as Manifest;
		return { files, manifest };
	}

	it("reports record counts, source totals, and range in the manifest", async () => {
		const { manifest } = await exportWithManifest([
			makeEvent({ eventName: "log.info" }),
			makeEvent({
				eventName: "trace.x",
				traceId: TRACE_ID,
				properties: { result: "success" },
			}),
			makeEvent({
				eventName: "http.requests",
				measurements: {
					window_seconds: 60,
					"count.2xx": 1,
					"duration.p95_ms": 5,
				},
			}),
		]);

		expect(manifest).toMatchObject({
			format: "otlp-json",
			sourceFiles: 2,
			sourceEvents: 3,
			records: { logs: 1, traces: 1, metrics: 2 },
			range: {
				label: "Last 24 hours",
				start: "1970-01-01T00:00:00.000Z",
				end: "1970-01-02T00:00:00.000Z",
			},
		});
	});

	it("stamps both the manifest and telemetry schema versions", async () => {
		const { manifest } = await exportWithManifest([makeEvent()]);

		expect(manifest.schemaVersion).toBeGreaterThanOrEqual(1);
		expect(manifest.telemetrySchemaVersion).toBeGreaterThanOrEqual(1);
	});
});
