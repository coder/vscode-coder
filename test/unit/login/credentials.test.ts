import * as os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { CredentialCliError } from "@/instrumentation/credentials";
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
		scenario: string;
		platform: NodeJS.Platform;
		error: Error;
		message: string;
		actions: string[];
	}

	it.each<StoreErrorCase>([
		{
			scenario: "a credential-command failure with keyring enabled",
			platform: "darwin",
			error: new CredentialCliError(new Error("exit status 36")),
			message:
				'Failed to store credentials: exit status 36. To store the token in a file instead, set "coder.useKeyring" to false.',
			actions: ["Open Settings"],
		},
		{
			scenario: "a credential-command failure on Linux",
			platform: "linux",
			error: new CredentialCliError(new Error("exit status 36")),
			message: "Failed to store credentials: exit status 36.",
			actions: [],
		},
		{
			scenario: "an unsupported CLI version with keyring enabled",
			platform: "darwin",
			error: new Error("CLI version 2.28.9 is unsupported."),
			message:
				"Failed to store credentials: CLI version 2.28.9 is unsupported.",
			actions: [],
		},
	])("logs and shows $scenario", ({ platform, error, message, actions }) => {
		vi.mocked(os.platform).mockReturnValue(platform);
		const logger = createMockLogger();

		showStoreCredentialsError(error, configs, logger);

		expect(logger.error).toHaveBeenCalledWith(
			"Failed to store credentials:",
			expect.any(Error),
		);
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			message,
			...actions,
		);
	});

	it("opens the coder.useKeyring setting from the toast", async () => {
		vi.mocked(os.platform).mockReturnValue("darwin");
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValueOnce(
			"Open Settings" as unknown as vscode.MessageItem,
		);

		showStoreCredentialsError(
			new CredentialCliError(new Error("x")),
			configs,
			createMockLogger(),
		);
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
	])("%s shows %i notices", (_name, auth, notices) => {
		notifyKeyringSkipped(auth, configs);

		expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(notices);
	});
});
