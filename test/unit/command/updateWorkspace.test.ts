import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { workspace } from "@repo/mocks";

import {
	createTestCommands,
	MockConfigurationProvider,
} from "../../mocks/testHelpers";

import type { CoderApi } from "@/api/coderApi";

describe("Commands.updateWorkspace", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		new MockConfigurationProvider();
	});

	it("shows the latest version's message in the confirmation", async () => {
		const commands = createTestCommands();
		commands.workspace = workspace({ outdated: true });
		const getTemplateVersion = vi
			.fn()
			.mockResolvedValue({ message: "Adds a GPU option." });
		commands.remoteWorkspaceClient = { getTemplateVersion } as Pick<
			CoderApi,
			"getTemplateVersion"
		> as CoderApi;

		await commands.updateWorkspace();

		expect(getTemplateVersion).toHaveBeenCalledWith(
			commands.workspace.template_active_version_id,
		);
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			"Update Workspace",
			expect.objectContaining({
				detail: expect.stringMatching(/\n\nAdds a GPU option\.$/),
			}),
			"Update and Restart",
		);
	});
});
