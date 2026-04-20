import { describe, expect, it } from "vitest";

import { formatTick, niceStep } from "@repo/speedtest/chart";

describe("niceStep", () => {
	it("rounds up to the next candidate for sub-hour ranges", () => {
		expect(niceStep(0.3)).toBe(1);
		expect(niceStep(1)).toBe(1);
		expect(niceStep(1.5)).toBe(2);
		expect(niceStep(3)).toBe(5);
		expect(niceStep(7)).toBe(10);
		expect(niceStep(45)).toBe(60);
		expect(niceStep(200)).toBe(300);
	});

	it("rounds up to whole hours past the longest candidate", () => {
		expect(niceStep(3600)).toBe(3600);
		expect(niceStep(4000)).toBe(7200);
		expect(niceStep(10000)).toBe(10800);
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
