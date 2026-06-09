import { describe, expect, it } from "vitest";

import { AuthTelemetry } from "@/instrumentation/auth";

import { createTelemetryHarness } from "../../mocks/telemetry";

function setup() {
	const { sink, service } = createTelemetryHarness();
	return { auth: new AuthTelemetry(service), sink };
}

describe("AuthTelemetry", () => {
	describe("traceLogin", () => {
		it.each([
			{
				name: "records success with the returned method",
				outcome: { success: true, method: "mtls" } as const,
				properties: {
					source: "uri",
					method: "mtls",
					result: "success",
				},
			},
			{
				name: "records cancellation with the latest traced method",
				outcome: {
					success: false,
					reason: "user_dismissed",
				} as const,
				traceMethod: "cli_token" as const,
				properties: {
					source: "uri",
					method: "cli_token",
					result: "aborted",
					reason: "user_dismissed",
				},
			},
			{
				name: "records auth failures as errors",
				outcome: {
					success: false,
					method: "oauth",
					reason: "auth_failed",
				} as const,
				properties: {
					source: "uri",
					method: "oauth",
					result: "error",
					reason: "auth_failed",
				},
			},
		])("$name", async ({ outcome, traceMethod, properties }) => {
			const { auth, sink } = setup();

			await auth.traceLogin("uri", (trace) => {
				if (traceMethod) {
					trace.setMethod(traceMethod);
				}
				return Promise.resolve(outcome);
			});

			expect(sink.expectOne("auth.login")).toMatchObject({ properties });
		});
	});

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

		it("marks not_authenticated as aborted", async () => {
			const { auth, sink } = setup();

			await auth.traceLogout(() =>
				Promise.resolve({ success: false, reason: "not_authenticated" }),
			);

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "aborted",
					reason: "not_authenticated",
				},
			});
		});

		it("records exceptions as errors", async () => {
			const { auth, sink } = setup();

			await expect(
				auth.traceLogout(() => Promise.reject(new Error("clear failed"))),
			).rejects.toThrow("clear failed");

			expect(sink.expectOne("auth.logout")).toMatchObject({
				properties: {
					result: "error",
					reason: "exception",
				},
				error: { message: "clear failed" },
			});
		});
	});
});
