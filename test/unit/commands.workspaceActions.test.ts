import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	collectUpdateParameters,
	WorkspaceUpdateCancelledError,
} from "@/api/updateParameters";
import {
	restartWorkspace,
	startWorkspace,
	updateWorkspace,
} from "@/api/workspace";
import * as cliExec from "@/cli/cliExec";

import { workspace } from "@repo/mocks";

import { createTestCommands } from "../mocks/commands";
import { createTelemetryHarness } from "../mocks/telemetry";
import {
	MockConfigurationProvider,
	MockProgressReporter,
	TestSessionStore,
} from "../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceStatus,
} from "coder/site/src/api/typesGenerated";

import type { Commands } from "@/commands";

vi.mock("@/api/workspace", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/api/workspace")>()),
	startWorkspace: vi.fn(),
	restartWorkspace: vi.fn(),
	updateWorkspace: vi.fn(),
}));

vi.mock("@/api/updateParameters", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/api/updateParameters")>()),
	collectUpdateParameters: vi.fn(),
}));

vi.mock("@/cli/cliExec", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/cli/cliExec")>()),
	version: vi.fn(),
}));

const NAME = "testuser/test-workspace";

const withStatus = (status: WorkspaceStatus, outdated = false) =>
	workspace({ outdated, latest_build: { status } });

/** Commands whose deployment re-reads the workspace as `latest`. */
function setup(latest: Workspace, warningChoice?: string) {
	vi.clearAllMocks();
	new MockConfigurationProvider();
	new MockProgressReporter();
	vi.mocked(cliExec.version).mockResolvedValue("v2.36.0");
	vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
		warningChoice as never,
	);
	const { sink, service } = createTelemetryHarness();
	const client = {
		getWorkspace: vi.fn(() => Promise.resolve(latest)),
		getBuildInfo: vi.fn(() => Promise.resolve({ version: "v2.36.0" } as never)),
		stopWorkspace: vi.fn(() => Promise.resolve(latest.latest_build)),
		deleteWorkspace: vi.fn(() => Promise.resolve(latest.latest_build)),
	};
	const session = new TestSessionStore();
	const cliManager = {
		locateBinary: vi.fn(() =>
			Promise.resolve<string | undefined>("/bin/coder"),
		),
		fetchBinary: vi.fn(() => Promise.resolve("/bin/coder")),
		configure: vi.fn(() => Promise.resolve()),
	};
	const commands = createTestCommands({
		session,
		baseUrl: "https://coder.test",
		client,
		services: {
			getTelemetryService: service,
			getCliManager: cliManager,
			getPathResolver: { getGlobalConfigDir: () => "/cfg" },
		},
	});
	const triggered = (action: string) =>
		sink.eventsNamed(`workspace.${action}.triggered`);
	return { commands, client, triggered, session, cliManager };
}

