import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	startWorkspace,
	updateWorkspace,
	streamBuildLogs,
	streamAgentLogs,
} from "@/api/workspace";
import { maybeAskAgent } from "@/promptUtils";
import { WorkspaceStateMachine } from "@/remote/workspaceStateMachine";

import {
	createMockLogger,
	MockProgress,
	MockTerminalOutputChannel,
	MockUserInteraction,
} from "../../mocks/testHelpers";
import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "../../mocks/workspace";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";
import type { StartupMode } from "@/core/mementoManager";
import type { FeatureSet } from "@/featureSet";
import type { AuthorityParts } from "@/util";

vi.mock("@/api/workspace", async (importActual) => {
	const { LazyStream } = await importActual<typeof import("@/api/workspace")>();
	return {
		LazyStream,
		startWorkspace: vi.fn().mockResolvedValue({}),
		updateWorkspace: vi.fn().mockResolvedValue({}),
		streamBuildLogs: vi.fn().mockResolvedValue({}),
		streamAgentLogs: vi.fn().mockResolvedValue({}),
	};
});

vi.mock("@/promptUtils", () => ({
	maybeAskAgent: vi.fn(),
}));

vi.mock("@/remote/terminalOutputChannel", async () => {
	const helpers = await import("../../mocks/testHelpers");
	return { TerminalOutputChannel: helpers.MockTerminalOutputChannel };
});

const DEFAULT_PARTS: Readonly<AuthorityParts> = {
	agent: "main",
	sshHost: "coder-vscode--testuser--test-workspace.main",
	safeHostname: "test.coder.com",
	username: "testuser",
	workspace: "test-workspace",
} as const;

// The message shown by confirmStartOrUpdate for our test workspace.
const CONFIRM_MESSAGE =
	"The workspace testuser/test-workspace is not running. How would you like to proceed?";

function runningWorkspace(
	agentOverrides: Partial<WorkspaceAgent> = {},
): Workspace {
	return createWorkspace({
		latest_build: {
			status: "running",
			resources: [createResource({ agents: [createAgent(agentOverrides)] })],
		},
	});
}

function setup(startupMode: StartupMode = "start") {
	const progress = new MockProgress<{ message?: string }>();
	const userInteraction = new MockUserInteraction();
	const sm = new WorkspaceStateMachine(
		DEFAULT_PARTS,
		{} as CoderApi,
		startupMode,
		"/usr/bin/coder",
		{} as FeatureSet,
		createMockLogger(),
		{ mode: "url", url: "https://test.coder.com" },
	);
	return { sm, progress, userInteraction };
}

