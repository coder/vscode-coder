import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	agent as createAgent,
	resource as createResource,
	workspace as createWorkspace,
} from "@repo/mocks";

import {
	createTestCommands,
	MockConfigurationProvider,
	mockRecentlyOpened,
	openedAuthority,
	useEditor,
} from "../mocks/testHelpers";

import type { WorkspaceAgent } from "coder/site/src/api/typesGenerated";

vi.mock("@/workspace/workspacesProvider", () => ({
	AgentTreeItem: class {
		constructor(
			public agent: unknown,
			public workspace: unknown,
		) {}
	},
	WorkspaceTreeItem: class {},
}));

const AGENT = { name: "main" } as WorkspaceAgent;
const FOLDER = "/home/foo/project";
const BASE_URL = "https://dev.coder.com";
const CURSOR = "ssh-remote+coder-cursor.dev.coder.com--foo--bar.main";
const LEGACY = "ssh-remote+coder-vscode.dev.coder.com--foo--bar.main";
const DEVIN = "ssh-remote+coder-devin.dev.coder.com--foo--bar.main";

/**
 * Open the workspace from the sidebar, with the given authorities standing in
 * for recently opened folders, and report the authority the window was handed.
 */
async function openFromSidebar(
	recents: string[],
	path = FOLDER,
	kind?: "folder" | "workspaceFile",
): Promise<string | undefined> {
	new MockConfigurationProvider();
	mockRecentlyOpened(recents, path, kind);
	const commands = createTestCommands({ baseUrl: BASE_URL });
	const { AgentTreeItem } = await import("@/workspace/workspacesProvider");
	await commands.openFromSidebar(
		new AgentTreeItem(
			AGENT,
			createWorkspace({ owner_name: "foo", name: "bar" }),
		),
	);
	return openedAuthority();
}

/** Open as a link does, without openRecent, from an agent built as given. */
async function openFromLink(
	recents: string[],
	agent: Partial<WorkspaceAgent> = {},
): Promise<string | undefined> {
	new MockConfigurationProvider();
	mockRecentlyOpened(recents, FOLDER);
	const commands = createTestCommands({
		baseUrl: BASE_URL,
		client: {
			getWorkspaceByOwnerAndName: vi.fn().mockResolvedValue(
				createWorkspace({
					owner_name: "foo",
					name: "bar",
					latest_build: {
						resources: [createResource({ agents: [createAgent(agent)] })],
					},
				}),
			),
		},
	});
	await commands.open({
		workspaceOwner: "foo",
		workspaceName: "bar",
		agentName: "main",
		source: "uri",
	});
	return openedAuthority();
}

describe("openWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useEditor("cursor");
	});

	interface RecentCase {
		label: string;
		recents: string[];
		expected: string;
	}
	it.each<RecentCase>([
		{ label: "the legacy host it used", recents: [LEGACY], expected: LEGACY },
		{ label: "its own host", recents: [CURSOR], expected: CURSOR },
		{ label: "its own host with no history", recents: [], expected: CURSOR },
		{
			label: "its own host, ignoring another editor's",
			recents: [DEVIN],
			expected: CURSOR,
		},
		{
			label: "the host it used last, of the two it has used",
			recents: [CURSOR, LEGACY],
			expected: CURSOR,
		},
		{
			label: "the legacy host it used last",
			recents: [LEGACY, CURSOR],
			expected: LEGACY,
		},
	])("reopens the workspace on $label", async ({ recents, expected }) => {
		expect(await openFromSidebar(recents)).toBe(expected);
	});

	it("reopens a multi-root workspace on the host its file used", async () => {
		expect(
			await openFromSidebar(
				[LEGACY],
				"/home/foo/project.code-workspace",
				"workspaceFile",
			),
		).toBe(LEGACY);
	});

	it("reuses the host of a directory the agent supplies", async () => {
		expect(await openFromLink([LEGACY], { expanded_directory: FOLDER })).toBe(
			LEGACY,
		);
	});

	it("does not ask between one folder recorded on both hosts", async () => {
		expect(await openFromLink([CURSOR, LEGACY])).toBe(CURSOR);
		expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
	});
});
