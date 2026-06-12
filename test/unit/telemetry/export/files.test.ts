import { vol } from "memfs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	listTelemetryFilesForRange,
	streamTelemetryEventsSorted,
	type TelemetryLogFile,
} from "@/telemetry/export/files";
import { createCustomDateRange } from "@/telemetry/export/range";
import { parseFileName } from "@/telemetry/localJsonlFiles";
import {
	serializeTelemetryEventLine,
	serializeTelemetryFileHeaderLine,
} from "@/telemetry/wireFormat";

import { createTelemetryEventFactory } from "../../../mocks/telemetry";

import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const DIR = "/telemetry";

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

		expect(files.map((file) => path.basename(file.path))).toEqual([
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
			"telemetry-2026-05-12-cccccccc.jsonl": sessionFileContent([
				makeSessionEvent("session-c", 0, "2026-05-12T10:00:00.000Z"),
			]),
			"telemetry-2026-05-12-aaaaaaaa.jsonl": sessionFileContent([
				makeSessionEvent("session-a", 10, "2026-05-12T10:00:00.000Z"),
			]),
			"telemetry-2026-05-12-bbbbbbbb.jsonl": sessionFileContent([
				makeSessionEvent("session-b", 0, "2026-05-12T10:01:00.000Z"),
			]),
			"telemetry-2026-05-12-aaaaaaaa.1.jsonl": sessionFileContent([
				makeSessionEvent("session-a", 11, "2026-05-12T10:02:00.000Z"),
			]),
		});

		const events = await drain([
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
			"telemetry-2026-05-12-aaaaaaaa.jsonl": sessionFileContent([
				makeSessionEvent("session-a", 0, "2026-05-11T23:59:59.999Z"),
				makeSessionEvent("session-a", 1, "2026-05-12T10:02:00.000Z"),
				makeSessionEvent("session-a", 2, "2026-05-12T10:00:00.000Z"),
			]),
			"telemetry-2026-05-12-bbbbbbbb.jsonl": sessionFileContent([
				makeSessionEvent("session-b", 0, "2026-05-12T10:01:00.000Z"),
			]),
		});

		const events = await drain([
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
			"telemetry-2026-05-12-bbbbbbbb.jsonl",
		]);

		expect(events.map((event) => event.timestamp)).toEqual([
			"2026-05-12T10:01:00.000Z",
			"2026-05-12T10:02:00.000Z",
			"2026-05-12T10:00:00.000Z",
		]);
	});

	it("combines each file's header with its rows across multiple files", async () => {
		const first = makeEvent({ timestamp: "2026-05-12T01:00:00.000Z" });
		const second = makeEvent({
			timestamp: "2026-05-12T02:00:00.000Z",
			context: { ...first.context, sessionId: "other-session" },
		});
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl": sessionFileContent([first]),
			"telemetry-2026-05-12-bbbbbbbb.jsonl": sessionFileContent([second]),
		});

		const events = await drain([
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
			"telemetry-2026-05-12-bbbbbbbb.jsonl",
		]);

		expect(events).toEqual([first, second]);
	});

	it("skips a file whose rows precede its header and reports it", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl": serializeTelemetryEventLine(
				makeEvent({ timestamp: "2026-05-12T01:00:00.000Z" }),
			),
		});
		const onFileError = vi.fn();

		const events = await drain(
			["telemetry-2026-05-12-aaaaaaaa.jsonl"],
			onFileError,
		);

		expect(events).toEqual([]);
		expect(onFileError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringMatching(
					/expected a file header before event rows/,
				),
			}),
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
		);
	});

	it("reports parse errors with file:line context", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl": "{not-json}\n",
		});
		const onFileError = vi.fn();

		await drain(["telemetry-2026-05-12-aaaaaaaa.jsonl"], onFileError);

		expect(onFileError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringMatching(
					/Failed to parse telemetry file telemetry-2026-05-12-aaaaaaaa\.jsonl:1/,
				),
			}),
			"telemetry-2026-05-12-aaaaaaaa.jsonl",
		);
	});

	it("skips a file that cannot be opened and reports it", async () => {
		const onFileError = vi.fn();

		const events = await drain(
			["telemetry-2026-05-12-gone0000.jsonl"],
			onFileError,
		);

		expect(events).toEqual([]);
		expect(onFileError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringMatching(
					/Failed to read telemetry file telemetry-2026-05-12-gone0000\.jsonl/,
				),
			}),
			"telemetry-2026-05-12-gone0000.jsonl",
		);
	});

	it("keeps a corrupt file's earlier events and continues with later files", async () => {
		const first = makeEvent({ timestamp: "2026-05-12T01:00:00.000Z" });
		const lost = makeEvent({ timestamp: "2026-05-12T02:00:00.000Z" });
		const second = makeEvent({ timestamp: "2026-05-12T03:00:00.000Z" });
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl":
				serializeTelemetryFileHeaderLine(first.context) +
				serializeTelemetryEventLine(first) +
				"{not-json}\n" +
				serializeTelemetryEventLine(lost),
			"telemetry-2026-05-12-bbbbbbbb.jsonl":
				serializeTelemetryFileHeaderLine(second.context) +
				serializeTelemetryEventLine(second),
		});
		const onFileError = vi.fn();

		const events = await drain(
			[
				"telemetry-2026-05-12-aaaaaaaa.jsonl",
				"telemetry-2026-05-12-bbbbbbbb.jsonl",
			],
			onFileError,
		);

		// The rest of the corrupt file is dropped; events already parsed stay.
		expect(events).toEqual([first, second]);
		expect(onFileError).toHaveBeenCalledOnce();
	});
});

function writeFiles(files: Record<string, string>): void {
	for (const [name, content] of Object.entries(files)) {
		vol.writeFileSync(`${DIR}/${name}`, content);
	}
}

/** A file's wire content: its header from the first event's context, then rows. */
function sessionFileContent(events: readonly TelemetryEvent[]): string {
	return (
		serializeTelemetryFileHeaderLine(events[0].context) +
		events.map(serializeTelemetryEventLine).join("")
	);
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

function makeLogFile(name: string): TelemetryLogFile {
	const parsed = parseFileName(name);
	if (!parsed) {
		throw new Error(`Test file name does not parse: ${name}`);
	}
	return { path: `${DIR}/${name}`, ...parsed };
}

/** `onFileError` defaults to rethrowing so a happy-path test cannot skip silently. */
async function drain(
	names: readonly string[],
	onFileError: (err: Error, fileName: string) => void = (err) => {
		throw err;
	},
): Promise<TelemetryEvent[]> {
	const events: TelemetryEvent[] = [];
	for await (const event of streamTelemetryEventsSorted(
		names.map(makeLogFile),
		createCustomDateRange("2026-05-12", "2026-05-12"),
		onFileError,
	)) {
		events.push(event);
	}
	return events;
}
