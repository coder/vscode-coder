import { vol } from "memfs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	listTelemetryFilesForRange,
	streamTelemetryEvents,
} from "@/telemetry/export/files";
import { createCustomDateRange } from "@/telemetry/export/range";
import { serializeTelemetryEvent } from "@/telemetry/wireFormat";

import { createTelemetryEventFactory } from "../../../mocks/telemetry";

import type * as fs from "node:fs";

import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("node:fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs.promises;
});

vi.mock("node:fs", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs;
});

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

describe("streamTelemetryEvents", () => {
	it("yields only events whose timestamp falls inside the range", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl":
				wireLine(makeEvent({ timestamp: "2026-05-11T23:59:59.999Z" })) +
				wireLine(makeEvent({ timestamp: "2026-05-12T00:00:00.000Z" })),
		});

		const events: TelemetryEvent[] = [];
		for await (const event of streamTelemetryEvents(
			[`${DIR}/telemetry-2026-05-12-aaaaaaaa.jsonl`],
			createCustomDateRange("2026-05-12", "2026-05-12"),
		)) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0].timestamp).toBe("2026-05-12T00:00:00.000Z");
	});

	it("surfaces parse errors with file:line context", async () => {
		writeFiles({
			"telemetry-2026-05-12-aaaaaaaa.jsonl": "{not-json}\n",
		});

		await expect(drain("telemetry-2026-05-12-aaaaaaaa.jsonl")).rejects.toThrow(
			/Failed to parse telemetry file telemetry-2026-05-12-aaaaaaaa\.jsonl:1/,
		);
	});
});

function writeFiles(files: Record<string, string>): void {
	for (const [name, content] of Object.entries(files)) {
		vol.writeFileSync(`${DIR}/${name}`, content);
	}
}

async function drain(name: string): Promise<void> {
	for await (const _ of streamTelemetryEvents(
		[`${DIR}/${name}`],
		createCustomDateRange("2026-05-12", "2026-05-12"),
	)) {
		// Pull the iterator to surface parse errors.
	}
}

function wireLine(event: TelemetryEvent): string {
	return JSON.stringify(serializeTelemetryEvent(event)) + "\n";
}
