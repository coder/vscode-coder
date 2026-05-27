import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeJsonArrayExport } from "@/telemetry/export/writers/json";
import { serializeTelemetryEvent } from "@/telemetry/wireFormat";

import { asyncIterable } from "../../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../../mocks/telemetry";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

const OUT = "/exports/telemetry.json";

let makeEvent: ReturnType<typeof createTelemetryEventFactory>;

beforeEach(() => {
	vol.reset();
	vol.mkdirSync("/exports", { recursive: true });
	makeEvent = createTelemetryEventFactory();
});

afterEach(() => vol.reset());

const readOut = () => JSON.parse(vol.readFileSync(OUT, "utf8") as string);
const noopCleanup = () => {};

describe("writeJsonArrayExport", () => {
	it("writes events in wire format and returns the count", async () => {
		const events = [
			makeEvent({ eventName: "first" }),
			makeEvent({ eventName: "second", error: { message: "boom" } }),
		];

		const count = await writeJsonArrayExport(
			OUT,
			asyncIterable(events),
			noopCleanup,
		);

		expect(count).toBe(2);
		expect(readOut()).toEqual(events.map(serializeTelemetryEvent));
	});

	it("writes a valid empty array for empty input", async () => {
		const count = await writeJsonArrayExport(
			OUT,
			asyncIterable([]),
			noopCleanup,
		);

		expect(count).toBe(0);
		expect(readOut()).toEqual([]);
	});

	it("leaves the destination untouched on midstream errors", async () => {
		vol.writeFileSync(OUT, "previous");
		const failing = (async function* () {
			yield makeEvent();
			await Promise.resolve();
			throw new Error("boom");
		})();

		await expect(
			writeJsonArrayExport(OUT, failing, noopCleanup),
		).rejects.toThrow(/boom/);

		expect(vol.readFileSync(OUT, "utf8")).toBe("previous");
		expect(vol.readdirSync("/exports")).toEqual(["telemetry.json"]);
	});
});
