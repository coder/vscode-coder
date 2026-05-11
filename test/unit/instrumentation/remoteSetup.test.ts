import { describe, expect, it } from "vitest";

import { RemoteSetupTelemetry } from "@/instrumentation/remoteSetup";

import { createTestTelemetryService, TestSink } from "../../mocks/telemetry";
import { MockConfigurationProvider } from "../../mocks/testHelpers";

function makeHarness() {
	new MockConfigurationProvider().set("coder.telemetry.level", "local");
	const sink = new TestSink();
	return {
		sink,
		remoteSetup: new RemoteSetupTelemetry(createTestTelemetryService(sink)),
	};
}

describe("RemoteSetupTelemetry", () => {
	it("emits a single 'remote.setup' event when no phases run", async () => {
		const { sink, remoteSetup } = makeHarness();
		await remoteSetup.trace(() => Promise.resolve());

		expect(sink.events).toHaveLength(1);
		expect(sink.events[0]).toMatchObject({
			eventName: "remote.setup",
			properties: { result: "success" },
		});
		expect(sink.events[0].properties.outcome).toBeUndefined();
	});

	it("emits each named phase as a child of remote.setup with shared traceId", async () => {
		const { sink, remoteSetup } = makeHarness();
		await remoteSetup.trace(async (tracer) => {
			await tracer.phase("workspace_lookup", () => "ws");
			await tracer.phase("ssh_config_write", () => Promise.resolve("cfg"));
		});

		const [lookup, sshWrite, parent] = sink.events;
		expect(lookup.eventName).toBe("remote.setup.workspace_lookup");
		expect(sshWrite.eventName).toBe("remote.setup.ssh_config_write");
		expect(parent.eventName).toBe("remote.setup");
		expect(lookup.traceId).toBe(parent.traceId);
		expect(sshWrite.traceId).toBe(parent.traceId);
		expect(lookup.parentEventId).toBe(parent.eventId);
		expect(sshWrite.parentEventId).toBe(parent.eventId);
	});

	it("markAborted records the outcome and flips result to aborted", async () => {
		const { sink, remoteSetup } = makeHarness();
		await remoteSetup.trace((tracer) => {
			tracer.markAborted("workspace_not_found");
			return Promise.resolve();
		});

		expect(sink.events[0]).toMatchObject({
			properties: { outcome: "workspace_not_found", result: "aborted" },
		});
	});

	it("propagates errors from phases up through the parent", async () => {
		const { sink, remoteSetup } = makeHarness();
		const boom = new Error("phase broke");

		await expect(
			remoteSetup.trace((tracer) =>
				tracer.phase("workspace_lookup", () => Promise.reject(boom)),
			),
		).rejects.toBe(boom);

		const [phase, parent] = sink.events;
		expect(phase).toMatchObject({
			eventName: "remote.setup.workspace_lookup",
			properties: { result: "error" },
		});
		expect(parent).toMatchObject({
			properties: { result: "error" },
			error: { message: "phase broke" },
		});
	});
});
