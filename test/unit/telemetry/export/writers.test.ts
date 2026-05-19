import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeJsonArrayExport } from "@/telemetry/export/writers";
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

const DIR = "/exports";

let makeEvent: ReturnType<typeof createTelemetryEventFactory>;

beforeEach(() => {
	vol.reset();
	vol.mkdirSync(DIR, { recursive: true });
	makeEvent = createTelemetryEventFactory();
});

afterEach(() => {
	vol.reset();
});

describe("writeJsonArrayExport", () => {
	it("writes events as a JSON array in wire format", async () => {
		const events = [
			makeEvent({
				eventName: "first",
				properties: { result: "success" },
				measurements: { durationMs: 12 },
				traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			}),
			makeEvent({
				eventName: "second",
				parentEventId: "id-0",
				error: { message: "boom", type: "Error" },
			}),
		];

		const count = await writeJsonArrayExport(
			`${DIR}/telemetry.json`,
			asyncIterable(events),
		);

		expect(count).toBe(2);
		expect(readJson(`${DIR}/telemetry.json`)).toEqual(
			events.map(serializeTelemetryEvent),
		);
	});

	it("writes a valid empty JSON array when there are no events", async () => {
		const count = await writeJsonArrayExport(
			`${DIR}/empty.json`,
			asyncIterable([]),
		);

		expect(count).toBe(0);
		expect(readJson(`${DIR}/empty.json`)).toEqual([]);
	});

	it("leaves the destination untouched when writing fails midway", async () => {
		const outputPath = `${DIR}/telemetry.json`;
		vol.writeFileSync(outputPath, "previous content");

		const events = (async function* () {
			yield makeEvent();
			await Promise.resolve();
			throw new Error("boom");
		})();

		await expect(writeJsonArrayExport(outputPath, events)).rejects.toThrow(
			/boom/,
		);

		expect(vol.readFileSync(outputPath, "utf8")).toBe("previous content");
		expect(vol.readdirSync(DIR)).toEqual(["telemetry.json"]);
	});
});

async function* asyncIterable(
	events: readonly TelemetryEvent[],
): AsyncGenerator<TelemetryEvent> {
	for (const event of events) {
		await Promise.resolve();
		yield event;
	}
}

function readJson(filePath: string): unknown {
	return JSON.parse(vol.readFileSync(filePath, "utf8") as string);
}
