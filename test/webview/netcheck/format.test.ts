import { describe, expect, it } from "vitest";

import {
	formatLatency,
	formatTriState,
	nanosToMs,
} from "@repo/netcheck/format";

describe("formatLatency", () => {
	it("formats missing, sub-millisecond, fractional, and large values", () => {
		expect(formatLatency(undefined)).toBe("—");
		expect(formatLatency(0.4)).toBe("<1 ms");
		expect(formatLatency(27.706829)).toBe("27.7 ms");
		expect(formatLatency(251.640563)).toBe("252 ms");
	});
});

describe("nanosToMs", () => {
	it("converts nanoseconds to milliseconds", () => {
		expect(nanosToMs(27706829)).toBeCloseTo(27.706829);
	});
});

describe("formatTriState", () => {
	it("maps yes/no/unknown to capability labels", () => {
		expect(formatTriState("yes")).toBe("Yes");
		expect(formatTriState("no")).toBe("Failed");
		expect(formatTriState("unknown")).toBe("—");
	});
});