describe("workspace lifecycle commands", () => {
	it("starts with coder start on the workspace as it is now", async () => {
		const latest = withStatus("stopped");
		const { commands, triggered } = setup(latest);

		await commands.startWorkspace(withStatus("running"));

		expect(startWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({ workspace: latest, binPath: "/bin/coder" }),
		);
		expect(triggered("start")).toHaveLength(1);
	});

	it("stops with the API", async () => {
		const latest = withStatus("running");
		const { commands, client } = setup(latest);

		await commands.stopWorkspace(latest);

		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(client.stopWorkspace).toHaveBeenCalledWith(latest.id);
	});

	it("restarts without depending on deployment feature detection", async () => {
		const latest = withStatus("running");
		const { commands, client } = setup(latest);

		await commands.restartWorkspace(latest);

		expect(restartWorkspace).toHaveBeenCalledWith(
			expect.anything(),
			latest,
			expect.any(Function),
		);
		expect(client.getBuildInfo).not.toHaveBeenCalled();
	});

	it("deletes once confirmed", async () => {
		const latest = withStatus("stopped");
		const { commands, client } = setup(latest, "Delete");

		await commands.deleteWorkspace(latest);

		expect(client.deleteWorkspace).toHaveBeenCalledWith(latest.id);
	});

	it("updates a listed workspace in place, without a CLI from 2.36", async () => {
		const latest = withStatus("stopped", true);
		const parameters = [{ name: "region", value: "eu" }];
		vi.mocked(collectUpdateParameters).mockResolvedValue(parameters);
		const { commands, cliManager } = setup(latest, "Update and Start");
		cliManager.locateBinary.mockRejectedValue(new Error("CLI unavailable"));

		await commands.updateWorkspace(latest);

		expect(updateWorkspace).toHaveBeenCalledWith(
			expect.objectContaining({ workspace: latest }),
			parameters,
		);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
			"workbench.action.reloadWindow",
		);
		expect(cliManager.locateBinary).not.toHaveBeenCalled();
		expect(cliManager.configure).not.toHaveBeenCalled();
	});

	it("aborts an update when starting becomes restarting during confirmation", async () => {
		const latest = { ...withStatus("running", true), name: "renamed" };
		const { commands } = setup(latest, "Update and Start");

		await commands.updateWorkspace(withStatus("stopped", true));

		expect(collectUpdateParameters).not.toHaveBeenCalled();
		expect(updateWorkspace).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			`${NAME} changed while preparing its update. Run Update again to confirm the current operation.`,
		);
	});

	it("aborts an update when its effect changes during parameter prompts", async () => {
		const latest = withStatus("stopped", true);
		const { commands, client } = setup(latest, "Update and Start");
		vi.mocked(collectUpdateParameters).mockImplementationOnce(() => {
			client.getWorkspace.mockResolvedValue({
				...withStatus("running", true),
				name: "renamed",
			});
			return Promise.resolve([]);
		});

		await commands.updateWorkspace(latest);

		expect(updateWorkspace).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			`${NAME} changed while preparing its update. Run Update again to confirm the current operation.`,
		);
	});

	it.each([
		{ action: "start", status: "stopped", confirm: undefined },
		{ action: "stop", status: "running", confirm: undefined },
		{ action: "restart", status: "running", confirm: undefined },
		{ action: "delete", status: "stopped", confirm: "Delete" },
		{ action: "update", status: "stopped", confirm: "Update and Start" },
	] as const)(
		"does not $action under a session that replaced its workspace read",
		async ({ action, status, confirm }) => {
			const latest = withStatus(status, true);
			const { commands, client, session, cliManager } = setup(latest, confirm);
			const read = Promise.withResolvers<Workspace>();
			const requested = Promise.withResolvers<void>();
			client.getWorkspace.mockImplementationOnce(() => {
				requested.resolve();
				return read.promise;
			});
			const methods = {
				start: () => commands.startWorkspace(latest),
				stop: () => commands.stopWorkspace(latest),
				restart: () => commands.restartWorkspace(latest),
				delete: () => commands.deleteWorkspace(latest),
				update: () => commands.updateWorkspace(latest),
			};

			const running = methods[action]();
			await requested.promise;
			session.signInAs("replacement-user");
			read.resolve(latest);
			await running;

			expect(client.stopWorkspace).not.toHaveBeenCalled();
			expect(client.deleteWorkspace).not.toHaveBeenCalled();
			expect(startWorkspace).not.toHaveBeenCalled();
			expect(restartWorkspace).not.toHaveBeenCalled();
			expect(updateWorkspace).not.toHaveBeenCalled();
			expect(cliManager.configure).not.toHaveBeenCalled();
		},
	);

	it("does not revalidate a delete confirmed after a session change", async () => {
		const latest = withStatus("stopped");
		const { commands, client, session } = setup(latest);
		const confirmation = Promise.withResolvers<string>();
		vi.mocked(vscode.window.showWarningMessage).mockReturnValueOnce(
			confirmation.promise as never,
		);

		const deleting = commands.deleteWorkspace(latest);
		session.signOut();
		confirmation.resolve("Delete");
		await deleting;

		expect(client.getWorkspace).not.toHaveBeenCalled();
		expect(client.deleteWorkspace).not.toHaveBeenCalled();
	});

	it.each(["locating it", "downloading it", "checking its version"] as const)(
		"does not continue CLI preparation after its session changed while %s",
		async (stage) => {
			const latest = withStatus("stopped");
			const { commands, session, cliManager } = setup(latest);
			const gate = Promise.withResolvers<void>();
			const reached = Promise.withResolvers<void>();
			const pause = async <T>(value: T) => {
				reached.resolve();
				await gate.promise;
				return value;
			};
			if (stage === "locating it") {
				cliManager.locateBinary.mockImplementationOnce(() =>
					pause<string | undefined>(undefined),
				);
			} else if (stage === "downloading it") {
				cliManager.locateBinary.mockResolvedValueOnce(undefined);
				cliManager.fetchBinary.mockImplementationOnce(() =>
					pause("/bin/coder"),
				);
			} else {
				vi.mocked(cliExec.version).mockImplementationOnce(() =>
					pause("v2.36.0"),
				);
			}

			const starting = commands.startWorkspace(latest);
			await reached.promise;
			session.signInAs("replacement-user");
			gate.resolve();
			await starting;

			if (stage === "downloading it") {
				expect(cliExec.version).not.toHaveBeenCalled();
			} else {
				expect(cliManager.fetchBinary).not.toHaveBeenCalled();
			}
			expect(cliManager.configure).not.toHaveBeenCalled();
			expect(startWorkspace).not.toHaveBeenCalled();
		},
	);

	it("does not update when a parameter prompt is dismissed", async () => {
		vi.mocked(collectUpdateParameters).mockRejectedValue(
			new WorkspaceUpdateCancelledError(),
		);
		const { commands } = setup(withStatus("stopped", true), "Update and Start");

		await commands.updateWorkspace(withStatus("stopped", true));

		expect(updateWorkspace).not.toHaveBeenCalled();
	});

	interface RefusalCase {
		action: string;
		latest: Workspace;
		confirm?: string;
		run: (commands: Commands, workspace: Workspace) => Promise<void>;
		message: string;
	}

	it.each<RefusalCase>([
		{
			action: "start",
			latest: withStatus("starting"),
			run: (c, w) => c.startWorkspace(w),
			message: `Cannot start ${NAME} while it is starting.`,
		},
		{
			action: "stop",
			latest: withStatus("stopping"),
			run: (c, w) => c.stopWorkspace(w),
			message: `Cannot stop ${NAME} while it is stopping.`,
		},
		{
			action: "restart",
			latest: workspace({
				outdated: true,
				template_require_active_version: true,
			}),
			run: (c, w) => c.restartWorkspace(w),
			message: `Cannot restart ${NAME} while it is running.`,
		},
		{
			action: "delete",
			latest: withStatus("deleting"),
			confirm: "Delete",
			run: (c, w) => c.deleteWorkspace(w),
			message: `Cannot delete ${NAME} while it is deleting.`,
		},
		{
			action: "update",
			latest: withStatus("stopped"),
			confirm: "Update and Start",
			run: (c, w) => c.updateWorkspace(w),
			message: `${NAME} is already up to date.`,
		},
	])(
		"refuses to $action when the workspace changed since it was listed",
		async ({ action, latest, confirm, run, message }) => {
			const { commands, triggered } = setup(latest, confirm);

			await run(commands, withStatus("stopped", true));

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				message,
			);
			expect(triggered(action)).toEqual([]);
		},
	);

	interface ConfirmationCase {
		action: string;
		listed: Workspace;
		connected?: boolean;
		run: (commands: Commands, workspace: Workspace) => Promise<void>;
		title: string;
		button: string;
	}

	it.each<ConfirmationCase>([
		{
			action: "stop",
			listed: withStatus("running"),
			connected: true,
			run: (c, w) => c.stopWorkspace(w),
			title: `Stop ${NAME}?`,
			button: "Stop",
		},
		{
			action: "restart",
			listed: withStatus("running"),
			connected: true,
			run: (c, w) => c.restartWorkspace(w),
			title: `Restart ${NAME}?`,
			button: "Restart",
		},
		{
			action: "delete",
			listed: withStatus("stopped"),
			run: (c, w) => c.deleteWorkspace(w),
			title: `Delete ${NAME}?`,
			button: "Delete",
		},
		{
			action: "update",
			listed: withStatus("running", true),
			run: (c, w) => c.updateWorkspace(w),
			title: "Update Workspace",
			button: "Update and Restart",
		},
	])(
		"asks before it will $action and stops when dismissed",
		async ({ action, listed, connected, run, title, button }) => {
			const { commands, client, triggered } = setup(listed);
			if (connected) {
				commands.workspace = listed;
			}

			await run(commands, listed);

			expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
				title,
				expect.objectContaining({ modal: true }),
				button,
			);
			expect(client.getWorkspace).not.toHaveBeenCalled();
			expect(triggered(action)).toEqual([]);
		},
	);
});

it("opens the dashboard's sharing page", async () => {
	const latest = withStatus("running");
	const { commands } = setup(latest);

	await commands.openWorkspaceInDashboard(latest, "sharing");

	expect(vscode.env.openExternal).toHaveBeenCalledWith(
		vscode.Uri.parse(`https://coder.test/@${NAME}/settings/sharing`),
	);
});