describe("WorkspaceStateMachine", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		MockTerminalOutputChannel.lastInstance = undefined;
		vi.mocked(maybeAskAgent).mockImplementation((agents) =>
			Promise.resolve(agents.length > 0 ? agents[0] : undefined),
		);
	});

	describe("running workspace", () => {
		it("returns true when agent is connected and ready", async () => {
			const { sm, progress } = setup();
			expect(await sm.processWorkspace(runningWorkspace(), progress)).toBe(
				true,
			);
		});

		it("returns false when agent is connecting", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ status: "connecting" });
			expect(await sm.processWorkspace(ws, progress)).toBe(false);
		});

		it("returns false when agent times out", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ status: "timeout" });
			expect(await sm.processWorkspace(ws, progress)).toBe(false);
		});

		it("throws when agent is disconnected", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ status: "disconnected" });
			await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(
				"disconnected",
			);
		});

		it("triggers update and falls through to agent check", async () => {
			const { sm, progress } = setup("update");
			const ws = runningWorkspace();

			expect(await sm.processWorkspace(ws, progress)).toBe(true);
			expect(updateWorkspace).toHaveBeenCalledOnce();
		});

		it("re-resolves agent after update", async () => {
			const { sm, progress } = setup("start");
			const ws = runningWorkspace();

			// Resolve agent, then verify it's cached on the next call.
			await sm.processWorkspace(ws, progress);
			vi.mocked(maybeAskAgent).mockClear();

			await sm.processWorkspace(ws, progress);
			expect(maybeAskAgent).not.toHaveBeenCalled();

			// With update mode, the agent is cleared so it gets re-resolved.
			const { sm: smUpdate, progress: p2 } = setup("update");
			vi.mocked(maybeAskAgent).mockClear();
			await smUpdate.processWorkspace(ws, p2);
			expect(maybeAskAgent).toHaveBeenCalledOnce();
		});

		it("downgrades to 'start' mode after update", async () => {
			const { sm, progress } = setup("update");
			await sm.processWorkspace(runningWorkspace(), progress);
			vi.mocked(updateWorkspace).mockClear();

			await sm.processWorkspace(runningWorkspace(), progress);
			expect(updateWorkspace).not.toHaveBeenCalled();
		});
	});

	describe("stopped/failed workspace", () => {
		for (const status of ["stopped", "failed"] as const) {
			it(`auto-starts '${status}' workspace`, async () => {
				const { sm, progress } = setup("start");
				const ws = createWorkspace({ latest_build: { status } });

				expect(await sm.processWorkspace(ws, progress)).toBe(false);
				expect(startWorkspace).toHaveBeenCalledOnce();
			});
		}

		it("triggers update instead of start when mode is 'update'", async () => {
			const { sm, progress } = setup("update");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(updateWorkspace).toHaveBeenCalledOnce();
		});

		it("prompts user when mode is 'none' and user picks 'Start'", async () => {
			const { sm, progress, userInteraction } = setup("none");
			userInteraction.setResponse(CONFIRM_MESSAGE, "Start");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(startWorkspace).toHaveBeenCalledOnce();
			expect(updateWorkspace).not.toHaveBeenCalled();
		});

		it("offers 'Update and Start' for outdated workspace and triggers update", async () => {
			const { sm, progress, userInteraction } = setup("none");
			userInteraction.setResponse(CONFIRM_MESSAGE, "Update and Start");
			const ws = createWorkspace({
				outdated: true,
				latest_build: { status: "stopped" },
			});

			expect(await sm.processWorkspace(ws, progress)).toBe(false);

			const calls = userInteraction.getMessageCalls();
			expect(calls).toHaveLength(1);
			expect(calls[0].items).toEqual(["Start", "Update and Start"]);

			expect(updateWorkspace).toHaveBeenCalledOnce();
			expect(startWorkspace).not.toHaveBeenCalled();
		});

		it("does not offer 'Update and Start' when workspace is not outdated", async () => {
			const { sm, progress, userInteraction } = setup("none");
			userInteraction.setResponse(CONFIRM_MESSAGE, "Start");
			const ws = createWorkspace({
				outdated: false,
				latest_build: { status: "stopped" },
			});

			await sm.processWorkspace(ws, progress);

			const calls = userInteraction.getMessageCalls();
			expect(calls).toHaveLength(1);
			expect(calls[0].items).toEqual(["Start"]);
		});

		it("throws when user declines the prompt", async () => {
			const { sm, progress, userInteraction } = setup("none");
			userInteraction.setResponse(CONFIRM_MESSAGE, undefined);
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(
				"Workspace start cancelled",
			);
		});
	});

	describe("building workspace", () => {
		for (const status of ["pending", "starting", "stopping"] as const) {
			it(`returns false and streams build logs for '${status}'`, async () => {
				const { sm, progress } = setup();
				const ws = createWorkspace({ latest_build: { status } });

				expect(await sm.processWorkspace(ws, progress)).toBe(false);
				expect(streamBuildLogs).toHaveBeenCalledOnce();
			});
		}
	});

	describe("terminal states", () => {
		for (const status of [
			"deleted",
			"deleting",
			"canceled",
			"canceling",
		] as const) {
			it(`throws for '${status}'`, async () => {
				const { sm, progress } = setup();
				const ws = createWorkspace({ latest_build: { status } });
				await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(status);
			});
		}
	});

	describe("agent lifecycle", () => {
		it("returns true for non-blocking 'starting' agent", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ lifecycle_state: "starting", scripts: [] });
			expect(await sm.processWorkspace(ws, progress)).toBe(true);
		});

		it("returns false for 'starting' agent with blocking scripts", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({
				lifecycle_state: "starting",
				scripts: [
					{
						id: "script-1",
						log_source_id: "log-1",
						log_path: "",
						script: "#!/bin/bash",
						cron: "",
						run_on_start: true,
						run_on_stop: false,
						start_blocks_login: true,
						timeout: 0,
						display_name: "Startup",
					},
				],
			});
			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(streamAgentLogs).toHaveBeenCalledOnce();
		});

		it("returns false for 'created' agent", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ lifecycle_state: "created" });
			expect(await sm.processWorkspace(ws, progress)).toBe(false);
		});

		it("returns true for 'start_error' (continues anyway)", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ lifecycle_state: "start_error" });
			expect(await sm.processWorkspace(ws, progress)).toBe(true);
		});

		it("returns true for 'start_timeout' (continues anyway)", async () => {
			const { sm, progress } = setup();
			const ws = runningWorkspace({ lifecycle_state: "start_timeout" });
			expect(await sm.processWorkspace(ws, progress)).toBe(true);
		});

		for (const lifecycle_state of [
			"shutting_down",
			"off",
			"shutdown_error",
			"shutdown_timeout",
		] as const) {
			it(`throws for '${lifecycle_state}' lifecycle state`, async () => {
				const { sm, progress } = setup();
				const ws = runningWorkspace({ lifecycle_state });
				await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(
					"Invalid lifecycle state",
				);
			});
		}
	});

	describe("agent selection", () => {
		it("throws when user declines agent selection", async () => {
			vi.mocked(maybeAskAgent).mockResolvedValue(undefined);
			const { sm, progress } = setup();
			await expect(
				sm.processWorkspace(runningWorkspace(), progress),
			).rejects.toThrow("Agent selection cancelled");
		});

		it("throws when selected agent disappears from resources", async () => {
			const { sm, progress } = setup();
			await sm.processWorkspace(runningWorkspace(), progress);

			const wsNoAgents = createWorkspace({
				latest_build: { status: "running", resources: [] },
			});
			await expect(sm.processWorkspace(wsNoAgents, progress)).rejects.toThrow(
				"not found",
			);
		});
	});

	describe("progress reporting", () => {
		it("reports starting for stopped workspace", async () => {
			const { sm, progress } = setup("start");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });
			await sm.processWorkspace(ws, progress);

			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("starting"),
				}),
			);
		});

		it("reports updating for update mode", async () => {
			const { sm, progress } = setup("update");
			await sm.processWorkspace(runningWorkspace(), progress);

			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("updating"),
				}),
			);
		});
	});

	describe("getAgentId", () => {
		it("returns undefined before agent is resolved", () => {
			const { sm } = setup();
			expect(sm.getAgentId()).toBeUndefined();
		});

		it("returns agent ID after processing a running workspace", async () => {
			const { sm, progress } = setup();
			await sm.processWorkspace(runningWorkspace(), progress);
			expect(sm.getAgentId()).toBe("agent-1");
		});
	});

	describe("dispose", () => {
		it("can be disposed without errors", () => {
			const { sm } = setup();
			expect(() => sm.dispose()).not.toThrow();
		});
	});
});
