import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	collectUpdateParameters,
	WorkspaceUpdateCancelledError,
} from "@/api/updateParameters";
import {
	startWorkspace,
	updateWorkspace,
	streamBuildLogs,
	streamAgentLogs,
} from "@/api/workspace";
import { maybeAskAgent } from "@/promptUtils";
import { WorkspaceStateMachine } from "@/remote/workspaceStateMachine";
import { WorkspaceUpdatePanelFactory } from "@/webviews/workspaceUpdate/workspaceUpdatePanelFactory";

import { agent as createAgent, workspace as mockWorkspace } from "@repo/mocks";

import {
	createTestTelemetryService,
	enableLocalTelemetry,
	TestSink,
} from "../../mocks/telemetry";
import {
	createMockLogger,
	createMockServiceContainer,
	MockConfigurationProvider,
	MockProgress,
	MockTerminalOutputChannel,
	MockUserInteraction,
} from "../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";
import type { StartupMode } from "@/core/mementoManager";
import type { CliFeatureSet } from "@/featureSet";
import type { TelemetryService } from "@/telemetry/service";
import type { AuthorityParts } from "@/util/authority";

vi.mock("@/api/workspace", async (importActual) => {
	const { LazyStream } = await importActual<typeof import("@/api/workspace")>();
	const { MockEventStream } = await import("../../mocks/testHelpers");
	const stream = () => Promise.resolve(new MockEventStream());
	return {
		LazyStream,
		startWorkspace: vi.fn((ctx: { workspace: Workspace }) =>
			Promise.resolve(ctx.workspace),
		),
		updateWorkspace: vi.fn((ctx: { workspace: Workspace }) =>
			Promise.resolve(ctx.workspace),
		),
		streamBuildLogs: vi.fn(stream),
		streamAgentLogs: vi.fn(stream),
	};
});

vi.mock("@/api/updateParameters", async (importActual) => {
	const actual = await importActual<typeof import("@/api/updateParameters")>();
	return {
		...actual,
		collectUpdateParameters: vi.fn(() => Promise.resolve([])),
	};
});

vi.mock("@/promptUtils", () => ({
	maybeAskAgent: vi.fn((agents: WorkspaceAgent[]) =>
		Promise.resolve(agents.length > 0 ? agents[0] : undefined),
	),
}));

vi.mock("@/remote/terminalOutputChannel", async () => {
	const helpers = await import("../../mocks/testHelpers");
	return { TerminalOutputChannel: helpers.MockTerminalOutputChannel };
});

const DEFAULT_PARTS: Readonly<AuthorityParts> = {
	agent: "main",
	hostPrefix: "coder-vscode.test.coder.com--",
	sshHost: "coder-vscode--testuser--test-workspace.main",
	safeHostname: "test.coder.com",
	username: "testuser",
	workspace: "test-workspace",
} as const;

// The message shown by confirmStartOrUpdate for our test workspace.
const CONFIRM_MESSAGE =
	"The workspace testuser/test-workspace is not running. How would you like to proceed?";
// The message shown by confirmConnectToExisting.
const UPDATE_FAILED_MESSAGE = "Failed to update testuser/test-workspace";

/** Classic parameters unless overridden. */
function createWorkspace(
	overrides: Parameters<typeof mockWorkspace>[0] = {},
): Workspace {
	return mockWorkspace({
		template_use_classic_parameter_flow: true,
		...overrides,
	});
}

function runningWorkspace(
	agentOverrides: Partial<WorkspaceAgent> = {},
	buildOverrides: Partial<Workspace["latest_build"]> = {},
): Workspace {
	return createWorkspace({
		agents: [createAgent(agentOverrides)],
		latest_build: { status: "running", ...buildOverrides },
	});
}

function setup(
	startupMode: StartupMode = "start",
	telemetry?: TelemetryService,
) {
	enableLocalTelemetry();
	const progress = new MockProgress<{ message?: string }>();
	const userInteraction = new MockUserInteraction();
	const container = createMockServiceContainer({
		telemetry,
		logger: createMockLogger(),
	});
	const sm = new WorkspaceStateMachine(
		DEFAULT_PARTS,
		{} as CoderApi,
		startupMode,
		"/usr/bin/coder",
		{} as CliFeatureSet,
		{ tasks: false, onSuccessBuild: true },
		{
			store: "cli",
			url: "https://test.coder.com",
			useKeyring: undefined,
			allowRedirects: false,
		},
		container,
	);
	return { sm, progress, userInteraction, container };
}

/** A workspace at the given build number, with the given build overrides. */
function workspaceAtBuild(
	buildNumber: number,
	overrides: Partial<Workspace["latest_build"]>,
): Workspace {
	return runningWorkspace(
		{},
		{ id: `build-${buildNumber}`, build_number: buildNumber, ...overrides },
	);
}

/** Update mode; the update resolves with build 2, a queued stop. */
function setupUpdate() {
	vi.mocked(updateWorkspace).mockResolvedValueOnce(
		workspaceAtBuild(2, { status: "stopping", transition: "stop" }),
	);
	const { sm, progress } = setup("update");
	return {
		progress,
		process: (status: Workspace["latest_build"]["status"], number: number) =>
			sm.processWorkspace(workspaceAtBuild(number, { status }), progress),
	};
}

