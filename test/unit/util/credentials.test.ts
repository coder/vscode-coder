import * as os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { showStoreCredentialsError } from "@/util/credentials";

import { createMockLogger } from "../../mocks/testHelpers";

vi.mock("node:os");

const configs = {
	get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
};

describe("showStoreCredentialsError", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	interface Case {
		platform: NodeJS.Platform;
		message: string;
	}

	it.each<Case>([
		{
			platform: "darwin",
			message:
				'Failed to store credentials: exit status 36. To store the token in a file instead, set "coder.useKeyring" to false.',
		},
		{
			platform: "linux",
			message: "Failed to store credentials: exit status 36.",
		},
	])("logs and shows the failure on $platform", ({ platform, message }) => {
		vi.mocked(os.platform).mockReturnValue(platform);
		const logger = createMockLogger();

		showStoreCredentialsError(new Error("exit status 36"), configs, logger);

		expect(logger.error).toHaveBeenCalledWith(
			"Failed to store credentials:",
			expect.any(Error),
		);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			message,
			"Open Settings",
		);
	});

	it("opens the coder.useKeyring setting from the toast", async () => {
		vi.mocked(os.platform).mockReturnValue("linux");
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValueOnce(
			"Open Settings" as unknown as vscode.MessageItem,
		);

		showStoreCredentialsError(new Error("x"), configs, createMockLogger());
		await Promise.resolve();

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"workbench.action.openSettings",
			"coder.useKeyring",
		);
	});
});
