import { describe, expect, it } from "vitest";

import { ActivationTelemetry } from "@/instrumentation/activation";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import { MockConfigurationProvider } from "../../mocks/testHelpers";

function makeHarness() {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
	const sink = new TestSink();
	return {
		sink,
		activation: new ActivationTelemetry(createTestTelemetryService(sink)),
	};
}

const find = (sink: TestSink, name: string) =>
	sink.events.find((e) => e.eventName === name);

describe("ActivationTelemetry.trace", () => {
	it("emits one 'activation' event with default authState=none", async () => {
		const { sink, activation } = makeHarness();
		await activation.trace(() => Promise.resolve());

		expect(sink.events).toHaveLength(1);
		expect(sink.events[0]).toMatchObject({
			eventName: "activation",
			properties: { authState: "none", result: "success" },
		});
	});

	it("setAuthState records the last value set during the trace", async () => {
		const { sink, activation } = makeHarness();
		await activation.trace((tracer) => {
			tracer.setAuthState("stored");
			tracer.setAuthState("valid_token");
			return Promise.resolve();
		});

		expect(sink.events[0].properties.authState).toBe("valid_token");
	});

	it("rethrows fn errors and emits result=error with the default authState", async () => {
		const { sink, activation } = makeHarness();
		const boom = new Error("nope");

		await expect(activation.trace(() => Promise.reject(boom))).rejects.toBe(
			boom,
		);
		expect(sink.events[0]).toMatchObject({
			properties: { authState: "none", result: "error" },
			error: { message: "nope" },
		});
	});
});

describe("ActivationTelemetry.traceDeploymentInit", () => {
	it("emits a sibling trace with its own traceId", async () => {
		const { sink, activation } = makeHarness();
		await activation.trace((tracer) =>
			tracer.traceDeploymentInit(() => Promise.resolve(true)),
		);

		const init = find(sink, "activation.deployment_init");
		const parent = find(sink, "activation");
		expect(init?.parentEventId).toBeUndefined();
		expect(init?.traceId).not.toBe(parent?.traceId);
	});

	it.each([
		{ ret: true, expected: "valid_token" },
		{ ret: false, expected: "expired" },
	])(
		"maps initFn returning $ret to authState=$expected",
		async ({ ret, expected }) => {
			const { sink, activation } = makeHarness();
			await activation.trace((tracer) =>
				tracer.traceDeploymentInit(() => Promise.resolve(ret)),
			);

			expect(find(sink, "activation.deployment_init")).toMatchObject({
				properties: { authState: expected, result: "success" },
			});
		},
	);

	it("records authState=unknown when initFn throws", async () => {
		const { sink, activation } = makeHarness();
		const boom = new Error("init failed");

		await activation.trace(async (tracer) => {
			await expect(
				tracer.traceDeploymentInit(() => Promise.reject(boom)),
			).rejects.toBe(boom);
		});

		expect(find(sink, "activation.deployment_init")).toMatchObject({
			properties: { authState: "unknown", result: "error" },
			error: { message: "init failed" },
		});
	});
});
