import { describe, expect, it } from "vitest";

import {
	TransitionTracker,
	WorkspaceAgentObserver,
	WorkspaceStateObserver,
} from "@/workspace/observers";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceBuild,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

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
