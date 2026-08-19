import { describe, expect, it } from "vitest";

import { WorkspaceUpdateCancelledError } from "@/api/updateParameters";
import {
	recordAgentState,
	recordWorkspaceState,
	TransitionTracker,
	WorkspaceAgentObserver,
	WorkspaceOperationTelemetry,
	WorkspaceStateObserver,
} from "@/instrumentation/workspace";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createTelemetryHarness } from "../../mocks/telemetry";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceBuild,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { TelemetryService } from "@/telemetry/service";

const WORKSPACE_NAME = "testuser/test-workspace";

function setup<T>(make: (svc: TelemetryService, name: string) => T) {
	const { sink, service } = createTelemetryHarness();
	return { sink, instance: make(service, WORKSPACE_NAME) };
}

const newOps = (svc: TelemetryService, name: string) =>
	new WorkspaceOperationTelemetry(svc, name);

function workspaceWith(
	status: WorkspaceStatus,
	agents: WorkspaceAgent[] = [],
	build: Partial<WorkspaceBuild> = {},
): Workspace {
	return createWorkspace({
		latest_build: {
			status,
			resources: [createResource({ agents })],
			...build,
		},
	});
}

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

describe("WorkspaceStateObserver", () => {
	it("reports the first observation with from=undefined and no durations", () => {
		const observer = new WorkspaceStateObserver();

		const transition = observer.observe(
			workspaceWith("running", [], {
				transition: "start",
				reason: "initiator",
			}),
		);

		expect(transition).toMatchObject({
			from: undefined,
			to: "running",
			buildTransition: "start",
			buildReason: "initiator",
			durationMs: undefined,
			buildDurationMs: undefined,
		});
	});

	it("returns undefined for a duplicate observation", () => {
		const observer = new WorkspaceStateObserver();
		const ws = workspaceWith("running");

		observer.observe(ws);

		expect(observer.observe(ws)).toBeUndefined();
	});

	it("reports the prior status and a duration on a change", () => {
		const observer = new WorkspaceStateObserver();

		observer.observe(workspaceWith("starting"));
		const transition = observer.observe(workspaceWith("running"));

		expect(transition).toMatchObject({ from: "starting", to: "running" });
		expect(transition?.durationMs).toEqual(expect.any(Number));
	});

	it("reports a change when only transition or reason changes", () => {
		const observer = new WorkspaceStateObserver();

		observer.observe(workspaceWith("running", [], { transition: "start" }));
		const transition = observer.observe(
			workspaceWith("running", [], { transition: "stop" }),
		);

		expect(transition).toMatchObject({
			from: "running",
			to: "running",
			buildTransition: "stop",
		});
	});

	it("sets buildDurationMs only when a provisioner run resolves", () => {
		const observer = new WorkspaceStateObserver();

		const first = observer.observe(workspaceWith("stopped"));
		const second = observer.observe(workspaceWith("starting"));
		const third = observer.observe(workspaceWith("running"));

		expect(first?.buildDurationMs).toBeUndefined();
		expect(second?.buildDurationMs).toBeUndefined();
		expect(third?.buildDurationMs).toEqual(expect.any(Number));
	});

	it("reset() makes the next observation report from=undefined again", () => {
		const observer = new WorkspaceStateObserver();

		observer.observe(workspaceWith("running"));
		observer.reset();

		expect(observer.observe(workspaceWith("running"))?.from).toBeUndefined();
	});
});

describe("WorkspaceAgentObserver", () => {
	it("reports the first observation of each agent with from=undefined", () => {
		const observer = new WorkspaceAgentObserver();

		const { transitions, removed } = observer.observe(
			workspaceWith("running", [
				createAgent({
					name: "main",
					status: "connecting",
					lifecycle_state: "created",
				}),
			]),
		);

		expect(removed).toEqual([]);
		expect(transitions).toHaveLength(1);
		expect(transitions[0]).toMatchObject({
			agentName: "main",
			status: { from: undefined, to: "connecting" },
			lifecycleState: { from: undefined, to: "created" },
			durationMs: undefined,
		});
	});

	it("dedupes an unchanged agent", () => {
		const observer = new WorkspaceAgentObserver();
		const ws = workspaceWith("running", [
			createAgent({ status: "connected", lifecycle_state: "ready" }),
		]);

		observer.observe(ws);

		expect(observer.observe(ws).transitions).toEqual([]);
	});

	it("tracks each agent independently", () => {
		const observer = new WorkspaceAgentObserver();

		observer.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first", status: "connected" }),
				createAgent({ id: "a2", name: "second", status: "connecting" }),
			]),
		);

		const { transitions } = observer.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first", status: "connected" }),
				createAgent({ id: "a2", name: "second", status: "connected" }),
			]),
		);

		expect(transitions).toHaveLength(1);
		expect(transitions[0]).toMatchObject({
			agentName: "second",
			status: { from: "connecting", to: "connected" },
		});
	});

	it("reports an agent that disappears since the previous observation", () => {
		const observer = new WorkspaceAgentObserver();

		observer.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first" }),
				createAgent({ id: "a2", name: "second" }),
			]),
		);

		const { removed } = observer.observe(
			workspaceWith("running", [createAgent({ id: "a1", name: "first" })]),
		);

		expect(removed).toEqual([{ name: "second" }]);
	});

	it("treats a returning agent id as a fresh observation after removal", () => {
		const observer = new WorkspaceAgentObserver();

		observer.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first", status: "connected" }),
			]),
		);
		observer.observe(workspaceWith("starting", []));
		const { transitions } = observer.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first", status: "connecting" }),
			]),
		);

		expect(transitions[0].status.from).toBeUndefined();
	});

	it("reset() forgets all agents", () => {
		const observer = new WorkspaceAgentObserver();
		const ws = workspaceWith("running", [createAgent({ status: "connected" })]);

		observer.observe(ws);
		observer.reset();

		expect(observer.observe(ws).transitions[0].status.from).toBeUndefined();
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

describe("TransitionTracker", () => {
	const equals = (a: string, b: string) => a === b;

	it("reports `from: undefined` on the first observation", () => {
		const tracker = new TransitionTracker<string>(equals);

		expect(tracker.observe("a")).toEqual({ from: undefined });
	});

	it("returns undefined when the value is unchanged", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a");

		expect(tracker.observe("a")).toBeUndefined();
	});

	it("returns the prior value when the value changes", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a");

		expect(tracker.observe("b")).toEqual({ from: "a" });
	});

	it("tracks keys independently", () => {
		const tracker = new TransitionTracker<string>(equals);

		expect(tracker.observe("a", "k1")).toEqual({ from: undefined });
		expect(tracker.observe("b", "k2")).toEqual({ from: undefined });
		expect(tracker.observe("a", "k1")).toBeUndefined();
		expect(tracker.observe("c", "k2")).toEqual({ from: "b" });
	});

	it("forgets a single key on reset", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a", "k1");
		tracker.reset("k1");

		expect(tracker.observe("a", "k1")).toEqual({ from: undefined });
	});

	it("forgets all keys on reset()", () => {
		const tracker = new TransitionTracker<string>(equals);

		tracker.observe("a", "k1");
		tracker.observe("b", "k2");
		tracker.reset();

		expect(tracker.observe("a", "k1")).toEqual({ from: undefined });
		expect(tracker.observe("b", "k2")).toEqual({ from: undefined });
	});
});
