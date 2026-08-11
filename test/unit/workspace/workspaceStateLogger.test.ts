import { describe, expect, it } from "vitest";

import { WorkspaceStateLogger } from "@/workspace/workspaceStateLogger";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createMockLogger } from "../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

function workspaceWith(
	status: WorkspaceStatus,
	agents: WorkspaceAgent[] = [],
): Workspace {
	return createWorkspace({
		latest_build: {
			status,
			resources: [createResource({ agents })],
		},
	});
}

describe("WorkspaceStateLogger", () => {
	it("logs the initial observed state with a `none` origin", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(
			workspaceWith("running", [
				createAgent({ status: "connected", lifecycle_state: "ready" }),
			]),
		);

		expect(logger.info).toHaveBeenCalledTimes(1);
		expect(logger.info).toHaveBeenCalledWith(
			"Workspace testuser/ws state changed",
			{
				workspaceStatus: { from: "none", to: "running" },
				agentStatus: { from: "none", to: "connected" },
				lifecycleState: { from: "none", to: "ready" },
			},
		);
	});

	it("logs a transition when the agent status and lifecycle change", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(
			workspaceWith("starting", [
				createAgent({ status: "connecting", lifecycle_state: "starting" }),
			]),
		);
		stateLogger.observe(
			workspaceWith("running", [
				createAgent({ status: "connected", lifecycle_state: "ready" }),
			]),
		);

		expect(logger.info).toHaveBeenCalledTimes(2);
		expect(logger.info).toHaveBeenLastCalledWith(
			"Workspace testuser/ws state changed",
			{
				workspaceStatus: { from: "starting", to: "running" },
				agentStatus: { from: "connecting", to: "connected" },
				lifecycleState: { from: "starting", to: "ready" },
			},
		);
	});

	it("does not log when nothing changes", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");
		const snapshot = workspaceWith("running", [
			createAgent({ status: "connected", lifecycle_state: "ready" }),
		]);

		stateLogger.observe(snapshot);
		stateLogger.observe(snapshot);

		expect(logger.info).toHaveBeenCalledTimes(1);
	});

	it("uses `none` for the agent dimensions while no agent exists yet", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(workspaceWith("pending"));

		expect(logger.info).toHaveBeenCalledWith(
			"Workspace testuser/ws state changed",
			{
				workspaceStatus: { from: "none", to: "pending" },
				agentStatus: { from: "none", to: "none" },
				lifecycleState: { from: "none", to: "none" },
			},
		);
	});

	it("tracks each agent independently", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first", status: "connected" }),
				createAgent({ id: "a2", name: "second", status: "connecting" }),
			]),
		);
		expect(logger.info).toHaveBeenCalledTimes(2);

		// Only the second agent changes; expect a single new log.
		stateLogger.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first", status: "connected" }),
				createAgent({ id: "a2", name: "second", status: "connected" }),
			]),
		);
		expect(logger.info).toHaveBeenCalledTimes(3);
	});
});
