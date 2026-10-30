import * as os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	notifyKeyringSkipped,
	showStoreCredentialsError,
} from "@/login/credentials";

import { createMockLogger } from "../../mocks/testHelpers";

import type { CliAuth } from "@/settings/cli";

vi.mock("node:os");

const configs = {
	get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
};

describe("showStoreCredentialsError", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	interface StoreErrorCase {
		platform: NodeJS.Platform;
		message: string;
	}

	it.each<StoreErrorCase>([
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

describe("notifyKeyringSkipped", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(os.platform).mockReturnValue("darwin");
	});

	const url = "http://coder.example.com";
	it.each<[string, CliAuth, number]>([
		[
			"skipped",
			{
				store: "extension",
				url,
				configDir: "/d",
				useKeyring: false,
				refuseRedirects: true,
			},
			1,
		],
		[
			"user config dir",
			{ store: "cli", url, useKeyring: false, refuseRedirects: true },
			0,
		],
		[
			"CLI without keyring support",
			{
				store: "extension",
				url,
				configDir: "/d",
				useKeyring: undefined,
				refuseRedirects: true,
			},
			0,
		],
	])("%s shows %i notices", (_name, auth, notices) => {
		notifyKeyringSkipped(auth, configs);

		expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(notices);
	});
});
