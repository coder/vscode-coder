import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toStoredTelemetryEvent } from "@/telemetry/export/files";
import { writeJsonArrayExport } from "@/telemetry/export/writers";

import type { TelemetryEvent } from "@/telemetry/event";

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
});

async function* asyncEvents(
	events: readonly TelemetryEvent[],
): AsyncGenerator<TelemetryEvent> {
	for (const event of events) {
		await Promise.resolve();
		yield event;
	}
}

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
