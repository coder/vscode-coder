import { describe, expect, it } from "vitest";

import { WorkspaceAgentLogger } from "@/workspace/workspaceAgentLogger";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createMockLogger } from "../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

function workspaceWith(agents: WorkspaceAgent[]): Workspace {
	return createWorkspace({
		latest_build: {
			status: "running",
			resources: [createResource({ agents })],
		},
	});
}

describe("WorkspaceAgentLogger", () => {
	it("logs the initial agent state with a `none` origin", () => {
		const logger = createMockLogger();
		const agentLogger = new WorkspaceAgentLogger(logger, "testuser/ws");

		agentLogger.observe(
			workspaceWith([
				createAgent({
					name: "main",
					status: "connected",
					lifecycle_state: "ready",
				}),
			]),
		);

		expect(logger.info).toHaveBeenCalledTimes(1);
		expect(logger.info).toHaveBeenCalledWith(
			"Workspace testuser/ws agent main state changed",
			{
				status: { from: "none", to: "connected" },
				lifecycleState: { from: "none", to: "ready" },
			},
		);
	});

	it("logs when the agent status or lifecycle changes", () => {
		const logger = createMockLogger();
		const agentLogger = new WorkspaceAgentLogger(logger, "testuser/ws");

		agentLogger.observe(
			workspaceWith([
				createAgent({ status: "connecting", lifecycle_state: "starting" }),
			]),
		);
		agentLogger.observe(
			workspaceWith([
				createAgent({ status: "connected", lifecycle_state: "ready" }),
			]),
		);

		expect(logger.info).toHaveBeenCalledTimes(2);
		expect(logger.info).toHaveBeenLastCalledWith(
			"Workspace testuser/ws agent main state changed",
			{
				status: { from: "connecting", to: "connected" },
				lifecycleState: { from: "starting", to: "ready" },
			},
		);
	});

	it("does not log when the agent state is unchanged", () => {
		const logger = createMockLogger();
		const agentLogger = new WorkspaceAgentLogger(logger, "testuser/ws");
		const snapshot = workspaceWith([
			createAgent({ status: "connected", lifecycle_state: "ready" }),
		]);

		agentLogger.observe(snapshot);
		agentLogger.observe(snapshot);

		expect(logger.info).toHaveBeenCalledTimes(1);
	});

	it("tracks each agent independently", () => {
		const logger = createMockLogger();
		const agentLogger = new WorkspaceAgentLogger(logger, "testuser/ws");

		agentLogger.observe(
			workspaceWith([
				createAgent({ id: "a1", name: "first", status: "connected" }),
				createAgent({ id: "a2", name: "second", status: "connecting" }),
			]),
		);
		expect(logger.info).toHaveBeenCalledTimes(2);

		// Only the second agent changes; expect a single new log.
		agentLogger.observe(
			workspaceWith([
				createAgent({ id: "a1", name: "first", status: "connected" }),
				createAgent({ id: "a2", name: "second", status: "connected" }),
			]),
		);
		expect(logger.info).toHaveBeenCalledTimes(3);
	});
});
