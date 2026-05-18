import { unzipSync } from "fflate";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toStoredTelemetryEvent } from "@/telemetry/export/files";
import {
	writeJsonArrayExport,
	writeOtlpZipExport,
} from "@/telemetry/export/writers";

import type { ExportTelemetryEvent } from "@/telemetry/export/types";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "telemetry-export-writers-"),
	);
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("telemetry export writers", () => {
	it("writes telemetry events as a JSON array using the stored event shape", async () => {
		const outputPath = path.join(tmpDir, "telemetry.json");

		const events = [
			makeEvent({
				eventId: "1111111111111111",
				eventName: "first",
				properties: { result: "success" },
				measurements: { durationMs: 12 },
				traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
			makeEvent({
				eventId: "2222222222222222",
				eventName: "second",
				parentEventId: "1111111111111111",
				error: { message: "boom", type: "Error" },
			}),
		];

		const counts = await writeJsonArrayExport(outputPath, asyncEvents(events));

		expect(counts.events).toBe(2);
		expect(JSON.parse(await fs.readFile(outputPath, "utf8"))).toEqual(
			events.map(toStoredTelemetryEvent),
		);
	});

	it("writes a valid empty JSON array", async () => {
		const outputPath = path.join(tmpDir, "empty.json");

		const counts = await writeJsonArrayExport(outputPath, asyncEvents([]));

		expect(counts.events).toBe(0);
		expect(JSON.parse(await fs.readFile(outputPath, "utf8"))).toEqual([]);
	});

	it("writes a zip with POST-ready OTLP JSON files", async () => {
		const outputPath = path.join(tmpDir, "telemetry.otlp.zip");
		const events = [
			makeEvent({
				eventId: "1111111111111111",
				eventName: "log.info",
				properties: { source: "unit" },
			}),
			makeEvent({
				eventId: "2222222222222222",
				eventName: "remote.setup.workspace_ready",
				traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				properties: { result: "success" },
				measurements: { durationMs: 250 },
			}),
			makeEvent({
				eventId: "3333333333333333",
				eventName: "http.requests",
				properties: { method: "GET", route: "/api/v2/workspaces/{id}" },
				measurements: {
					window_seconds: 60,
					count_2xx: 2,
					count_5xx: 1,
					p95_duration_ms: 42,
				},
			}),
			makeEvent({
				eventId: "4444444444444444",
				eventName: "ssh.network.sampled",
				properties: { p2p: "true" },
				measurements: { latencyMs: 35, downloadMbits: 10, uploadMbits: 5 },
			}),
		];

		const counts = await writeOtlpZipExport(outputPath, asyncEvents(events));

		expect(counts).toEqual({ events: 4, logs: 1, traces: 1, metrics: 2 });
		const entries = unzipSync(await fs.readFile(outputPath));
		expect(Object.keys(entries).sort()).toEqual([
			"logs.json",
			"metrics.json",
			"traces.json",
		]);
		const logs = JSON.parse(Buffer.from(entries["logs.json"]).toString()) as {
			resourceLogs: Array<{
				scopeLogs: Array<{
					logRecords: Array<{ body: { stringValue: string } }>;
				}>;
			}>;
		};
		const traces = JSON.parse(
			Buffer.from(entries["traces.json"]).toString(),
		) as {
			resourceSpans: Array<{
				scopeSpans: Array<{
					spans: Array<{
						traceId: string;
						spanId: string;
						name: string;
						kind: number;
						status: { code: number };
						startTimeUnixNano: string;
						endTimeUnixNano: string;
					}>;
				}>;
			}>;
		};
		const metrics = JSON.parse(
			Buffer.from(entries["metrics.json"]).toString(),
		) as {
			resourceMetrics: Array<{
				scopeMetrics: Array<{
					metrics: Array<{
						name: string;
						sum?: { dataPoints: Array<{ asInt: string }> };
						gauge?: {
							dataPoints: Array<{
								asDouble: number;
								startTimeUnixNano?: string;
								timeUnixNano: string;
							}>;
						};
					}>;
				}>;
			}>;
		};

		expect(
			logs.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue,
		).toBe("log.info");
		const span = traces.resourceSpans[0].scopeSpans[0].spans[0];
		expect(span).toMatchObject({
			traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			spanId: "2222222222222222",
			name: "workspace_ready",
			kind: 1,
			status: { code: 1 },
		});
		expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(
			250_000_000n,
		);
		const metricNames = metrics.resourceMetrics.flatMap((resourceMetric) =>
			resourceMetric.scopeMetrics.flatMap((scopeMetric) =>
				scopeMetric.metrics.map((metric) => metric.name),
			),
		);
		expect(metricNames).toEqual([
			"http.requests.count_2xx",
			"http.requests.count_5xx",
			"http.requests.p95_duration_ms",
			"ssh.network.sampled.latencyMs",
			"ssh.network.sampled.downloadMbits",
			"ssh.network.sampled.uploadMbits",
		]);
		const httpP95 = metrics.resourceMetrics[0].scopeMetrics[0].metrics[2];
		expect(
			metrics.resourceMetrics[0].scopeMetrics[0].metrics[0].sum?.dataPoints[0]
				.asInt,
		).toBe("2");
		expect(
			BigInt(httpP95.gauge?.dataPoints[0].timeUnixNano ?? "0") -
				BigInt(httpP95.gauge?.dataPoints[0].startTimeUnixNano ?? "0"),
		).toBe(60_000_000_000n);
	});
});

async function* asyncEvents(
	events: readonly ExportTelemetryEvent[],
): AsyncGenerator<ExportTelemetryEvent> {
	for (const event of events) {
		await Promise.resolve();
		yield event;
	}
}

function makeEvent(
	overrides: Partial<ExportTelemetryEvent>,
): ExportTelemetryEvent {
	return {
		eventId: "1111111111111111",
		eventName: "test.event",
		timestamp: "2026-05-12T12:00:00.000Z",
		eventSequence: 1,
		context: {
			extensionVersion: "1.2.3",
			machineId: "machine",
			sessionId: "session",
			osType: "linux",
			osVersion: "6.0.0",
			hostArch: "x64",
			platformName: "VS Code",
			platformVersion: "1.100.0",
			deploymentUrl: "https://coder.example.com",
		},
		properties: {},
		measurements: {},
		...overrides,
	};
}
