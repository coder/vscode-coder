import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { Commands } from "@/commands";
import { MementoManager } from "@/core/mementoManager";

import { workspace } from "@repo/mocks";

import { createTelemetryHarness } from "../../mocks/telemetry";
import { createMockLogger, InMemoryMemento } from "../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";
import type { ServiceContainer } from "@/core/container";
import type { DeploymentManager } from "@/deployment/deploymentManager";

const UPDATE_ACTION = "Update and Restart";

function setup() {
	const { sink, service } = createTelemetryHarness();
	const mementoManager = new MementoManager(new InMemoryMemento());
	const logger = createMockLogger();
	const showUpdate = vi.fn().mockResolvedValue(false);
	const container = {
		getTelemetryService: () => service,
		getLogger: () => logger,
		getPathResolver: () => ({}),
		getMementoManager: () => mementoManager,
		getSecretsManager: () => ({}),
		getCliManager: () => ({}),
		getLoginCoordinator: () => ({}),
		getDuplicateWorkspaceIpc: () => ({}),
		getSpeedtestPanelFactory: () => ({}),
		getWorkspaceUpdatePanelFactory: () => ({ show: showUpdate }),
		getNetcheckPanelFactory: () => ({}),
		getConnectionLogBuffer: () => ({ flush: () => {} }),
	} as unknown as ServiceContainer;
	const commands = new Commands(
		container,
		{} as CoderApi,
		{} as DeploymentManager,
	);
	commands.workspace = workspace({
		outdated: true,
		template_use_classic_parameter_flow: true,
	});
	commands.remoteWorkspaceClient = {} as CoderApi;
	return { commands, sink, showUpdate };
}

describe("Commands.updateWorkspace", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("records an aborted update confirmation when the prompt is dismissed", async () => {
		const { commands, sink } = setup();
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

		await commands.updateWorkspace();

		expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
			properties: {
				prompt: "confirmation",
				result: "aborted",
			},
		});
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});

	it("records success and reloads when the update confirmation is accepted", async () => {
		const { commands, sink } = setup();
		vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
			UPDATE_ACTION as never,
		);

		await commands.updateWorkspace();

		expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
			properties: {
				action: "update",
				prompt: "confirmation",
				result: "success",
			},
		});
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"workbench.action.reloadWindow",
		);
	});
});

describe("dynamic workspace updates", () => {
	beforeEach(() => vi.resetAllMocks());
	it("opens the parameter editor without reloading or the classic confirmation", async () => {
		const { commands, showUpdate } = setup();
		commands.workspace = workspace({
			outdated: true,
			template_use_classic_parameter_flow: false,
		});
		await commands.updateWorkspace();
		expect(showUpdate).toHaveBeenCalledWith(
			commands.remoteWorkspaceClient,
			commands.workspace,
		);
		expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
	});
	it("reloads only after a successful dynamic update", async () => {
		const { commands, showUpdate } = setup();
		commands.workspace = workspace({
			outdated: true,
			template_use_classic_parameter_flow: false,
		});
		showUpdate.mockResolvedValue(true);
		await commands.updateWorkspace();
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"workbench.action.reloadWindow",
		);
	});
});
