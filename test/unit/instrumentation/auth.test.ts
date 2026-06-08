import { describe, expect, it } from "vitest";

import { AuthTelemetry } from "@/instrumentation/auth";

import { createTelemetryHarness } from "../../mocks/telemetry";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { auth: new AuthTelemetry(service), sink };
}

describe("AuthTelemetry", () => {
	describe("traceLogout", () => {
		it("emits auth.logout success with duration", async () => {
			const { auth, sink } = setup();

			await auth.traceLogout(() => Promise.resolve({ success: true }));

			const event = sink.expectOne("auth.logout");
			expect(event.properties).toMatchObject({ result: "success" });
			expect(event.properties.reason).toBeUndefined();
			expect(event.error).toBeUndefined();
			expect(event.measurements.durationMs).toEqual(expect.any(Number));
		});

		it("marks user cancellation as aborted with a bounded reason", async () => {
			const { auth, sink } = setup();

			await auth.traceLogout(() =>
				Promise.resolve({
					success: false,
					reason: "credential_clear_cancelled",
				}),
			);

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "aborted",
					reason: "credential_clear_cancelled",
				},
			});
		});

		it("marks credential clear failures as errors with a bounded reason", async () => {
			const { auth, sink } = setup();

			await auth.traceLogout(() =>
				Promise.resolve({
					success: false,
					reason: "credential_clear_failed",
				}),
			);

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "error",
					reason: "credential_clear_failed",
				},
			});
		});
	});
});
