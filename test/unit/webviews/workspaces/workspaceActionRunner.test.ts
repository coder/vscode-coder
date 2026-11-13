import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	collectUpdateParameters,
	WorkspaceUpdateCancelledError,
} from "@/api/updateParameters";
import {
	postBuild,
	restartWorkspace,
	runBuild,
	startWorkspaceViaApi,
	updateWorkspaceViaApi,
} from "@/api/workspace";
import { WorkspaceActionRunner } from "@/webviews/workspaces/workspaceActionRunner";

import { workspace } from "@repo/mocks";

import { createTestCoderApi } from "../../../mocks/coderApi";
import { createTelemetryHarness } from "../../../mocks/telemetry";
import { createMockLogger, TestSessionStore } from "../../../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { WorkspaceAction } from "@repo/shared";

vi.mock("@/api/workspace", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/api/workspace")>()),
	restartWorkspace: vi.fn(),
	runBuild: vi.fn(),
	startWorkspaceViaApi: vi.fn(),
	updateWorkspaceViaApi: vi.fn(),
}));

vi.mock("@/api/updateParameters", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/api/updateParameters")>()),
	collectUpdateParameters: vi.fn(),
}));

const NAME = "testuser/test-workspace";
const ACTIONS = ["start", "stop", "restart", "delete", "update"] as const;
/** A workspace each action applies to, and the button that confirms it. */
const ALLOWS: Record<WorkspaceAction, [WorkspaceStatus, string?]> = {
	start: ["stopped"],
	stop: ["running"],
	restart: ["running"],
	delete: ["stopped", "Delete"],
	update: ["stopped", "Update and Start"],
};

const withStatus = (status: WorkspaceStatus, outdated = false) =>
	workspace({ outdated, latest_build: { status } });

/** A runner whose deployment re-reads the workspace as `latest`. */
function setup(latest: Workspace, warningChoice?: string) {
	vi.clearAllMocks();
	vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
		warningChoice as never,
	);
	vi.mocked(collectUpdateParameters).mockResolvedValue([
		{ name: "region", value: "eu" },
	]);
	const { sink, service } = createTelemetryHarness();
	const client = {
		getWorkspace: vi.fn(() => Promise.resolve(latest)),
		getBuildInfo: vi.fn(() => Promise.resolve({ version: "v2.36.0" } as never)),
		postWorkspaceBuild: vi.fn(() => Promise.resolve(latest.latest_build)),
	};
	const session = new TestSessionStore();
	const connected = {
		workspace: undefined as Workspace | undefined,
		updateWorkspace: vi.fn(() => Promise.resolve()),
	};
	const runner = new WorkspaceActionRunner(
		createTestCoderApi({ overrides: client }),
		session,
		connected,
		service,
		createMockLogger(),
	);
	const triggered = (action: string) =>
		sink.eventsNamed(`workspace.${action}.triggered`);
	/** How many writes each path made. */
	const writes = () => ({
		post: client.postWorkspaceBuild.mock.calls.length,
		build: vi.mocked(runBuild).mock.calls.length,
		start: vi.mocked(startWorkspaceViaApi).mock.calls.length,
		restart: vi.mocked(restartWorkspace).mock.calls.length,
		update: vi.mocked(updateWorkspaceViaApi).mock.calls.length,
	});
	return { runner, client, connected, session, triggered, writes };
}

const NO_WRITES = { post: 0, build: 0, start: 0, restart: 0, update: 0 };

/** Set up the workspace `action` applies to, already confirmed. */
function setupFor(action: WorkspaceAction) {
	const [status, confirm] = ALLOWS[action];
	const latest = withStatus(status, action === "update");
	return { ...setup(latest, confirm), latest };
}

