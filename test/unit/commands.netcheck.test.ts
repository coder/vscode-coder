import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { Commands } from "@/commands";
import { toSafeHost } from "@/util";

import { createTelemetryHarness } from "../mocks/telemetry";
import { createMockLogger, MockUserInteraction } from "../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";
import type { ServiceContainer } from "@/core/container";
import type { DeploymentManager } from "@/deployment/deploymentManager";
import type { NetcheckPanelFactory } from "@/webviews/netcheck/netcheckPanelFactory";

vi.mock("@/workspace/workspacesProvider", () => ({
	AgentTreeItem: class {},
	WorkspaceTreeItem: class {},
}));

function clientWithBaseUrl(baseURL: string | undefined): CoderApi {
	return {
		getAxiosInstance: () => ({ defaults: { baseURL } }),
	} as unknown as CoderApi;
}

function setup(options: { extensionBaseUrl?: string } = {}) {
	vi.clearAllMocks();
	new MockUserInteraction();
	const { sink, service } = createTelemetryHarness();

	const serviceContainer = {
		getTelemetryService: () => service,
		getLogger: () => createMockLogger(),
		getPathResolver: () => ({}),
		getMementoManager: () => ({}),
		getSecretsManager: () => ({}),
		getCliManager: () => ({}),
		getLoginCoordinator: () => ({}),
		getDuplicateWorkspaceIpc: () => ({}),
		getSpeedtestPanelFactory: () => ({}),
		getNetcheckPanelFactory: () => ({}) as NetcheckPanelFactory,
	} as unknown as ServiceContainer;

	const commands = new Commands(
		serviceContainer,
		clientWithBaseUrl(options.extensionBaseUrl),
		{} as DeploymentManager,
	);

	return { commands, sink };
}

/** Capture the progress title and end the run early so the CLI never executes. */
function captureProgressTitle(): () => string | undefined {
	let title: string | undefined;
	vi.mocked(vscode.window.withProgress).mockImplementation((opts) => {
		title = (opts as { title?: string }).title;
		return Promise.resolve({ ok: false, cancelled: true });
	});
	return () => title;
}

describe("Commands.netcheck", () => {
	it("reports not-logged-in and skips the CLI when no client has a base URL", async () => {
		const { commands, sink } = setup({ extensionBaseUrl: undefined });

		await commands.netcheck();

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"You are not logged in",
		);
		expect(vscode.window.withProgress).not.toHaveBeenCalled();
		expect(
			sink.expectOne("command.diagnostic.completed").properties,
		).toMatchObject({ command: "netcheck", "error.type": "error" });
	});

	it("derives the host from the extension client when there is no remote workspace", async () => {
		const { commands } = setup({ extensionBaseUrl: "https://ext.coder.test" });
		const title = captureProgressTitle();

		await commands.netcheck();

		expect(title()).toContain(toSafeHost("https://ext.coder.test"));
	});

	it("prefers the remote workspace client over the extension client", async () => {
		const { commands } = setup({ extensionBaseUrl: "https://ext.coder.test" });
		commands.remoteWorkspaceClient = clientWithBaseUrl(
			"https://remote.coder.test",
		);
		const title = captureProgressTitle();

		await commands.netcheck();

		expect(title()).toContain(toSafeHost("https://remote.coder.test"));
	});
});
