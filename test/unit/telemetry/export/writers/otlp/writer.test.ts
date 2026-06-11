import { unzipSync, type DeflateOptions } from "fflate";
import { vol } from "memfs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENVELOPES } from "@/telemetry/export/writers/otlp/records";
import {
	MAX_BUFFERED_METRIC_POINTS,
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

/** Constructor options of every ZipDeflate created during a test. */
const zipDeflateOptions = vi.hoisted(() => ({
	current: [] as Array<{ level?: number } | undefined>,
}));
vi.mock("fflate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fflate")>();
	class RecordingZipDeflate extends actual.ZipDeflate {
		constructor(filename: string, opts?: DeflateOptions) {
			super(filename, opts);
			zipDeflateOptions.current.push(opts);
		}
	}
	return { ...actual, ZipDeflate: RecordingZipDeflate };
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

/** Shape of a grouped metric record as read back from `metrics.json`. */
interface MetricRecord {
	name: string;
	sum?: { dataPoints: Array<{ asInt: string }> };
	gauge?: { dataPoints: Array<{ asDouble: number }> };
}

beforeEach(() => {
	vol.reset();
	vol.mkdirSync("/exports", { recursive: true });
	vol.mkdirSync("/tmp", { recursive: true });
	zipDeflateOptions.current = [];
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

	it("produces envelopes with no resource blocks for an empty event stream", async () => {
		const { counts, logs, traces, metrics } = await exportAndRead([]);

		expect(counts).toEqual({ logs: 0, traces: 0, metrics: 0 });
		expect(logs.blocks).toEqual([]);
		expect(traces.blocks).toEqual([]);
		expect(metrics.blocks).toEqual([]);
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
			expect(other.blocks[0].resource).toEqual(logs.blocks[0].resource);
			expect(other.blocks[0].scope).toEqual(logs.blocks[0].scope);
			expect(other.blocks[0].schemaUrl).toBe(logs.blocks[0].schemaUrl);
		}
		// Spot-check the resource carries the extension identity; full shape is
		// asserted in records.test.ts.
		expect(attrs(logs.blocks[0].resource.attributes)).toMatchObject({
			"service.name": "coder-vscode-extension",
			"service.version": "1.14.5",
		});
	});

	it("starts a new resource block when the producing session changes", async () => {
		const withSession = (sessionId: string) =>
			makeEvent({ context: { ...context, sessionId } });
		const { logs } = await exportAndRead([
			withSession("session-a"),
			withSession("session-a"),
			withSession("session-b"),
		]);

		expect(logs.blocks).toHaveLength(2);
		expect(logs.blocks[0].records).toHaveLength(2);
		expect(logs.blocks[1].records).toHaveLength(1);
		expect(
			logs.blocks.map(
				(block) => attrs(block.resource.attributes)["service.instance.id"],
			),
		).toEqual(["session-a", "session-b"]);
	});

	it("attributes each block to the producing event's context, not the exporter's", async () => {
		const producer = {
			...context,
			extensionVersion: "0.9.0",
			sessionId: "older-session",
			deploymentUrl: "https://prev.coder.example.com",
		};
		// exportAndRead exports with the factory-default context as the exporter.
		const { logs } = await exportAndRead([makeEvent({ context: producer })]);

		expect(attrs(logs.blocks[0].resource.attributes)).toMatchObject({
			"service.version": "0.9.0",
			"service.instance.id": "older-session",
			"coder.deployment.url": "https://prev.coder.example.com",
		});
		// The scope still identifies the exporting extension.
		expect(logs.blocks[0].scope.version).toBe("1.14.5");
	});

	it("starts a new resource block when the event date changes within a session", async () => {
		const { logs } = await exportAndRead([
			makeEvent({ timestamp: "2026-05-04T23:59:00.000Z" }),
			makeEvent({ timestamp: "2026-05-05T00:01:00.000Z" }),
		]);

		expect(logs.blocks).toHaveLength(2);
		expect(logs.blocks[1].resource).toEqual(logs.blocks[0].resource);
	});

	it("groups metric data points under one metric per series within a block", async () => {
		const { counts, metrics } = await exportAndRead([
			makeEvent({
				eventName: "http.requests",
				timestamp: "2026-05-04T12:01:00.000Z",
				measurements: {
					window_seconds: 60,
					"count.2xx": 2,
					"duration.p95_ms": 5,
				},
			}),
			makeEvent({
				eventName: "http.requests",
				timestamp: "2026-05-04T12:02:00.000Z",
				measurements: {
					window_seconds: 60,
					"count.2xx": 3,
					"duration.p95_ms": 7,
				},
			}),
		]);

		expect(counts.metrics).toBe(2);
		expect(metrics.blocks).toHaveLength(1);
		const records = metrics.blocks[0].records as MetricRecord[];
		const byName = new Map(records.map((r) => [r.name, r]));
		expect(records).toHaveLength(2);
		expect(
			byName
				.get("http.requests.count.2xx")!
				.sum!.dataPoints.map((p) => p.asInt),
		).toEqual(["2", "5"]);
		expect(
			byName
				.get("http.requests.duration.p95")!
				.gauge!.dataPoints.map((p) => p.asDouble),
		).toEqual([5, 7]);
	});

	it("force-flushes the metric buffer at the point cap within one block", async () => {
		const events = Array.from({ length: MAX_BUFFERED_METRIC_POINTS + 1 }, () =>
			makeEvent({
				eventName: "http.requests",
				timestamp: "2026-05-04T12:01:00.000Z",
				measurements: { window_seconds: 60, "count.2xx": 1 },
			}),
		);

		const { metrics } = await exportAndRead(events);

		// The capped series splits into a second entry in the same block.
		expect(metrics.blocks).toHaveLength(1);
		const records = metrics.blocks[0].records as MetricRecord[];
		expect(records.map((r) => r.name)).toEqual([
			"http.requests.count.2xx",
			"http.requests.count.2xx",
		]);
		expect(records.flatMap((r) => r.sum!.dataPoints)).toHaveLength(
			MAX_BUFFERED_METRIC_POINTS + 1,
		);
	});

	it("resets cumulative counter totals at each block boundary", async () => {
		const httpEvent = (sessionId: string, timestamp: string, count: number) =>
			makeEvent({
				eventName: "http.requests",
				timestamp,
				context: { ...context, sessionId },
				measurements: { window_seconds: 60, "count.2xx": count },
			});
		const { metrics } = await exportAndRead([
			httpEvent("session-a", "2026-05-04T12:01:00.000Z", 2),
			httpEvent("session-a", "2026-05-04T12:02:00.000Z", 3),
			httpEvent("session-b", "2026-05-04T12:03:00.000Z", 7),
		]);

		expect(metrics.blocks).toHaveLength(2);
		const [a] = metrics.blocks[0].records as MetricRecord[];
		const [b] = metrics.blocks[1].records as MetricRecord[];
		expect(a.sum!.dataPoints.map((p) => p.asInt)).toEqual(["2", "5"]);
		// Session B starts its own total instead of inheriting session A's 5.
		expect(b.sum!.dataPoints.map((p) => p.asInt)).toEqual(["7"]);
	});

	it("compresses every zip entry at maximum deflate level", async () => {
		await writeZip([makeEvent()]);

		// Three envelopes plus the manifest.
		expect(zipDeflateOptions.current).toHaveLength(4);
		for (const options of zipDeflateOptions.current) {
			expect(options).toEqual({ level: 9 });
		}
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