describe("WorkspaceActionRunner", () => {
	it.each(ACTIONS)(
		"runs %s over the API and waits for its build",
		async (action) => {
			const h = setupFor(action);
			const { latest } = h;

			await h.runner.run(latest, action);

			const queued = action === "stop" || action === "delete";
			expect(h.writes()).toEqual({
				...NO_WRITES,
				...(queued ? { build: 1 } : { [action]: 1 }),
			});
			if (queued) {
				expect(runBuild).toHaveBeenCalledWith(
					expect.objectContaining({ signal: expect.any(AbortSignal) }),
					latest.id,
					{ transition: action },
				);
			}
			if (action === "update") {
				expect(updateWorkspaceViaApi).toHaveBeenCalledWith(
					expect.objectContaining({ signal: expect.any(AbortSignal) }),
					latest,
					expect.objectContaining({ onSuccessBuild: true }),
					[{ name: "region", value: "eu" }],
				);
			}
			if (action === "start" || action === "restart") {
				expect(
					vi.mocked(
						action === "start" ? startWorkspaceViaApi : restartWorkspace,
					).mock.calls[0][1],
				).toBe(latest);
			}
			expect(h.triggered(action)).toHaveLength(1);
		},
	);

	it("stops writing once the session changes mid-action", async () => {
		const h = setupFor("start");
		vi.mocked(startWorkspaceViaApi).mockImplementationOnce((ctx) => {
			h.session.signInAs("replacement-user");
			return postBuild(
				ctx.client,
				h.latest.id,
				{ transition: "start" },
				ctx.signal,
			);
		});

		await h.runner.run(h.latest, "start");

		expect(h.client.postWorkspaceBuild).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			expect.stringContaining("The Coder session changed"),
		);
	});

	it("names the action and workspace when a build fails", async () => {
		const h = setupFor("stop");
		vi.mocked(runBuild).mockRejectedValueOnce(new Error("Build 3 failed"));

		await expect(h.runner.run(h.latest, "stop")).rejects.toThrow(
			`Failed to stop ${NAME}: Build 3 failed. The Coder output has its build logs.`,
		);
	});

	it("updates the connected workspace through a reload", async () => {
		const listed = withStatus("running", true);
		const { runner, client, connected } = setup(listed);
		connected.workspace = listed;

		await runner.run(listed, "update");

		expect(connected.updateWorkspace).toHaveBeenCalledOnce();
		expect(client.getWorkspace).not.toHaveBeenCalled();
	});

	it.each([
		["starting becomes restarting during confirmation", false],
		["a parameter prompt is dismissed", true],
	])("does not update when %s", async (_, dismissed) => {
		const { runner } = setup(
			withStatus(dismissed ? "stopped" : "running", true),
			"Update and Start",
		);
		if (dismissed) {
			vi.mocked(collectUpdateParameters).mockRejectedValue(
				new WorkspaceUpdateCancelledError(),
			);
		}

		await runner.run(withStatus("stopped", true), "update");

		expect(updateWorkspaceViaApi).not.toHaveBeenCalled();
		if (!dismissed) {
			expect(collectUpdateParameters).not.toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				`${NAME} changed while preparing its update. Run Update again to confirm the current operation.`,
			);
		}
	});

	it.each(ACTIONS)(
		"does not %s under a session that replaced its workspace read",
		async (action) => {
			const h = setupFor(action);
			const read = Promise.withResolvers<Workspace>();
			const requested = Promise.withResolvers<void>();
			h.client.getWorkspace.mockImplementationOnce(() => {
				requested.resolve();
				return read.promise;
			});

			const running = h.runner.run(h.latest, action);
			await requested.promise;
			h.session.signInAs("replacement-user");
			read.resolve(h.latest);
			await running;

			expect(h.writes()).toEqual(NO_WRITES);
		},
	);

	it("does not re-read a delete confirmed after a session change", async () => {
		const latest = withStatus("stopped");
		const { runner, client, session, writes } = setup(latest);
		const confirmation = Promise.withResolvers<string>();
		vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(
			confirmation.promise as never,
		);

		const deleting = runner.run(latest, "delete");
		session.signOut();
		confirmation.resolve("Delete");
		await deleting;

		expect(client.getWorkspace).not.toHaveBeenCalled();
		expect(writes()).toEqual(NO_WRITES);
	});

	it.each<[WorkspaceAction, Workspace, string]>([
		[
			"start",
			withStatus("starting"),
			`Cannot start ${NAME} while it is starting.`,
		],
		[
			"stop",
			withStatus("stopping"),
			`Cannot stop ${NAME} while it is stopping.`,
		],
		[
			"restart",
			workspace({ outdated: true, template_require_active_version: true }),
			`Cannot restart ${NAME} while it is running.`,
		],
		[
			"delete",
			withStatus("deleting"),
			`Cannot delete ${NAME} while it is deleting.`,
		],
		["update", withStatus("stopped"), `${NAME} is already up to date.`],
	])(
		"refuses to %s when the workspace changed since it was listed",
		async (action, latest, message) => {
			const { runner, triggered, writes } = setup(latest, ALLOWS[action][1]);

			await runner.run(withStatus("stopped", true), action);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				message,
			);
			expect(triggered(action)).toEqual([]);
			expect(writes()).toEqual(NO_WRITES);
		},
	);

	it.each<[WorkspaceAction, string, string, boolean]>([
		["stop", `Stop ${NAME}?`, "Stop", true],
		["restart", `Restart ${NAME}?`, "Restart", true],
		["delete", `Delete ${NAME}?`, "Delete", false],
		["update", "Update Workspace", "Update and Restart", false],
	])(
		"asks before it will %s and stops when dismissed",
		async (action, title, button, connected) => {
			const listed = withStatus("running", action === "update");
			const h = setup(listed);
			if (connected) {
				h.connected.workspace = listed;
			}

			await h.runner.run(listed, action);

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				title,
				expect.objectContaining({ modal: true }),
				button,
			);
			expect(h.client.getWorkspace).not.toHaveBeenCalled();
			expect(h.triggered(action)).toEqual([]);
		},
	);
});
