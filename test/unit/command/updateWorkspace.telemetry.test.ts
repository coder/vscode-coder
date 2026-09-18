import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { workspace } from "@repo/mocks";

import { createTelemetryHarness } from "../../mocks/telemetry";
import { createTestCommands } from "../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";

const UPDATE_ACTION = "Update and Restart";

function setup() {
	const { sink, service } = createTelemetryHarness();
	const commands = createTestCommands({
		services: { getTelemetryService: service },
	});
	commands.workspace = workspace({ outdated: true });
	commands.remoteWorkspaceClient = {} as CoderApi;
	return { commands, sink };
}

describe("Commands.updateWorkspace", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	interface ConfirmationCase {
		choice: string | undefined;
		result: string;
		properties: Record<string, string>;
	}

	it.each<ConfirmationCase>([
		{ choice: undefined, result: "aborted", properties: {} },
		{
			choice: UPDATE_ACTION,
			result: "success",
			properties: { action: "update" },
		},
	])(
		"records $result when confirmation returns $choice",
		async ({ choice, result, properties }) => {
			const { commands, sink } = setup();
			vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
				choice as never,
			);

			await commands.updateWorkspace();

			expect(sink.expectOne("workspace.update.prompted")).toMatchObject({
				properties: { prompt: "confirmation", result, ...properties },
			});
			if (choice) {
				expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
					"workbench.action.reloadWindow",
				);
			} else {
				expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
			}
		},
	);
});
