import { describe, expect, it } from "vitest";

import { DiagnosticTelemetry } from "@/instrumentation/diagnostics";

import { createTelemetryHarness } from "../../mocks/telemetry";

import type { NetcheckReport } from "@repo/shared";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { sink, telemetry: new DiagnosticTelemetry(service) };
}

describe("DiagnosticTelemetry", () => {
	it("records diagnostic cancellation and failure categories", async () => {
		const { sink, telemetry } = setup();

		await telemetry.trace("support_bundle", (trace) => {
			trace.abort("save_dialog");
			return Promise.resolve();
		});
		await telemetry.trace("support_bundle", (trace) => {
			trace.error("unsupported_cli");
			return Promise.resolve();
		});

		const [cancelled, failed] = sink.eventsNamed(
			"command.diagnostic.completed",
		);
		expect(cancelled.properties).toMatchObject({
			abort_stage: "save_dialog",
			result: "aborted",
		});
		expect(failed.properties).toMatchObject({
			"error.type": "unsupported_cli",
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
				"interval.count": 1,
				throughput_mbits: 42,
			},
			properties: { result: "success" },
		});
	});

	it("records netcheck severity and bounded counts", async () => {
		const { sink, telemetry } = setup();
		const report: NetcheckReport = {
			derp: {
				severity: "warning",
				warnings: [{ code: "EDERP01", message: "Region latency is high" }],
				regions: {
					"999": { severity: "ok", node_reports: [] },
					"1000": { severity: "ok", node_reports: [] },
				},
			},
			interfaces: {
				severity: "warning",
				warnings: [{ code: "EIF01", message: "MTU is low" }],
				interfaces: [],
			},
		};

		await telemetry.trace("netcheck", (trace) => {
			trace.succeedNetcheck(report);
			return Promise.resolve();
		});

		expect(sink.expectOne("command.diagnostic.completed")).toMatchObject({
			measurements: {
				"region.count": 2,
				"warning.count": 2,
			},
			properties: {
				command: "netcheck",
				severity: "warning",
				result: "success",
			},
		});
	});
});
