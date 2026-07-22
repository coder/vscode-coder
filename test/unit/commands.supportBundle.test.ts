import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { Commands } from "@/commands";
import * as cliExec from "@/core/cliExec";
import { appendVsCodeLogs } from "@/supportBundle/appendVsCodeLogs";
import { getRemoteEditorLogGlobs } from "@/supportBundle/workspaceFiles";
import { AgentTreeItem } from "@/workspace/workspacesProvider";

import { createTelemetryHarness } from "../mocks/telemetry";
import {
	config,
	createMockLogger,
	MockProgressReporter,
} from "../mocks/testHelpers";

import type {
	Workspace,
	WorkspaceAgent,
} from "coder/site/src/api/typesGenerated";

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

vi.mock("@/supportBundle/workspaceFiles", () => ({
	getRemoteEditorLogGlobs: vi.fn(),
}));

const OUTPUT_PATH = "/tmp/bundle.zip";
const REMOTE_LOG_GLOBS = ["~/.vscode-server/data/logs/**/*.log"];
const workspace = {
	owner_name: "owner",
	name: "ws",
	latest_build: { status: "running" },
} as Workspace;

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
	vi.mocked(getRemoteEditorLogGlobs).mockResolvedValue(REMOTE_LOG_GLOBS);
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
	const agent = { id: "agent-id", name: agentName } as WorkspaceAgent;
	return new AgentTreeItem(agent, workspace);
}

function connectToWorkspace(
	commands: Commands,
	client: CoderApi,
	remoteAuthority: string,
): void {
	commands.workspace = workspace;
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
		// No item authority: remote logs cannot target the workspace.
		expect(getRemoteEditorLogGlobs).toHaveBeenCalledWith(
			expect.objectContaining({ remoteAuthority: undefined }),
		);
	});

	it("derives the agent and remote authority from the active connection", async () => {
		const { commands, client } = setup();
		const remoteAuthority = "ssh-remote+coder-vscode.example--owner--ws.main";
		connectToWorkspace(commands, client, remoteAuthority);

		await commands.supportBundle();

		expect(cliExec.supportBundle).toHaveBeenCalledWith(
			expect.anything(),
			"owner/ws",
			expect.objectContaining({ agentName: "main" }),
		);
		expect(getRemoteEditorLogGlobs).toHaveBeenCalledWith(
			expect.objectContaining({ remoteAuthority }),
		);
	});

	it("degrades the agent to undefined for a malformed Coder authority", async () => {
		const { commands, client } = setup();
		connectToWorkspace(commands, client, "ssh-remote+coder-vscode.malformed");

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

	describe("logging", () => {
		it("warns when the connected agent cannot be resolved", async () => {
			const { commands, client, logger } = setup();
			connectToWorkspace(commands, client, "ssh-remote+coder-vscode.malformed");

			await commands.supportBundle();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Error),
			);
		});
	});
});
