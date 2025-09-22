import { getGlobalFlags } from "@/globalFlags";
import { it, expect, describe } from "vitest";
import { WorkspaceConfiguration } from "vscode";

describe("Global flags suite", () => {
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
		const config = {
			get: (key: string) => {
				if (key === "coder.headerCommand") {
					return "echo test";
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
			"'echo test'",
		]);
	});
});
