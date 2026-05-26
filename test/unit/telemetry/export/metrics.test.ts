import { describe, expect, it } from "vitest";

import { describeMetricEvent, isMetricEvent } from "@/telemetry/export/metrics";

import { createTelemetryEventFactory } from "../../../mocks/telemetry";

const makeEvent = createTelemetryEventFactory();

describe("isMetricEvent", () => {
	it.each([
		["http.requests", true],
		["ssh.network.sampled", true],
		["log.something", false],
		["remote.setup.workspace_ready", false],
	])("returns %s for %p", (name, expected) => {
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
					"count.2xx": 5,
					"count.5xx": 1,
					"count.network_error": 0,
					"duration.p95_ms": 42,
				},
			}),
		);
		expect(descriptor).toEqual({
			windowSeconds: 60,
			measurements: [
				{ name: "count.2xx", value: 5, kind: "counter", unit: "{request}" },
				{ name: "count.5xx", value: 1, kind: "counter", unit: "{request}" },
				{
					name: "count.network_error",
					value: 0,
					kind: "counter",
					unit: "{request}",
				},
				{
					name: "duration.p95_ms",
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
				measurements: { "count.2xx": 1 },
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
