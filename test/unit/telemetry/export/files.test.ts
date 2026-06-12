import { vol } from "memfs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	listTelemetryFilesForRange,
	streamTelemetryEventsSorted,
	type TelemetryExportWarningSink,
} from "@/telemetry/export/files";
import { createCustomDateRange } from "@/telemetry/export/range";
import { serializeTelemetryEventLine } from "@/telemetry/wireFormat";

import { createTelemetryEventFactory } from "../../../mocks/telemetry";

import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const DIR = "/telemetry";
const IGNORE_WARNINGS: TelemetryExportWarningSink = {
	onWarning: () => undefined,
};

let makeEvent: ReturnType<typeof createTelemetryEventFactory>;

beforeEach(() => {
	vol.reset();
	vol.mkdirSync(DIR, { recursive: true });
	makeEvent = createTelemetryEventFactory();
});

afterEach(() => {
	vol.reset();
});

describe("listTelemetryFilesForRange", () => {
	it("keeps only telemetry files dated inside the range", async () => {
		writeFiles({
			"telemetry-2026-05-11-aaaaaaaa.jsonl": "",
			"telemetry-2026-05-12-bbbbbbbb.jsonl": "",
			"telemetry-2026-05-12-bbbbbbbb.1.jsonl": "",
			"telemetry-2026-05-14-cccccccc.jsonl": "",
			"notes-2026-05-12.jsonl": "",
		});

		const files = await listTelemetryFilesForRange(
			DIR,
			createCustomDateRange("2026-05-12", "2026-05-13"),
		);

		expect(files.map((p) => path.basename(p))).toEqual([
			"telemetry-2026-05-12-bbbbbbbb.jsonl",
			"telemetry-2026-05-12-bbbbbbbb.1.jsonl",
		]);
	});

	it("returns an empty list when the telemetry directory is missing", async () => {
		await expect(
			listTelemetryFilesForRange(
				`${DIR}/missing`,
				createCustomDateRange("2026-05-12", "2026-05-13"),
			),
		).resolves.toEqual([]);
	});
});

describe("streamTelemetryEventsSorted", () => {
	it("returns a timestamp-sorted stream with deterministic session-id ties", async () => {
		writeFiles({
			"telemetry-2026-05-12-cccccccc.jsonl": serializeTelemetryEventLine(
				makeSessionEvent("session-c", 0, "2026-05-12T10:00:00.000Z"),
			),
			"telemetry-2026-05-12-aaaaaaaa.jsonl": serializeTelemetryEventLine(
				makeSessionEvent("session-a", 10, "2026-05-12T10:00:00.000Z"),
			),
			"telemetry-2026-05-12-bbbbbbbb.jsonl": serializeTelemetryEventLine(
				makeSessionEvent("session-b", 0, "2026-05-12T10:01:00.000Z"),
			),
			"telemetry-2026-05-12-aaaaaaaa.1.jsonl": serializeTelemetryEventLine(
				makeSessionEvent("session-a", 11, "2026-05-12T10:02:00.000Z"),
			),
		});

		const events = await collectSorted([
			"telemetry-2026-05-12-aaaaaaaa.1.jsonl",
			"telemetry-2026-05-12-bbbbbbbb.jsonl",
			"telemetry-2026-05-12-cccccccc.jsonl",
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
		]);

		expect(
			events.map((event) => [
				event.timestamp,
				event.context.sessionId,
				event.eventSequence,
			]),
		).toEqual([
			["2026-05-12T10:00:00.000Z", "session-a", 10],
			["2026-05-12T10:00:00.000Z", "session-c", 0],
			["2026-05-12T10:01:00.000Z", "session-b", 0],
			["2026-05-12T10:02:00.000Z", "session-a", 11],
		]);
	});

	it("filters by range and preserves backward session timestamps", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl":
				serializeTelemetryEventLine(
					makeSessionEvent("session-a", 0, "2026-05-11T23:59:59.999Z"),
				) +
				serializeTelemetryEventLine(
					makeSessionEvent("session-a", 1, "2026-05-12T10:02:00.000Z"),
				) +
				serializeTelemetryEventLine(
					makeSessionEvent("session-a", 2, "2026-05-12T10:00:00.000Z"),
				),
			"telemetry-2026-05-12-bbbbbbbb.jsonl": serializeTelemetryEventLine(
				makeSessionEvent("session-b", 0, "2026-05-12T10:01:00.000Z"),
			),
		});

		const events = await collectSorted([
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
			"telemetry-2026-05-12-bbbbbbbb.jsonl",
		]);

		expect(events.map((event) => event.timestamp)).toEqual([
			"2026-05-12T10:01:00.000Z",
			"2026-05-12T10:02:00.000Z",
			"2026-05-12T10:00:00.000Z",
		]);
	});

	it("surfaces parse errors with file:line context", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl": "{not-json}\n",
		});

		await expect(
			collectSorted(["telemetry-2026-05-12-aaaaaaaa.jsonl"]),
		).rejects.toThrow(
			/Failed to parse telemetry file telemetry-2026-05-12-aaaaaaaa\.jsonl:1/,
		);
	});

	it("skips invalid telemetry file paths after reporting a warning", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl": serializeTelemetryEventLine(
				makeSessionEvent("session-a", 0, "2026-05-12T10:00:00.000Z"),
			),
		});
		const onWarning = vi.fn();

		const events = await collectSorted(
			["telemetry-2026-05-12-aaaaaaaa.jsonl", "notes-2026-05-12.jsonl"],
			{ onWarning },
		);

		expect(events.map((event) => event.context.sessionId)).toEqual([
			"session-a",
		]);
		expect(onWarning).toHaveBeenCalledWith({
			code: "invalidTelemetryFilePath",
			filePath: `${DIR}/notes-2026-05-12.jsonl`,
			error: expect.any(Error),
		});
	});
});

function writeFiles(files: Record<string, string>): void {
	for (const [name, content] of Object.entries(files)) {
		vol.writeFileSync(`${DIR}/${name}`, content);
	}
}

function makeSessionEvent(
	sessionId: string,
	eventSequence: number,
	timestamp: string,
): TelemetryEvent {
	const event = makeEvent({ timestamp, eventSequence });
	return {
		...event,
		context: { ...event.context, sessionId },
	};
}

async function collectSorted(
	names: readonly string[],
	warningSink: TelemetryExportWarningSink = IGNORE_WARNINGS,
): Promise<TelemetryEvent[]> {
	const events: TelemetryEvent[] = [];
	for await (const event of streamTelemetryEventsSorted(
		names.map((name) => `${DIR}/${name}`),
		createCustomDateRange("2026-05-12", "2026-05-12"),
		warningSink,
	)) {
		events.push(event);
	}
	return events;
}
