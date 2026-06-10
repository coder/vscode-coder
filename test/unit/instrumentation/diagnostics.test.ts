import { describe, expect, it } from "vitest";

import { DiagnosticTelemetry } from "@/instrumentation/diagnostics";

import { createTelemetryHarness } from "../../mocks/telemetry";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { sink, telemetry: new DiagnosticTelemetry(service) };
}

describe("DiagnosticTelemetry", () => {
	it("records diagnostic cancellation and failure categories", async () => {
		const { sink, telemetry } = setup();

		await telemetry.trace("support_bundle", (trace) => {
			trace.cancel("save_dialog");
			return Promise.resolve();
		});
		await telemetry.trace("support_bundle", (trace) => {
			trace.fail("unsupported_cli");
			return Promise.resolve();
		});

		const [cancelled, failed] = sink.eventsNamed(
			"command.diagnostic.completed",
		);
		expect(cancelled.properties).toMatchObject({
			cancel_stage: "save_dialog",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			failure_category: "unsupported_cli",
			result: "error",
		});
		expect(failed.error).toBeUndefined();
	});

	it("records bounded speed test measurements", async () => {
		const { sink, telemetry } = setup();

		await telemetry.trace("speed_test", (trace) => {
			trace.succeedSpeedtest({
				overall: {
					start_time_seconds: 0,
					end_time_seconds: 5,
					throughput_mbits: 42,
				},
				intervals: [
					{
						start_time_seconds: 0,
						end_time_seconds: 5,
						throughput_mbits: 42,
					},
				],
			});
			return Promise.resolve();
		});

		expect(sink.expectOne("command.diagnostic.completed")).toMatchObject({
			measurements: {
				interval_count: 1,
				throughput_mbits: 42,
			},
			properties: { result: "success" },
		});
	});
});
