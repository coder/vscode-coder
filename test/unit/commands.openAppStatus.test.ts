import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { createTestCommands } from "../mocks/commands";
import { MockConfigurationProvider } from "../mocks/testHelpers";

describe("openAppStatus", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		new MockConfigurationProvider();
	});

	it("shows links in the status message as text", async () => {
		await createTestCommands().openAppStatus({
			name: "Done. [Continue](command:example.command)",
			agent_name: "main",
			workspace_name: "dev",
		});

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
			"Done. [Continue] (command:example.command)",
			{ detail: "Agent: main" },
		);
	});
});
