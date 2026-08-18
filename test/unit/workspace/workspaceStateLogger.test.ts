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

// Defaults supplied by the workspace mock factory.
const DEFAULT_TRANSITION = "start";
const DEFAULT_REASON = "initiator";

describe("WorkspaceStateLogger", () => {
	it("logs the initial observed status with a `none` origin", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(workspaceWith("running"));

		expect(logger.info).toHaveBeenCalledTimes(1);
		expect(logger.info).toHaveBeenCalledWith(
			"Workspace testuser/ws state changed",
			{
				status: { from: "none", to: "running" },
				transition: DEFAULT_TRANSITION,
				reason: DEFAULT_REASON,
			},
		);
	});

	it("logs once when the workspace status changes", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(workspaceWith("starting"));
		stateLogger.observe(workspaceWith("running"));

		expect(logger.info).toHaveBeenCalledTimes(2);
		expect(logger.info).toHaveBeenLastCalledWith(
			"Workspace testuser/ws state changed",
			{
				status: { from: "starting", to: "running" },
				transition: DEFAULT_TRANSITION,
				reason: DEFAULT_REASON,
			},
		);
	});

	it("logs when the transition or reason changes even if status is unchanged", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(workspaceWith("running", [], { transition: "start" }));
		stateLogger.observe(workspaceWith("running", [], { transition: "stop" }));

		expect(logger.info).toHaveBeenCalledTimes(2);
		expect(logger.info).toHaveBeenLastCalledWith(
			"Workspace testuser/ws state changed",
			{
				status: { from: "running", to: "running" },
				transition: "stop",
				reason: DEFAULT_REASON,
			},
		);
	});

	it("does not log when status, transition, and reason are unchanged", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(workspaceWith("running"));
		stateLogger.observe(workspaceWith("running"));

		expect(logger.info).toHaveBeenCalledTimes(1);
	});

	it("logs a workspace change exactly once regardless of agent count", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(
			workspaceWith("running", [
				createAgent({ id: "a1", name: "first" }),
				createAgent({ id: "a2", name: "second" }),
			]),
		);

		expect(logger.info).toHaveBeenCalledTimes(1);
	});

	it("ignores agent-only changes", () => {
		const logger = createMockLogger();
		const stateLogger = new WorkspaceStateLogger(logger, "testuser/ws");

		stateLogger.observe(
			workspaceWith("running", [createAgent({ status: "connecting" })]),
		);
		stateLogger.observe(
			workspaceWith("running", [createAgent({ status: "connected" })]),
		);

		expect(logger.info).toHaveBeenCalledTimes(1);
	});
});
