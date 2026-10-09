import { describe, expect, it } from "vitest";

import {
	formatDuration,
	formatThroughput,
	formatTick,
} from "@repo/speedtest/format";

describe("formatThroughput", () => {
	it("uses two decimals below 1000 Mbps", () => {
		expect(formatThroughput(0.45)).toBe("0.45");
		expect(formatThroughput(11.52)).toBe("11.52");
		expect(formatThroughput(43.49)).toBe("43.49");
		expect(formatThroughput(999.99)).toBe("999.99");
	});

	it("drops decimals at 1000 Mbps and above", () => {
		expect(formatThroughput(1000)).toBe("1000");
		expect(formatThroughput(1500.5)).toBe("1501");
		expect(formatThroughput(9999.99)).toBe("10000");
	});
});

describe("formatDuration", () => {
	it("returns seconds with one decimal below a minute", () => {
		expect(formatDuration(5.8)).toEqual({ value: "5.8", unit: "s" });
		expect(formatDuration(14.6)).toEqual({ value: "14.6", unit: "s" });
		expect(formatDuration(59.9)).toEqual({ value: "59.9", unit: "s" });
	});

	it("switches to minutes between 1m and 1h, dropping trailing zero on whole values", () => {
		expect(formatDuration(60)).toEqual({ value: "1", unit: "m" });
		expect(formatDuration(120)).toEqual({ value: "2", unit: "m" });
		expect(formatDuration(330)).toEqual({ value: "5.5", unit: "m" });
		expect(formatDuration(900)).toEqual({ value: "15", unit: "m" });
	});

	it("switches to hours at 1h and above", () => {
		expect(formatDuration(3600)).toEqual({ value: "1", unit: "h" });
		expect(formatDuration(5400)).toEqual({ value: "1.5", unit: "h" });
		expect(formatDuration(7200)).toEqual({ value: "2", unit: "h" });
	});
});

describe("formatTick", () => {
	it("uses seconds below a minute", () => {
		expect(formatTick(0, 1)).toBe("0s");
		expect(formatTick(5, 5)).toBe("5s");
		expect(formatTick(30, 15)).toBe("30s");
	});

	it("uses minutes between 1m and 1h", () => {
		expect(formatTick(60, 60)).toBe("1m");
		expect(formatTick(120, 60)).toBe("2m");
		expect(formatTick(90, 60)).toBe("1.5m");
		expect(formatTick(300, 300)).toBe("5m");
	});

	it("uses hours at or above 1h", () => {
		expect(formatTick(3600, 3600)).toBe("1h");
		expect(formatTick(7200, 3600)).toBe("2h");
		expect(formatTick(5400, 3600)).toBe("1.5h");
	});
});
