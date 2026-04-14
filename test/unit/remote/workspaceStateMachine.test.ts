import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceStateMachine } from "@/remote/workspaceStateMachine";

import { createMockLogger, MockProgress } from "../../mocks/testHelpers";
import { workspace as createWorkspace } from "../../mocks/workspace";

import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceResource,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";
import type { FeatureSet } from "@/featureSet";
import type { CliAuth } from "@/settings/cli";
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

vi.mock("@/vscodeProposed", () => ({
	vscodeProposed: {
		window: { showInformationMessage: vi.fn() },
	},
}));

vi.mock("@/remote/terminalSession", () => ({
	TerminalSession: vi.fn().mockImplementation(function () {
		return {
			writeEmitter: { fire: vi.fn(), event: vi.fn(), dispose: vi.fn() },
			terminal: { show: vi.fn(), dispose: vi.fn() },
			dispose: vi.fn(),
		};
	}),
}));

const { startWorkspace, updateWorkspace, streamBuildLogs } =
	await import("@/api/workspace");
const { maybeAskAgent } = await import("@/promptUtils");
const { vscodeProposed } = await import("@/vscodeProposed");

function createAgent(overrides: Partial<WorkspaceAgent> = {}): WorkspaceAgent {
	return {
		id: "agent-1",
		name: "main",
		status: "connected",
		lifecycle_state: "ready",
		scripts: [],
		...overrides,
	} as unknown as WorkspaceAgent;
}

function runningWorkspace(
	agentOverrides: Partial<WorkspaceAgent> = {},
): Workspace {
	return createWorkspace({
		latest_build: {
			status: "running",
			resources: [
				{
					agents: [createAgent(agentOverrides)],
				} as unknown as WorkspaceResource,
			],
		},
	});
}

function createStateMachine(
	startupMode: "prompt" | "start" | "update" = "start",
) {
	return new WorkspaceStateMachine(
		{ agent: "main" } as unknown as AuthorityParts,
		{} as CoderApi,
		startupMode,
		"/usr/bin/coder",
		{} as FeatureSet,
		createMockLogger(),
		{ mode: "url", url: "https://test.coder.com" } as CliAuth,
	);
}

