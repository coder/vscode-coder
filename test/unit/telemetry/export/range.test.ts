import { describe, expect, it } from "vitest";

import {
	createCustomDateRange,
	createPresetDateRange,
	isTimestampInRange,
	fileDateCanContainRangeEvent,
} from "@/telemetry/export/range";

describe("telemetry export ranges", () => {
	it("builds inclusive custom UTC day ranges", () => {
		const range = createCustomDateRange("2026-05-12", "2026-05-13");

		expect(range).toMatchObject({
			label: "2026-05-12 to 2026-05-13",
			filenamePart: "2026-05-12_to_2026-05-13",
		});
		expect(isTimestampInRange("2026-05-12T00:00:00.000Z", range)).toBe(true);
		expect(isTimestampInRange("2026-05-13T23:59:59.999Z", range)).toBe(true);
		expect(isTimestampInRange("2026-05-14T00:00:00.000Z", range)).toBe(false);
	});

	it("rejects custom ranges whose end is before the start", () => {
		expect(() => createCustomDateRange("2026-05-13", "2026-05-12")).toThrow(
			/End date/,
		);
	});

	it("checks filename UTC dates against preset ranges", () => {
		const range = createPresetDateRange(
			"last24Hours",
			new Date("2026-05-13T12:00:00.000Z"),
		);

		expect(fileDateCanContainRangeEvent("2026-05-11", range)).toBe(false);
		expect(fileDateCanContainRangeEvent("2026-05-12", range)).toBe(true);
		expect(fileDateCanContainRangeEvent("2026-05-13", range)).toBe(true);
		expect(fileDateCanContainRangeEvent("2026-05-14", range)).toBe(false);
	});

	it("includes every filename date for all time", () => {
		const range = createPresetDateRange("allTime");

		expect(fileDateCanContainRangeEvent("2020-01-01", range)).toBe(true);
		expect(fileDateCanContainRangeEvent("2026-05-13", range)).toBe(true);
	});
});
