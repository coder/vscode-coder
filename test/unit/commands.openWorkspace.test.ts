import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { Commands } from "@/commands";

import { workspace as createWorkspace } from "@repo/mocks";

import { createTestTelemetryService } from "../mocks/telemetry";
import {
	createMockLogger,
	MockConfigurationProvider,
	useEditor,
} from "../mocks/testHelpers";

import type { WorkspaceAgent } from "coder/site/src/api/typesGenerated";

import type { CoderApi } from "@/api/coderApi";
import type { ServiceContainer } from "@/core/container";
import type { DeploymentManager } from "@/deployment/deploymentManager";

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
const CURSOR = "ssh-remote+coder-cursor.dev.coder.com--foo--bar.main";
const LEGACY = "ssh-remote+coder-vscode.dev.coder.com--foo--bar.main";
const DEVIN = "ssh-remote+coder-devin.dev.coder.com--foo--bar.main";

/**
 * Open the workspace from the sidebar, with the given authorities standing in
 * for recently opened folders, and report the authority the window was handed.
 */
async function openFromSidebar(recents: string[]): Promise<string | undefined> {
	new MockConfigurationProvider();
	const workspaces = recents.map((authority) => ({
		folderUri: vscode.Uri.from({
			scheme: "vscode-remote",
			authority,
			path: FOLDER,
		}),
	}));
	const executeCommand = vi
		.mocked(vscode.commands.executeCommand)
		.mockImplementation((command: string) =>
			Promise.resolve(
				command === "_workbench.getRecentlyOpened" ? { workspaces } : undefined,
			),
		);

	// The constructor reads every service, so name only the ones in play.
	const services: Record<string, unknown> = {
		getTelemetryService: createTestTelemetryService(),
		getLogger: createMockLogger(),
		getMementoManager: { setStartupMode: vi.fn() },
		getDuplicateWorkspaceIpc: {
			sendPing: vi.fn().mockResolvedValue(undefined),
		},
	};
	const commands = new Commands(
		new Proxy({} as ServiceContainer, {
			get: (_, name: string) => () => services[name] ?? {},
		}),
		{
			getAxiosInstance: () => ({
				defaults: { baseURL: "https://dev.coder.com" },
			}),
		} as unknown as CoderApi,
		{} as DeploymentManager,
	);
	const { AgentTreeItem } = await import("@/workspace/workspacesProvider");
	await commands.openFromSidebar(
		new AgentTreeItem(
			AGENT,
			createWorkspace({ owner_name: "foo", name: "bar" }),
		),
	);

	// A folder is handed off by URI, an empty window by option.
	const [, handoff] =
		executeCommand.mock.calls.find(([command]) =>
			["vscode.openFolder", "vscode.newWindow"].includes(command),
		) ?? [];
	return handoff instanceof vscode.Uri
		? handoff.authority
		: (handoff as { remoteAuthority?: string } | undefined)?.remoteAuthority;
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
	])("reopens the workspace on $label", async ({ recents, expected }) => {
		expect(await openFromSidebar(recents)).toBe(expected);
	});
});
