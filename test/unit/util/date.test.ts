import { describe, expect, it } from "vitest";

import {
	parseUtcDate,
	toUtcDateString,
	validateUtcDateInput,
} from "@/util/date";

describe("toUtcDateString", () => {
	it("formats a Date as a UTC YYYY-MM-DD string", () => {
		expect(toUtcDateString(new Date("2026-01-31T12:00:00Z"))).toBe(
			"2026-01-31",
		);
	});

	it("uses the UTC day regardless of the time within the day", () => {
		expect(toUtcDateString(new Date("2026-06-15T23:30:00Z"))).toBe(
			"2026-06-15",
		);
		expect(toUtcDateString(new Date("2026-06-16T00:30:00Z"))).toBe(
			"2026-06-16",
		);
	});

	it("zero-pads years below 1000", () => {
		expect(toUtcDateString(new Date("0099-06-15T00:00:00Z"))).toBe(
			"0099-06-15",
		);
	});

	it("preserves expanded years beyond 9999", () => {
		expect(toUtcDateString(new Date(Date.UTC(275760, 8, 13)))).toBe(
			"+275760-09-13",
		);
	});

	it("preserves negative (BCE) years", () => {
		expect(toUtcDateString(new Date(Date.UTC(-1, 0, 1)))).toBe("-000001-01-01");
	});
});

describe("validateUtcDateInput", () => {
	it("accepts an exact UTC calendar date", () => {
		expect(validateUtcDateInput("2026-05-13")).toBeUndefined();
	});

	it("rejects non YYYY-MM-DD formatting", () => {
		expect(validateUtcDateInput("2026-5-13")).toBe("Use YYYY-MM-DD.");
	});

	it("rejects an impossible calendar date", () => {
		expect(validateUtcDateInput("2026-02-30")).toBe(
			"Enter a valid calendar date.",
		);
	});
});

describe("parseUtcDate", () => {
	it("parses a YYYY-MM-DD date to UTC epoch ms", () => {
		expect(parseUtcDate("2026-05-13")).toBe(Date.UTC(2026, 4, 13));
	});

	it("throws on invalid input", () => {
		expect(() => parseUtcDate("2026-02-30")).toThrow("Invalid date");
	});
});