describe("WorkspaceStateMachine", () => {
	beforeEach(() => {
		// `vi.mock` factories hold the default implementations.
		vi.resetAllMocks();
		new MockConfigurationProvider();
		MockTerminalOutputChannel.lastInstance = undefined;
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

		it("falls through to the agent check after an update completes", async () => {
			vi.mocked(updateWorkspace).mockResolvedValueOnce(runningWorkspace());
			const { sm, progress } = setup("update");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(true);
			expect(updateWorkspace).toHaveBeenCalledOnce();
			expect(sm.getWorkspace()?.latest_build.status).toBe("running");
		});

		it("starts the existing version when the update fails and the user accepts", async () => {
			vi.mocked(updateWorkspace).mockRejectedValueOnce(
				new Error("template not found"),
			);
			const { sm, progress, userInteraction } = setup("update");
			userInteraction.setResponse(UPDATE_FAILED_MESSAGE, "Connect Anyway");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(startWorkspace).toHaveBeenCalledOnce();
			expect(userInteraction.getMessageCalls()[0].options).toMatchObject({
				detail: expect.stringContaining("template not found"),
			});
		});

		it("rethrows when the update fails and the user dismisses the prompt", async () => {
			vi.mocked(updateWorkspace).mockRejectedValueOnce(
				new Error("template not found"),
			);
			const { sm, progress } = setup("update");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			await expect(sm.processWorkspace(ws, progress)).rejects.toThrow(
				"template not found",
			);
			expect(startWorkspace).not.toHaveBeenCalled();
		});

		it("falls back to start silently when the user cancels the update", async () => {
			vi.mocked(collectUpdateParameters).mockRejectedValueOnce(
				new WorkspaceUpdateCancelledError(),
			);
			const { sm, progress } = setup("update");
			const ws = createWorkspace({ latest_build: { status: "stopped" } });

			expect(await sm.processWorkspace(ws, progress)).toBe(false);
			expect(updateWorkspace).not.toHaveBeenCalled();
			expect(startWorkspace).toHaveBeenCalledOnce();
			expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
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

	describe("telemetry", () => {
		const stoppedWorkspace = () =>
			createWorkspace({ latest_build: { status: "stopped" } });

		it.each<{
			name: string;
			eventName: "workspace.start.triggered" | "workspace.update.triggered";
			mode: StartupMode;
			workspace: () => Workspace;
			mock: typeof startWorkspace | typeof updateWorkspace;
		}>([
			{
				name: "workspace.start on stopped workspace",
				eventName: "workspace.start.triggered",
				mode: "start",
				workspace: stoppedWorkspace,
				mock: startWorkspace,
			},
			{
				name: "workspace.update on running workspace in update mode",
				eventName: "workspace.update.triggered",
				mode: "update",
				workspace: runningWorkspace,
				mock: updateWorkspace,
			},
		])(
			"emits $name with duration on success",
			async ({ eventName, mode, workspace, mock }) => {
				const sink = new TestSink();
				const { sm, progress } = setup(mode, createTestTelemetryService(sink));

				await sm.processWorkspace(workspace(), progress);

				expect(mock).toHaveBeenCalledOnce();
				const event = sink.expectOne(eventName);
				expect(event.properties.result).toBe("success");
				expect(event.measurements.durationMs).toEqual(expect.any(Number));
			},
		);
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

	describe("after an accepted update", () => {
		it("waits for the server to run the queued start build", async () => {
			const { progress, process } = setupUpdate();

			// Queues the update.
			expect(await process("running", 1)).toBe(false);
			// A stale snapshot must not connect us.
			expect(await process("running", 1)).toBe(false);
			expect(maybeAskAgent).not.toHaveBeenCalled();
			expect(await process("stopping", 2)).toBe(false);
			// The server starts it after the stop.
			expect(await process("stopped", 2)).toBe(false);
			expect(progress.report).toHaveBeenCalledWith({
				message: expect.stringContaining("waiting for the server"),
			});
			expect(await process("starting", 3)).toBe(false);
			// One log stream per build.
			expect(streamBuildLogs).toHaveBeenCalledTimes(2);

			expect(await process("running", 3)).toBe(true);
			expect(startWorkspace).not.toHaveBeenCalled();
			expect(updateWorkspace).toHaveBeenCalledOnce();
		});

		it("throws instead of starting again when a build fails", async () => {
			const { process } = setupUpdate();
			await process("running", 1);

			await expect(process("failed", 2)).rejects.toThrow("Update failed");
			expect(startWorkspace).not.toHaveBeenCalled();
		});
	});
	describe("dynamic parameter templates", () => {
		function setupDynamic() {
			const { sm, progress, container } = setup("update");
			const factory = new WorkspaceUpdatePanelFactory(
				vscode.Uri.file("/ext"),
				createMockLogger(),
			);
			container.getWorkspaceUpdatePanelFactory = () => factory;
			const ws = createWorkspace({
				template_use_classic_parameter_flow: false,
				latest_build: { status: "stopped" },
			});
			return {
				collectParameters: vi.spyOn(factory, "collectParameters"),
				process: () => sm.processWorkspace(ws, progress),
			};
		}

		it("updates with the parameters from the form", async () => {
			const { collectParameters, process } = setupDynamic();
			const parameters = [{ name: "region", value: "eu" }];
			collectParameters.mockResolvedValueOnce(parameters);

			await process();

			expect(collectUpdateParameters).not.toHaveBeenCalled();
			expect(updateWorkspace).toHaveBeenCalledWith(
				expect.anything(),
				parameters,
			);
		});

		it("starts the existing version when the form is closed", async () => {
			const { collectParameters, process } = setupDynamic();
			collectParameters.mockRejectedValueOnce(
				new WorkspaceUpdateCancelledError(),
			);

			await process();

			expect(updateWorkspace).not.toHaveBeenCalled();
			expect(startWorkspace).toHaveBeenCalledOnce();
		});
	});
});
