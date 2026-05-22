import { describe, expect, it } from "vitest";

import { describeMetricEvent, isMetricEvent } from "@/telemetry/export/metrics";

import { createTelemetryEventFactory } from "../../../mocks/telemetry";

const makeEvent = createTelemetryEventFactory();

describe("isMetricEvent", () => {
	it.each([
		["http.requests", true],
		["ssh.network.info", true],
		["ssh.network.sampled", true],
		["log.something", false],
		["remote.setup.workspace_ready", false],
	])("returns %p for %s", (name, expected) => {
		expect(isMetricEvent(makeEvent({ eventName: name }))).toBe(expected);
	});
});

describe("describeMetricEvent", () => {
	it("returns undefined for non-metric events", () => {
		expect(
			describeMetricEvent(makeEvent({ eventName: "log.info" })),
		).toBeUndefined();
	});

	it("classifies all measurements as gauges for non-http metric events", () => {
		const descriptor = describeMetricEvent(
			makeEvent({
				eventName: "ssh.network.sampled",
				measurements: { latencyMs: 35, downloadMbits: 10, custom: 1 },
			}),
		);
		expect(descriptor).toEqual({
			measurements: [
				{ name: "latencyMs", value: 35, kind: "gauge", unit: "ms" },
				{ name: "downloadMbits", value: 10, kind: "gauge", unit: "Mbit/s" },
				{ name: "custom", value: 1, kind: "gauge", unit: "1" },
			],
		});
	});

	it("partitions http.requests into counters and gauges and extracts the window", () => {
		const descriptor = describeMetricEvent(
			makeEvent({
				eventName: "http.requests",
				measurements: {
					window_seconds: 60,
					count_2xx: 5,
					count_5xx: 1,
					p95_duration_ms: 42,
				},
			}),
		);
		expect(descriptor).toEqual({
			windowSeconds: 60,
			measurements: [
				{ name: "count_2xx", value: 5, kind: "counter", unit: "{request}" },
				{ name: "count_5xx", value: 1, kind: "counter", unit: "{request}" },
				{
					name: "p95_duration_ms",
					value: 42,
					kind: "gauge",
					unit: "ms",
				},
			],
		});
	});

	it("defaults http.requests windowSeconds to 0 when absent", () => {
		const descriptor = describeMetricEvent(
			makeEvent({
				eventName: "http.requests",
				measurements: { count_2xx: 1 },
			}),
		);
		expect(descriptor?.windowSeconds).toBe(0);
	});

	it.each([
		["latency_ms", "ms"],
		["durationMs", "ms"],
		["downloadMbits", "Mbit/s"],
		["something_else", "1"],
	])("derives unit for measurement '%s' -> '%s'", (name, unit) => {
		const descriptor = describeMetricEvent(
			makeEvent({
				eventName: "ssh.network.sampled",
				measurements: { [name]: 1 },
			}),
		);
		expect(descriptor?.measurements[0].unit).toBe(unit);
	});
});
