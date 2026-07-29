import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { Commands } from "@/commands";
import * as cliExec from "@/core/cliExec";
import { appendVsCodeLogs } from "@/supportBundle/appendVsCodeLogs";
import { getRemoteServerDataPath } from "@/supportBundle/remoteServerDataPath";
import {
	AgentTreeItem,
	WorkspaceTreeItem,
} from "@/workspace/workspacesProvider";

import { agent, resource, workspace } from "@repo/mocks";

import { createTelemetryHarness } from "../mocks/telemetry";
import {
	config,
	createMockLogger,
	MockProgressReporter,
} from "../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";
import type { ServiceContainer } from "@/core/container";
import type { DeploymentManager } from "@/deployment/deploymentManager";

vi.mock("@/core/cliExec", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/core/cliExec")>();
	return { ...actual, version: vi.fn(), supportBundle: vi.fn() };
});

vi.mock("@/supportBundle/appendVsCodeLogs", () => ({
	appendVsCodeLogs: vi.fn(),
}));

vi.mock("@/supportBundle/remoteServerDataPath", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@/supportBundle/remoteServerDataPath")
		>();
	return { ...actual, getRemoteServerDataPath: vi.fn() };
});

const OUTPUT_PATH = "/tmp/bundle.zip";
// Derived from the mocked data path by the real toRemoteLogGlobs.
const REMOTE_LOG_GLOBS = [
	"~/.vscode-server/data/logs/**/*.log",
	"~/.vscode-server/.*.log",
	"~/.vscode-server/cli/servers/*/log.txt",
];
const TEST_WORKSPACE = workspace({
	owner_name: "owner",
	name: "ws",
	latest_build: {
		status: "running",
		resources: [resource({ agents: [agent({ name: "main" })] })],
	},
});

function setup(options: { cliVersion?: string } = {}) {
	vi.clearAllMocks();
	new MockProgressReporter();
	config({});
	setRemoteAuthority(undefined);
	const { service } = createTelemetryHarness();

	vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(
		vscode.Uri.file(OUTPUT_PATH),
	);
	vi.mocked(cliExec.version).mockResolvedValue(options.cliVersion ?? "v2.36.0");
	vi.mocked(cliExec.supportBundle).mockResolvedValue(undefined);
	vi.mocked(getRemoteServerDataPath).mockResolvedValue({
		value: "~/.vscode-server",
		style: "posix",
	});
	vi.mocked(appendVsCodeLogs).mockResolvedValue(undefined);

	const logger = createMockLogger();
	const serviceContainer = {
		getTelemetryService: () => service,
		getLogger: () => logger,
		getPathResolver: () => ({
			getGlobalConfigDir: () => "/cfg",
			getProxyLogPath: () => "/logs/proxy",
			getCodeLogDir: () => "/logs/code",
			getTelemetryPath: () => "/logs/telemetry",
		}),
		getMementoManager: () => ({}),
		getSecretsManager: () => ({}),
		getCliManager: () => ({
			locateBinary: vi.fn(() => Promise.resolve("/bin/coder")),
			configure: vi.fn(() => Promise.resolve()),
		}),
		getLoginCoordinator: () => ({}),
		getDuplicateWorkspaceIpc: () => ({}),
		getSpeedtestPanelFactory: () => ({}),
		getNetcheckPanelFactory: () => ({}),
	} as unknown as ServiceContainer;

	const client = {
		getAxiosInstance: () => ({ defaults: { baseURL: "https://coder.test" } }),
		getSessionToken: () => "token",
	} as unknown as CoderApi;

	const commands = new Commands(
		serviceContainer,
		client,
		{} as DeploymentManager,
	);

	return { commands, client, logger };
}

function setRemoteAuthority(value: string | undefined): void {
	(vscode.env as { remoteAuthority?: string }).remoteAuthority = value;
}

function agentItem(agentName: string): AgentTreeItem {
	return new AgentTreeItem(agent({ name: agentName }), TEST_WORKSPACE);
}

function connectToWorkspace(
	commands: Commands,
	client: CoderApi,
	remoteAuthority: string,
	agentName?: string,
): void {
	commands.workspace = TEST_WORKSPACE;
	commands.agent = agentName ? agent({ name: agentName }) : undefined;
	commands.remoteWorkspaceClient = client;
	setRemoteAuthority(remoteAuthority);
}

describe("Commands.supportBundle", () => {
	it("collects the selected agent's bundle with remote log globs", async () => {
		const { commands } = setup();

		await commands.supportBundle(agentItem("dev"));

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({
				outputPath: OUTPUT_PATH,
				agentName: "dev",
				workspaceFiles: REMOTE_LOG_GLOBS,
			}),
		);
		// The authority is reconstructed from the item's workspace and agent.
		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({
				remoteAuthority: "ssh-remote+coder-vscode.coder.test--owner--ws.dev",
			}),
		);
	});

	it("prefers the selected item over the active connection", async () => {
		const { commands, client } = setup();
		connectToWorkspace(
			commands,
			client,
			"ssh-remote+coder-vscode.example--owner--ws.main",
			"main",
		);

		await commands.supportBundle(agentItem("dev"));

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({ agentName: "dev" }),
		);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({
				remoteAuthority: "ssh-remote+coder-vscode.coder.test--owner--ws.dev",
			}),
		);
	});

	it("reconstructs the authority with the first agent for workspace items", async () => {
		const { commands } = setup();

		await commands.supportBundle(new WorkspaceTreeItem(TEST_WORKSPACE, false));

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({ agentName: undefined }),
		);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({
				remoteAuthority: "ssh-remote+coder-vscode.coder.test--owner--ws.main",
			}),
		);
	});

	it("derives the agent and remote authority from the active connection", async () => {
		const { commands, client } = setup();
		const remoteAuthority = "ssh-remote+coder-vscode.example--owner--ws.main";
		connectToWorkspace(commands, client, remoteAuthority, "main");

		await commands.supportBundle();

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({ agentName: "main" }),
		);
		expect(getRemoteServerDataPath).toHaveBeenCalledWith(
			expect.objectContaining({ remoteAuthority }),
		);
	});

	it("omits the agent when the connection has not resolved one", async () => {
		const { commands, client } = setup();
		connectToWorkspace(commands, client, "ssh-remote+coder-vscode.example");

		await commands.supportBundle();

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({ agentName: undefined }),
		);
	});

	it("skips remote log collection when the CLI lacks workspace file support", async () => {
		const { commands } = setup({ cliVersion: "v2.35.0" });

		await commands.supportBundle(agentItem("dev"));

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({ workspaceFiles: [] }),
		);
	});
});
