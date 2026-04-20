import { describe, expect, it } from "vitest";

import { renderLineChart } from "@repo/speedtest/chart";

function makeCanvas(width: number, height: number): HTMLCanvasElement {
	const parent = document.createElement("div");
	Object.defineProperty(parent, "getBoundingClientRect", {
		value: () => ({
			width,
			height,
			top: 0,
			left: 0,
			right: width,
			bottom: height,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		}),
	});
	parent.style.fontSize = "16px";
	const canvas = document.createElement("canvas");
	parent.appendChild(canvas);
	return canvas;
}

describe("renderLineChart", () => {
	it("scales the canvas backing store by devicePixelRatio", () => {
		Object.defineProperty(window, "devicePixelRatio", {
			value: 2,
			configurable: true,
		});
		const canvas = makeCanvas(600, 300);

		renderLineChart(
			canvas,
			[
				{ x: 0, y: 10, label: "a" },
				{ x: 1, y: 20, label: "b" },
			],
			true,
		);

		expect(canvas.width).toBe(1200);
		expect(canvas.height).toBe(600);
	});

	it("returns one point per sample, preserving input order and labels", () => {
		const canvas = makeCanvas(600, 300);

		const points = renderLineChart(
			canvas,
			[
				{ x: 0, y: 10, label: "alpha" },
				{ x: 5, y: 20, label: "beta" },
				{ x: 10, y: 5, label: "gamma" },
			],
			true,
		);

		expect(points.map((p) => p.label)).toEqual(["alpha", "beta", "gamma"]);
	});

	it("places returned points inside the canvas bounds, left-to-right", () => {
		const canvas = makeCanvas(600, 300);

		const points = renderLineChart(
			canvas,
			[
				{ x: 0, y: 10, label: "a" },
				{ x: 5, y: 20, label: "b" },
				{ x: 10, y: 5, label: "c" },
			],
			true,
		);

		for (const p of points) {
			expect(p.x).toBeGreaterThanOrEqual(0);
			expect(p.x).toBeLessThanOrEqual(600);
			expect(p.y).toBeGreaterThanOrEqual(0);
			expect(p.y).toBeLessThanOrEqual(300);
		}
		expect(points[0].x).toBeLessThan(points[1].x);
		expect(points[1].x).toBeLessThan(points[2].x);
	});

	it("maps the higher sample to a smaller y (pixel y grows downward)", () => {
		const canvas = makeCanvas(600, 300);

		const points = renderLineChart(
			canvas,
			[
				{ x: 0, y: 10, label: "low" },
				{ x: 1, y: 100, label: "high" },
			],
			true,
		);

		expect(points[1].y).toBeLessThan(points[0].y);
	});

	it("renders a single sample without throwing", () => {
		const canvas = makeCanvas(600, 300);
		expect(() =>
			renderLineChart(canvas, [{ x: 0, y: 10, label: "solo" }], true),
		).not.toThrow();
	});
});
