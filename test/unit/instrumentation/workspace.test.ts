import { describe, expect, it } from "vitest";

import { WorkspaceUpdateCancelledError } from "@/api/updateParameters";
import {
	recordAgentState,
	recordWorkspaceState,
	WorkspaceOperationTelemetry,
} from "@/instrumentation/workspace";

import { createTelemetryHarness } from "../../mocks/telemetry";

import type { TelemetryService } from "@/telemetry/service";

const WORKSPACE_NAME = "testuser/test-workspace";

function setup<T>(make: (svc: TelemetryService, name: string) => T) {
	const { sink, service } = createTelemetryHarness();
	return { sink, instance: make(service, WORKSPACE_NAME) };
}

const newOps = (svc: TelemetryService, name: string) =>
	new WorkspaceOperationTelemetry(svc, name);

describe("WorkspaceOperationTelemetry", () => {
	it.each([
		{
			method: "traceStart" as const,
			event: "workspace.start.triggered",
		},
		{
			method: "traceUpdate" as const,
			event: "workspace.update.triggered",
		},
	])("$method emits $event with result=success", async ({ method, event }) => {
		const { sink, instance: ops } = setup(newOps);

		await ops[method](() => Promise.resolve());

		expect(sink.expectOne(event)).toMatchObject({
			properties: { workspace_name: WORKSPACE_NAME, result: "success" },
		});
	});

	it.each([
		{
			method: "traceStart" as const,
			event: "workspace.start.triggered",
		},
		{
			method: "traceUpdate" as const,
			event: "workspace.update.triggered",
		},
	])("$method emits result=error and rethrows", async ({ method, event }) => {
		const { sink, instance: ops } = setup(newOps);
		const boom = new Error("nope");

		await expect(ops[method](() => Promise.reject(boom))).rejects.toBe(boom);
		expect(sink.expectOne(event)).toMatchObject({
			properties: { result: "error" },
			error: { message: "nope" },
		});
	});

	describe("traceStartPrompt", () => {
		it("emits result=success with accepted action", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceStartPrompt(true, () =>
				Promise.resolve("update"),
			);

			expect(result).toBe("update");
			expect(sink.expectOne("workspace.start.prompted")).toMatchObject({
				properties: {
					workspace_name: WORKSPACE_NAME,
					update_offered: "true",
					action: "update",
					result: "success",
				},
			});
		});

		it("emits result=aborted when dismissed", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceStartPrompt(false, () =>
				Promise.resolve(undefined),
			);

			expect(result).toBeUndefined();
			expect(sink.expectOne("workspace.start.prompted")).toMatchObject({
				properties: {
					update_offered: "false",
					result: "aborted",
				},
			});
		});
	});

	describe("traceParametersPrompt", () => {
		it("returns the collected parameters and emits result=success", async () => {
			const { sink, instance: ops } = setup(newOps);
			const collected = [{ name: "region", value: "us-east" }];

			const result = await ops.traceParametersPrompt(() =>
				Promise.resolve(collected),
			);

			expect(result).toEqual(collected);
			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: {
					workspace_name: WORKSPACE_NAME,
					prompt: "parameters",
					result: "success",
				},
			});
		});

		it("emits result=aborted (no error block) and rethrows on cancellation", async () => {
			const { sink, instance: ops } = setup(newOps);
			const cancel = new WorkspaceUpdateCancelledError();

			await expect(
				ops.traceParametersPrompt(() => Promise.reject(cancel)),
			).rejects.toBe(cancel);

			const event = sink.expectOne("workspace.update.prompted");
			expect(event.properties.result).toBe("aborted");
			expect(event.error).toBeUndefined();
		});

		it("propagates non-cancellation errors as result=error", async () => {
			const { sink, instance: ops } = setup(newOps);
			const boom = new Error("rest call failed");

			await expect(
				ops.traceParametersPrompt(() => Promise.reject(boom)),
			).rejects.toBe(boom);

			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: { result: "error" },
				error: { message: "rest call failed" },
			});
		});
	});

	describe("traceConfirmationPrompt", () => {
		it("emits result=success with accepted action", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceConfirmationPrompt(() =>
				Promise.resolve("Update and Restart"),
			);

			expect(result).toBe("Update and Restart");
			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: {
					workspace_name: WORKSPACE_NAME,
					action: "update",
					prompt: "confirmation",
					result: "success",
				},
			});
		});

		it("emits result=aborted when dismissed", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceConfirmationPrompt(() =>
				Promise.resolve(undefined),
			);

			expect(result).toBeUndefined();
			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: {
					prompt: "confirmation",
					result: "aborted",
				},
			});
		});
	});
});

describe("recordWorkspaceState", () => {
	it("emits workspace.state_transitioned with flat dotted keys", () => {
		const { sink, service } = createTelemetryHarness();

		recordWorkspaceState(service, WORKSPACE_NAME, {
			from: "starting",
			to: "running",
			buildTransition: "start",
			buildReason: "initiator",
			durationMs: 1200,
			buildDurationMs: 3400,
		});

		const event = sink.expectOne("workspace.state_transitioned");
		expect(event.properties).toMatchObject({
			workspace_name: WORKSPACE_NAME,
			from: "starting",
			to: "running",
			"build.transition": "start",
			"build.reason": "initiator",
		});
		expect(event.measurements).toMatchObject({
			observed_duration_ms: 1200,
			observed_build_duration_ms: 3400,
		});
	});

	it("uses the sentinel for from and omits absent measurements", () => {
		const { sink, service } = createTelemetryHarness();

		recordWorkspaceState(service, WORKSPACE_NAME, {
			from: undefined,
			to: "running",
			buildTransition: "start",
			buildReason: "initiator",
			durationMs: undefined,
			buildDurationMs: undefined,
		});

		const event = sink.expectOne("workspace.state_transitioned");
		expect(event.properties.from).toBe("none");
		expect(event.measurements.observed_duration_ms).toBeUndefined();
		expect(event.measurements.observed_build_duration_ms).toBeUndefined();
	});
});

describe("recordAgentState", () => {
	it("emits workspace.agent.state_transitioned with flat dotted keys", () => {
		const { sink, service } = createTelemetryHarness();

		recordAgentState(service, WORKSPACE_NAME, {
			agentName: "main",
			status: { from: "connecting", to: "connected" },
			lifecycleState: { from: "starting", to: "ready" },
			durationMs: 800,
		});

		const event = sink.expectOne("workspace.agent.state_transitioned");
		expect(event.properties).toMatchObject({
			workspace_name: WORKSPACE_NAME,
			agent_name: "main",
			"status.from": "connecting",
			"status.to": "connected",
			"lifecycle_state.from": "starting",
			"lifecycle_state.to": "ready",
		});
		expect(event.measurements.observed_duration_ms).toBe(800);
	});

	it("uses the sentinel for absent from values and omits duration", () => {
		const { sink, service } = createTelemetryHarness();

		recordAgentState(service, WORKSPACE_NAME, {
			agentName: "main",
			status: { from: undefined, to: "connecting" },
			lifecycleState: { from: undefined, to: "created" },
			durationMs: undefined,
		});

		const event = sink.expectOne("workspace.agent.state_transitioned");
		expect(event.properties["status.from"]).toBe("none");
		expect(event.properties["lifecycle_state.from"]).toBe("none");
		expect(event.measurements.observed_duration_ms).toBeUndefined();
	});
});
