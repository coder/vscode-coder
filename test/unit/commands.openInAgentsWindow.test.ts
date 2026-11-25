import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { prepareAgentsWindowConnection } from "@/remote/agentsWindowConnection";
import { WorkspaceStartCancelledError } from "@/remote/workspaceStateMachine";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import { createTestCommands } from "../mocks/commands";
import { createTelemetryHarness } from "../mocks/telemetry";
import {
	MockConfigurationProvider,
	mockRecentlyOpened,
	useEditor,
} from "../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

vi.mock("@/remote/agentsWindowConnection", () => ({
	prepareAgentsWindowConnection: vi.fn(),
}));
vi.mock("@/workspace/workspacesProvider", () => ({
	AgentTreeItem: class {},
	WorkspaceTreeItem: class {},
}));

const BASE_URL = "https://dev.coder.com";
const AUTHORITY = "ssh-remote+coder-vscode.dev.coder.com--foo--bar.main";
const FOLDER = "/home/foo/project";

function workspaceWith(agent: Partial<WorkspaceAgent> = {}): Workspace {
	return createWorkspace({
		owner_name: "foo",
		name: "bar",
		latest_build: {
			resources: [
				createResource({ agents: [createAgent({ name: "main", ...agent })] }),
			],
		},
	});
}

/** Stand in for the workspace picker, selecting the first workspace it lists. */
function selectFirstWorkspace(): void {
	let onValue: (value: string) => void = () => {};
	let onSelect: (items: readonly vscode.QuickPickItem[]) => void = () => {};
	const quickPick = {
		value: "",
		items: [] as readonly vscode.QuickPickItem[],
		onDidChangeValue: (cb: typeof onValue) => {
			onValue = cb;
			return { dispose: vi.fn() };
		},
		onDidChangeSelection: (cb: typeof onSelect) => {
			onSelect = cb;
			return { dispose: vi.fn() };
		},
		onDidHide: () => ({ dispose: vi.fn() }),
		show: () => onValue(quickPick.value),
		dispose: vi.fn(),
	};
	vi.mocked(vscode.window.createQuickPick).mockReturnValue(
		quickPick as unknown as vscode.QuickPick<vscode.QuickPickItem>,
	);
	void vi
		.waitFor(() => expect(quickPick.items).toHaveLength(1))
		.then(() => onSelect(quickPick.items));
}

/** Run the command with the workspace the connection reports ready, or its error. */
async function openInAgentsWindow(
	ready: Workspace | Error,
	recents: string[] = [],
) {
	new MockConfigurationProvider();
	mockRecentlyOpened(recents, FOLDER);
	selectFirstWorkspace();
	const picked = workspaceWith();
	if (ready instanceof Error) {
		vi.mocked(prepareAgentsWindowConnection).mockRejectedValue(ready);
	} else {
		vi.mocked(prepareAgentsWindowConnection).mockResolvedValue({
			workspace: ready,
			agent: ready.latest_build.resources[0].agents![0],
		});
	}
	const { sink, service } = createTelemetryHarness();
	const commands = createTestCommands({
		baseUrl: BASE_URL,
		services: { getTelemetryService: service },
		client: {
			getWorkspaces: vi
				.fn()
				.mockResolvedValue({ workspaces: [picked], count: 1 }),
		},
	});
	const opened = await commands.openInAgentsWindow();
	const [event] = sink.eventsNamed("workspace.agents_window.open");
	return { opened, event };
}

function agentsWindowCall(): unknown {
	return vi
		.mocked(vscode.commands.executeCommand)
		.mock.calls.find(
			([command]) => command === "workbench.action.openAgentsWindow",
		)?.[1];
}

describe("openInAgentsWindow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useEditor("vscode");
	});

	it("opens the template's directory on the workspace's host", async () => {
		const { opened, event } = await openInAgentsWindow(
			workspaceWith({ expanded_directory: FOLDER }),
		);

		expect(opened).toBe(true);
		expect(prepareAgentsWindowConnection).toHaveBeenCalledWith(
			expect.objectContaining({ remoteAuthority: AUTHORITY }),
		);
		expect(agentsWindowCall()).toEqual({
			folderUri: expect.objectContaining({
				scheme: "vscode-remote",
				authority: AUTHORITY,
				path: FOLDER,
			}),
			reveal: "new",
		});
		expect(event.properties).toMatchObject({
			result: "success",
			handoff: "folder",
		});
	});

	it("falls back to the folder last opened on the workspace", async () => {
		await openInAgentsWindow(workspaceWith(), [AUTHORITY]);

		expect(agentsWindowCall()).toMatchObject({
			folderUri: expect.objectContaining({ path: FOLDER }),
		});
	});

	it("warns and opens without a folder when there is none", async () => {
		const { opened, event } = await openInAgentsWindow(workspaceWith());

		expect(opened).toBe(true);
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("foo/bar sets no directory"),
		);
		expect(agentsWindowCall()).toEqual({
			folderUri: undefined,
			reveal: "new",
		});
		expect(event.properties).toMatchObject({ handoff: "empty_window" });
	});

	it("aborts without an error when the start prompt is dismissed", async () => {
		const { opened, event } = await openInAgentsWindow(
			new WorkspaceStartCancelledError(),
		);

		expect(opened).toBe(false);
		expect(agentsWindowCall()).toBeUndefined();
		expect(event.properties).toMatchObject({
			result: "aborted",
			abort_stage: "start_prompt",
		});
	});
});
