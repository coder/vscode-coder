import { it, expect, describe } from "vitest";
import { type WorkspaceConfiguration } from "vscode";

import { getGlobalFlags, getSshFlags } from "@/cliConfig";

import { isWindows } from "../utils/platform";

describe("cliConfig", () => {
	describe("getGlobalFlags", () => {
		it("should return global-config and header args when no global flags configured", () => {
			const config = {
				get: () => undefined,
			} as unknown as WorkspaceConfiguration;

			expect(getGlobalFlags(config, "/config/dir")).toStrictEqual([
				"--global-config",
				'"/config/dir"',
			]);
		});

		it("should return global flags from config with global-config appended", () => {
			const config = {
				get: (key: string) =>
					key === "coder.globalFlags"
						? ["--verbose", "--disable-direct-connections"]
						: undefined,
			} as unknown as WorkspaceConfiguration;

			expect(getGlobalFlags(config, "/config/dir")).toStrictEqual([
				"--verbose",
				"--disable-direct-connections",
				"--global-config",
				'"/config/dir"',
			]);
		});

		it("should not filter duplicate global-config flags, last takes precedence", () => {
			const config = {
				get: (key: string) =>
					key === "coder.globalFlags"
						? [
								"-v",
								"--global-config /path/to/ignored",
								"--disable-direct-connections",
							]
						: undefined,
			} as unknown as WorkspaceConfiguration;

			expect(getGlobalFlags(config, "/config/dir")).toStrictEqual([
				"-v",
				"--global-config /path/to/ignored",
				"--disable-direct-connections",
				"--global-config",
				'"/config/dir"',
			]);
		});

		it("should not filter header-command flags, header args appended at end", () => {
			const headerCommand = "echo test";
			const config = {
				get: (key: string) => {
					if (key === "coder.headerCommand") {
						return headerCommand;
					}
					if (key === "coder.globalFlags") {
						return ["-v", "--header-command custom", "--no-feature-warning"];
					}
					return undefined;
				},
			} as unknown as WorkspaceConfiguration;

			const result = getGlobalFlags(config, "/config/dir");
			expect(result).toStrictEqual([
				"-v",
				"--header-command custom", // ignored by CLI
				"--no-feature-warning",
				"--global-config",
				'"/config/dir"',
				"--header-command",
				quoteCommand(headerCommand),
			]);
		});
	});

	describe("getSshFlags", () => {
		it("returns default flags when no SSH flags configured", () => {
			const config = {
				get: (_key: string, defaultValue: unknown) => defaultValue,
			} as unknown as WorkspaceConfiguration;

			expect(getSshFlags(config)).toStrictEqual(["--disable-autostart"]);
		});

		it("returns SSH flags from config", () => {
			const config = {
				get: (key: string) =>
					key === "coder.sshFlags"
						? ["--disable-autostart", "--wait=yes", "--ssh-host-prefix=custom"]
						: undefined,
			} as unknown as WorkspaceConfiguration;

			expect(getSshFlags(config)).toStrictEqual([
				"--disable-autostart",
				"--wait=yes",
				// No filtering and returned as-is (even though it'll be overridden later)
				"--ssh-host-prefix=custom",
			]);
		});
	});
});

function quoteCommand(value: string): string {
	// Used to escape environment variables in commands. See `getHeaderArgs` in src/headers.ts
	const quote = isWindows() ? '"' : "'";
	return `${quote}${value}${quote}`;
}
