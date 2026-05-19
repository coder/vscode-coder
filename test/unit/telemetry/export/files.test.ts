import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	listTelemetryFilesForRange,
	parseStoredTelemetryEvent,
	readTelemetryEvents,
	toStoredTelemetryEvent,
} from "@/telemetry/export/files";
import { createCustomDateRange } from "@/telemetry/export/range";

import type { TelemetryEvent } from "@/telemetry/event";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "telemetry-export-files-"));
});

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("telemetry export files", () => {
	it("filters telemetry files by the date in the filename", async () => {
		await Promise.all([
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-11-aaaaaaaa.jsonl"),
				"",
			),
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-12-bbbbbbbb.jsonl"),
				"",
			),
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-12-bbbbbbbb.1.jsonl"),
				"",
			),
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-14-cccccccc.jsonl"),
				"",
			),
			fs.writeFile(path.join(tmpDir, "notes-2026-05-12.jsonl"), ""),
		]);

		const files = await listTelemetryFilesForRange(
			tmpDir,
			createCustomDateRange("2026-05-12", "2026-05-13"),
		);

		expect(files.map((file) => path.basename(file))).toEqual([
			"telemetry-2026-05-12-bbbbbbbb.jsonl",
			"telemetry-2026-05-12-bbbbbbbb.1.jsonl",
			"telemetry-2026-05-14-cccccccc.jsonl",
		]);
	});

	it("returns an empty list when the telemetry directory does not exist", async () => {
		await expect(
			listTelemetryFilesForRange(
				path.join(tmpDir, "missing"),
				createCustomDateRange("2026-05-12", "2026-05-13"),
			),
		).resolves.toEqual([]);
	});

	it("parses stored snake case telemetry into export events", () => {
		const parsed = parseStoredTelemetryEvent(
			JSON.stringify(toStoredTelemetryEvent(makeEvent({ eventName: "log" }))),
		);

		expect(parsed).toMatchObject({
			eventId: "1111111111111111",
			eventName: "log",
			context: {
				extensionVersion: "1.2.3",
				deploymentUrl: "https://coder.example.com",
			},
		});
	});

	it("includes the day after the range so buffered events are not missed", async () => {
		await Promise.all([
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-12-aaaaaaaa.jsonl"),
				"",
			),
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-13-aaaaaaaa.jsonl"),
				"",
			),
			fs.writeFile(
				path.join(tmpDir, "telemetry-2026-05-14-aaaaaaaa.jsonl"),
				"",
			),
		]);

		const files = await listTelemetryFilesForRange(
			tmpDir,
			createCustomDateRange("2026-05-12", "2026-05-12"),
		);

		expect(files.map((file) => path.basename(file))).toEqual([
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
			"telemetry-2026-05-13-aaaaaaaa.jsonl",
		]);
	});

	it("streams events and filters by exact timestamp range", async () => {
		const filePath = path.join(tmpDir, "telemetry-2026-05-12-aaaaaaaa.jsonl");
		await fs.writeFile(
			filePath,
			[
				toStoredTelemetryEvent(
					makeEvent({ timestamp: "2026-05-11T23:59:59.999Z" }),
				),
				toStoredTelemetryEvent(
					makeEvent({ timestamp: "2026-05-12T00:00:00.000Z" }),
				),
			]
				.map((event) => JSON.stringify(event))
				.join("\n") + "\n",
		);

		const events: TelemetryEvent[] = [];
		for await (const event of readTelemetryEvents(
			[filePath],
			createCustomDateRange("2026-05-12", "2026-05-12"),
		)) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0].timestamp).toBe("2026-05-12T00:00:00.000Z");
	});

	it("fails when a telemetry timestamp is not a valid ISO date time", () => {
		expect(() =>
			parseStoredTelemetryEvent(
				JSON.stringify(
					toStoredTelemetryEvent(
						makeEvent({ timestamp: "2026-02-30T00:00:00.000Z" }),
					),
				),
			),
		).toThrow(/Failed to parse telemetry file/);
	});

	it("fails when a JSONL line is corrupt", async () => {
		const filePath = path.join(tmpDir, "telemetry-2026-05-12-aaaaaaaa.jsonl");
		await fs.writeFile(filePath, "{not-json}\n");

		const read = async (): Promise<void> => {
			for await (const _event of readTelemetryEvents(
				[filePath],
				createCustomDateRange("2026-05-12", "2026-05-12"),
			)) {
				// Drain iterator.
			}
		};

		await expect(read()).rejects.toThrow(
			/Failed to parse telemetry file telemetry-2026-05-12-aaaaaaaa\.jsonl:1/,
		);
	});
});

function makeEvent(overrides: Partial<TelemetryEvent>): TelemetryEvent {
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
