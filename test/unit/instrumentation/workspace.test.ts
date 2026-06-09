import { describe, expect, it } from "vitest";

import { WorkspaceUpdateCancelledError } from "@/api/updateParameters";
import {
	WorkspaceAgentTelemetry,
	WorkspaceOperationTelemetry,
	WorkspaceStateTelemetry,
} from "@/instrumentation/workspace";

import {
	agent as createAgent,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createTelemetryHarness } from "../../mocks/telemetry";

import type { TelemetryService } from "@/telemetry/service";

const WORKSPACE_NAME = "testuser/test-workspace";

function setup<T>(make: (svc: TelemetryService, name: string) => T) {
	const { sink, service } = createTelemetryHarness();
	return { sink, instance: make(service, WORKSPACE_NAME) };
}

const newOps = (svc: TelemetryService, name: string) =>
	new WorkspaceOperationTelemetry(svc, name);
const newState = (svc: TelemetryService, name: string) =>
	new WorkspaceStateTelemetry(svc, name);
const newAgentTelemetry = (svc: TelemetryService, name: string) =>
	new WorkspaceAgentTelemetry(svc, name);

describe("WorkspaceOperationTelemetry", () => {
	it.each([
		{
			method: "traceStartTriggered" as const,
			event: "workspace.start.triggered",
		},
		{
			method: "traceUpdateTriggered" as const,
			event: "workspace.update.triggered",
		},
	])("$method emits $event with result=success", async ({ method, event }) => {
		const { sink, instance: ops } = setup(newOps);

		await ops[method](() => Promise.resolve());

		expect(sink.expectOne(event)).toMatchObject({
			properties: { workspaceName: WORKSPACE_NAME, result: "success" },
		});
	});

	it.each([
		{
			method: "traceStartTriggered" as const,
			event: "workspace.start.triggered",
		},
		{
			method: "traceUpdateTriggered" as const,
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

	describe("traceStartPrompted", () => {
		it("emits result=success with accepted action", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceStartPrompted(true, () =>
				Promise.resolve("update"),
			);

			expect(result).toBe("update");
			expect(sink.expectOne("workspace.start.prompted")).toMatchObject({
				properties: {
					update_offered: "true",
					action: "update",
					result: "success",
				},
			});
		});

		it("emits result=aborted when dismissed", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceStartPrompted(false, () =>
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

	describe("traceUpdatePrompted", () => {
		it("returns the collected parameters and emits result=success", async () => {
			const { sink, instance: ops } = setup(newOps);
			const collected = [{ name: "region", value: "us-east" }];

			const result = await ops.traceUpdatePrompted(() =>
				Promise.resolve(collected),
			);

			expect(result).toEqual(collected);
			const event = sink.expectOne("workspace.update.prompted");
			expect(event.properties).toMatchObject({
				prompt: "parameters",
				result: "success",
			});
			expect(event.properties.workspaceName).toBeUndefined();
		});

		it("emits result=aborted (no error block) and rethrows on cancellation", async () => {
			const { sink, instance: ops } = setup(newOps);
			const cancel = new WorkspaceUpdateCancelledError();

			await expect(
				ops.traceUpdatePrompted(() => Promise.reject(cancel)),
			).rejects.toBe(cancel);

			const event = sink.expectOne("workspace.update.prompted");
			expect(event.properties.result).toBe("aborted");
			expect(event.error).toBeUndefined();
		});

		it("propagates non-cancellation errors as result=error", async () => {
			const { sink, instance: ops } = setup(newOps);
			const boom = new Error("rest call failed");

			await expect(
				ops.traceUpdatePrompted(() => Promise.reject(boom)),
			).rejects.toBe(boom);

			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: { result: "error" },
				error: { message: "rest call failed" },
			});
		});
	});

	describe("traceUpdateConfirmationPrompted", () => {
		it("emits result=success with accepted action", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceUpdateConfirmationPrompted(() =>
				Promise.resolve("Update and Restart"),
			);

			expect(result).toBe("Update and Restart");
			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: {
					action: "update",
					prompt: "confirmation",
					result: "success",
				},
			});
		});

		it("emits result=aborted when dismissed", async () => {
			const { sink, instance: ops } = setup(newOps);

			const result = await ops.traceUpdateConfirmationPrompted(() =>
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

describe("WorkspaceStateTelemetry.observe", () => {
	it("emits the first observation with from=none and no duration", () => {
		const { sink, instance: state } = setup(newState);

		state.observe(
			createWorkspace({
				latest_build: {
					status: "running",
					transition: "start",
					reason: "initiator",
				},
			}),
		);

		const event = sink.expectOne("workspace.state_transitioned");
		expect(event.properties).toMatchObject({
			workspaceName: WORKSPACE_NAME,
			from: "none",
			to: "running",
			"build.transition": "start",
			"build.reason": "initiator",
		});
		expect(event.measurements.observedDurationMs).toBeUndefined();
	});

	it("ignores duplicate observations of the same state", () => {
		const { sink, instance: state } = setup(newState);
		const ws = createWorkspace({ latest_build: { status: "running" } });

		state.observe(ws);
		state.observe(ws);

		expect(sink.eventsNamed("workspace.state_transitioned")).toHaveLength(1);
	});

	it("records observedDurationMs across transitions and observedBuildDurationMs once a build resolves", () => {
		const { sink, instance: state } = setup(newState);

		state.observe(createWorkspace({ latest_build: { status: "stopped" } }));
		state.observe(createWorkspace({ latest_build: { status: "starting" } }));
		state.observe(createWorkspace({ latest_build: { status: "running" } }));

		const [first, second, third] = sink.eventsNamed(
			"workspace.state_transitioned",
		);
		expect(first.measurements.observedDurationMs).toBeUndefined();
		expect(second.measurements.observedDurationMs).toEqual(expect.any(Number));
		expect(second.measurements.observedBuildDurationMs).toBeUndefined();
		expect(third.measurements.observedBuildDurationMs).toEqual(
			expect.any(Number),
		);
	});
});

describe("WorkspaceAgentTelemetry.observe", () => {
	it("emits the first observation with from=none", () => {
		const { sink, instance: agentTelemetry } = setup(newAgentTelemetry);

		agentTelemetry.observe(
			createAgent({ status: "connecting", lifecycle_state: "created" }),
		);

		expect(sink.expectOne("workspace.agent.state_transitioned")).toMatchObject({
			properties: {
				"status.from": "none",
				"status.to": "connecting",
				"lifecycle_state.from": "none",
				"lifecycle_state.to": "created",
			},
		});
	});

	it("dedupes consecutive identical observations", () => {
		const { sink, instance: agentTelemetry } = setup(newAgentTelemetry);
		const a = createAgent({ status: "connected", lifecycle_state: "ready" });

		agentTelemetry.observe(a);
		agentTelemetry.observe(a);

		expect(sink.eventsNamed("workspace.agent.state_transitioned")).toHaveLength(
			1,
		);
	});

	it("reset() makes the next observation emit from=none again", () => {
		const { sink, instance: agentTelemetry } = setup(newAgentTelemetry);

		agentTelemetry.observe(createAgent({ status: "connected" }));
		agentTelemetry.reset();
		agentTelemetry.observe(createAgent({ status: "connecting" }));

		const events = sink.eventsNamed("workspace.agent.state_transitioned");
		expect(events).toHaveLength(2);
		expect(events[1].properties["status.from"]).toBe("none");
	});

	it("includes observedDurationMs between transitions", () => {
		const { sink, instance: agentTelemetry } = setup(newAgentTelemetry);

		agentTelemetry.observe(createAgent({ status: "connecting" }));
		agentTelemetry.observe(createAgent({ status: "connected" }));

		const events = sink.eventsNamed("workspace.agent.state_transitioned");
		expect(events[1].measurements.observedDurationMs).toEqual(
			expect.any(Number),
		);
	});
});
