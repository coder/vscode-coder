import { describe, expect, it } from "vitest";

import {
	WorkspaceAgentObserver,
	WorkspaceStateObserver,
} from "@/workspace/observers";

import { agent as createAgent } from "@repo/mocks";

import { workspaceWith } from "../../mocks/testHelpers";

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
});

describe("WorkspaceAgentObserver", () => {
	it("reports the first observation of each agent with statusFrom=undefined", () => {
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
			statusFrom: undefined,
			statusTo: "connecting",
			lifecycleFrom: undefined,
			lifecycleTo: "created",
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

	it("reports a change when only the lifecycle state changes", () => {
		const observer = new WorkspaceAgentObserver();

		observer.observe(
			workspaceWith("running", [
				createAgent({ status: "connected", lifecycle_state: "starting" }),
			]),
		);
		const { transitions } = observer.observe(
			workspaceWith("running", [
				createAgent({ status: "connected", lifecycle_state: "ready" }),
			]),
		);

		expect(transitions).toHaveLength(1);
		expect(transitions[0]).toMatchObject({
			statusFrom: "connected",
			statusTo: "connected",
			lifecycleFrom: "starting",
			lifecycleTo: "ready",
		});
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
			statusFrom: "connecting",
			statusTo: "connected",
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

		expect(removed).toEqual(["second"]);
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

		expect(transitions[0].statusFrom).toBeUndefined();
	});
});
