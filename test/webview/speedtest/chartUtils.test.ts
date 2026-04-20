import { describe, expect, it } from "vitest";

import {
	findNearestByX,
	findNearestDot,
	findNearestOnLine,
	formatTick,
	niceStep,
	toChartSamples,
} from "@repo/speedtest/chartUtils";

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

describe("toChartSamples", () => {
	it("maps intervals to points with throughput labels", () => {
		const samples = toChartSamples([
			{ start_time_seconds: 0, end_time_seconds: 1, throughput_mbits: 95.5 },
			{ start_time_seconds: 1, end_time_seconds: 2, throughput_mbits: 110 },
		]);
		expect(samples).toEqual([
			{ x: 1, y: 95.5, label: "95.50 Mbps (0\u20131s)" },
			{ x: 2, y: 110, label: "110.00 Mbps (1\u20132s)" },
		]);
	});

	it("returns an empty array for no intervals", () => {
		expect(toChartSamples([])).toEqual([]);
	});
});

describe("findNearestByX", () => {
	const points = [
		{ x: 10, y: 5, label: "a" },
		{ x: 20, y: 6, label: "b" },
		{ x: 30, y: 7, label: "c" },
	];

	it("returns null for an empty list", () => {
		expect(findNearestByX([], 5)).toBe(null);
	});

	it("returns the closest point by x coordinate", () => {
		expect(findNearestByX(points, 11)?.label).toBe("a");
		expect(findNearestByX(points, 16)?.label).toBe("b");
		expect(findNearestByX(points, 24)?.label).toBe("b");
		expect(findNearestByX(points, 28)?.label).toBe("c");
	});

	it("handles queries before the first and after the last point", () => {
		expect(findNearestByX(points, -100)?.label).toBe("a");
		expect(findNearestByX(points, 1000)?.label).toBe("c");
	});

	it("returns the single point when the list has one entry", () => {
		const single = [{ x: 5, y: 1, label: "only" }];
		expect(findNearestByX(single, -20)?.label).toBe("only");
		expect(findNearestByX(single, 5)?.label).toBe("only");
		expect(findNearestByX(single, 999)?.label).toBe("only");
	});
});

describe("findNearestDot", () => {
	const points = [
		{ x: 50, y: 50, label: "p" },
		{ x: 100, y: 80, label: "q" },
	];

	it("returns the point when the cursor is within the hit radius", () => {
		expect(findNearestDot(points, 52, 51)?.label).toBe("p");
	});

	it("returns null when outside hit radius on x", () => {
		expect(findNearestDot(points, 70, 50)).toBe(null);
	});

	it("returns null when outside hit radius on y", () => {
		expect(findNearestDot(points, 50, 70)).toBe(null);
	});

	it("returns null for empty points", () => {
		expect(findNearestDot([], 0, 0)).toBe(null);
	});
});

describe("findNearestOnLine", () => {
	it("returns the closest point when within the average gap window", () => {
		const points = [
			{ x: 0, y: 0, label: "a" },
			{ x: 10, y: 5, label: "b" },
			{ x: 20, y: 10, label: "c" },
		];
		expect(findNearestOnLine(points, 12)?.label).toBe("b");
	});

	it("falls back to HIT_RADIUS_PX when only one point exists", () => {
		const single = [{ x: 50, y: 10, label: "only" }];
		expect(findNearestOnLine(single, 55)?.label).toBe("only");
		// HIT_RADIUS_PX default is 12; 70 is 20 away from 50, outside the window.
		expect(findNearestOnLine(single, 70)).toBe(null);
	});

	it("returns null for empty points", () => {
		expect(findNearestOnLine([], 50)).toBe(null);
	});
});
