import { describe, expect, it } from "vitest";

import { MetricBlockBuffer } from "@/telemetry/export/writers/otlp/metricBlockBuffer";
import {
	type CumulativeState,
	metricRecords,
	newCumulativeState,
} from "@/telemetry/export/writers/otlp/records";

import { createTelemetryEventFactory } from "../../../../../mocks/telemetry";

import type { MetricMeasurement } from "@/telemetry/export/metrics";

const makeEvent = createTelemetryEventFactory();

const gauge = (name: string, value: number, unit = "1"): MetricMeasurement => ({
	name,
	value,
	kind: "gauge",
	unit,
});
const counter = (
	name: string,
	value: number,
	unit = "{request}",
): MetricMeasurement => ({ name, value, kind: "counter", unit });

const windowed = (
	timestamp: string,
	measurements: MetricMeasurement[],
	state: CumulativeState,
) =>
	metricRecords(
		makeEvent({ eventName: "http.requests", timestamp }),
		{ windowSeconds: 60, measurements },
		state,
	);

describe("MetricBlockBuffer", () => {
	it("groups data points under one metric per series in first-seen order", () => {
		const state = newCumulativeState();
		const buffer = new MetricBlockBuffer();
		buffer.add(
			windowed(
				"2026-05-04T12:01:00.000Z",
				[counter("count.2xx", 2), gauge("p95_duration_ms", 10, "ms")],
				state,
			),
		);
		buffer.add(
			windowed(
				"2026-05-04T12:02:00.000Z",
				[counter("count.2xx", 3), gauge("p95_duration_ms", 20, "ms")],
				state,
			),
		);

		const drained = buffer.drain();

		expect(drained.map((r) => r.name)).toEqual([
			"http.requests.count.2xx",
			"http.requests.p95_duration_ms",
		]);
		expect(drained[0].sum!.dataPoints.map((p) => p.asInt)).toEqual(["2", "5"]);
		expect(drained[1].gauge!.dataPoints.map((p) => p.asDouble)).toEqual([
			10, 20,
		]);
		// Draining clears the buffer.
		expect(buffer.drain()).toEqual([]);
	});

	it("keeps series with the same name but different units apart", () => {
		const buffer = new MetricBlockBuffer();
		const event = makeEvent({ eventName: "ssh.network.sampled" });
		buffer.add(
			metricRecords(
				event,
				{ measurements: [gauge("latency", 1, "ms")] },
				newCumulativeState(),
			),
		);
		buffer.add(
			metricRecords(
				event,
				{ measurements: [gauge("latency", 2, "s")] },
				newCumulativeState(),
			),
		);

		expect(buffer.drain().map((r) => [r.name, r.unit])).toEqual([
			["ssh.network.sampled.latency", "ms"],
			["ssh.network.sampled.latency", "s"],
		]);
	});
});