describe("WorkspaceStateMachine", () => {
	let progress: MockProgress<{ message?: string }>;

	beforeEach(() => {
		vi.clearAllMocks();
		progress = new MockProgress();
		vi.mocked(maybeAskAgent).mockImplementation((agents) =>
			Promise.resolve(agents.length > 0 ? agents[0] : undefined),
		);
	});

	describe("running workspace", () => {
		it("returns true when agent is connected and ready", async () => {
			const sm = createStateMachine();
			expect(await sm.processWorkspace(runningWorkspace(), progress)).toBe(
				true,
			);
		});

		it("returns false when agent is connecting", async () => {
			const sm = createStateMachine();
			const ws = runningWorkspace({ status: "connecting" });
			expect(await sm.processWorkspace(ws, progress)).toBe(false);
		});

		it("throws when agent is disconnected", async () => {
			const sm = createStateMachine();
			const ws = runningWorkspace({ status: "disconnected" });
			await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(
				"disconnected",
			);
		});

		it("triggers update and falls through to agent check", async () => {
			const sm = createStateMachine("update");
			const ws = runningWorkspace();

			expect(await sm.processWorkspace(ws, progress)).toBe(true);
			expect(updateWorkspace).toHaveBeenCalledOnce();
		});

		it("re-resolves agent after update", async () => {
			const sm = createStateMachine("start");
			const ws = runningWorkspace();

			// Resolve agent, then verify it's cached on the next call.
			await sm.processWorkspace(ws, progress);
			vi.mocked(maybeAskAgent).mockClear();

			await sm.processWorkspace(ws, progress);
			expect(maybeAskAgent).not.toHaveBeenCalled();

			// With update mode, the agent is cleared so it gets re-resolved.
			const smUpdate = createStateMachine("update");
			vi.mocked(maybeAskAgent).mockClear();
			await smUpdate.processWorkspace(ws, progress);
			expect(maybeAskAgent).toHaveBeenCalledOnce();
		});

		it("downgrades to 'start' mode after update", async () => {
			const sm = createStateMachine("update");
			await sm.processWorkspace(runningWorkspace(), progress);
			vi.mocked(updateWorkspace).mockClear();

			await sm.processWorkspace(runningWorkspace(), progress);
			expect(updateWorkspace).not.toHaveBeenCalled();
		});
	});

	describe("stopped/failed workspace", () => {
		for (const status of ["stopped", "failed"] as const) {
			it(`auto-starts '${status}' workspace`, async () => {
				const sm = createStateMachine("start");
				const ws = createWorkspace({ latest_build: { status } });

				expect(await sm.processWorkspace(ws, progress)).toBe(false);
				expect(startWorkspace).toHaveBeenCalledOnce();
			});
		}

		it("triggers update instead of start when mode is 'update'", async () => {
			const sm = createStateMachine("update");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(updateWorkspace).toHaveBeenCalledOnce();
		});

		it("prompts user when mode is 'prompt' and user accepts", async () => {
			vi.mocked(vscodeProposed.window.showInformationMessage).mockResolvedValue(
				"Start" as never,
			);
			const sm = createStateMachine("prompt");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(startWorkspace).toHaveBeenCalledOnce();
		});

		it("throws when user declines start prompt", async () => {
			vi.mocked(vscodeProposed.window.showInformationMessage).mockResolvedValue(
				undefined as never,
			);
			const sm = createStateMachine("prompt");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(
				"Workspace start cancelled",
			);
		});
	});

	describe("building workspace", () => {
		for (const status of ["pending", "starting", "stopping"] as const) {
			it(`returns false and streams build logs for '${status}'`, async () => {
				const sm = createStateMachine();
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
				const sm = createStateMachine();
				const ws = createWorkspace({ latest_build: { status } });
				await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(status);
			});
		}
	});

	describe("agent lifecycle", () => {
		it("returns true for non-blocking 'starting' agent", async () => {
			const sm = createStateMachine();
			const ws = runningWorkspace({ lifecycle_state: "starting", scripts: [] });
			expect(await sm.processWorkspace(ws, progress)).toBe(true);
		});

		it("returns false for 'starting' agent with blocking scripts", async () => {
			const sm = createStateMachine();
			const ws = runningWorkspace({
				lifecycle_state: "starting",
				scripts: [
					{
						start_blocks_login: true,
					} as unknown as WorkspaceAgent["scripts"][0],
				],
			});
			expect(await sm.processWorkspace(ws, progress)).toBe(false);
		});

		it("returns true for 'start_error' (continues anyway)", async () => {
			const sm = createStateMachine();
			expect(
				await sm.processWorkspace(
					runningWorkspace({ lifecycle_state: "start_error" }),
					progress,
				),
			).toBe(true);
		});

		it("throws for 'off' lifecycle state", async () => {
			const sm = createStateMachine();
			await expect(
				sm.processWorkspace(
					runningWorkspace({ lifecycle_state: "off" }),
					progress,
				),
			).rejects.toThrow("Invalid lifecycle state");
		});
	});

	describe("agent selection", () => {
		it("throws when user declines agent selection", async () => {
			vi.mocked(maybeAskAgent).mockResolvedValue(undefined);
			const sm = createStateMachine();
			await expect(
				sm.processWorkspace(runningWorkspace(), progress),
			).rejects.toThrow("Agent selection cancelled");
		});

		it("throws when selected agent disappears from resources", async () => {
			const sm = createStateMachine();
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
			const sm = createStateMachine("start");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });
			await sm.processWorkspace(ws, progress);

			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("starting"),
				}),
			);
		});

		it("reports updating for update mode", async () => {
			const sm = createStateMachine("update");
			await sm.processWorkspace(runningWorkspace(), progress);

			expect(progress.report).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("updating"),
				}),
			);
		});
	});

	describe("dispose", () => {
		it("can be disposed without errors", () => {
			expect(() => createStateMachine().dispose()).not.toThrow();
		});
	});
});
