import * as os from "node:os";
import * as semver from "semver";
import { afterEach, beforeEach, it, expect, describe, vi } from "vitest";

import { featureSetForVersion } from "@/featureSet";
import {
	type CliAuth,
	getExpandedUserGlobalFlags,
	getGlobalFlags,
	getGlobalShellFlags,
	getSshFlags,
	isKeyringEnabled,
	resolveCliAuth,
} from "@/settings/cli";

import { MockConfigurationProvider } from "../mocks/testHelpers";
import { quoteCommand } from "../utils/platform";

vi.mock("node:os");

const globalConfigAuth: CliAuth = {
	mode: "global-config",
	configDir: "/config/dir",
	allowOverride: true,
};

describe("cliConfig", () => {
	describe("getGlobalShellFlags", () => {
		const urlAuth: CliAuth = { mode: "url", url: "https://dev.coder.com" };

		interface AuthFlagsCase {
			scenario: string;
			auth: CliAuth;
			expectedAuthFlags: string[];
		}

		it.each<AuthFlagsCase>([
			{
				scenario: "global-config mode",
				auth: globalConfigAuth,
				expectedAuthFlags: ["--global-config", "/config/dir"],
			},
			{
				scenario: "url mode",
				auth: urlAuth,
				expectedAuthFlags: ["--url", "https://dev.coder.com"],
			},
		])(
			"should return auth flags for $scenario",
			({ auth, expectedAuthFlags }) => {
				const config = new MockConfigurationProvider();
				expect(getGlobalShellFlags(config, auth)).toStrictEqual(
					expectedAuthFlags,
				);
			},
		);

		it("should return global flags from config with auth flags appended", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"--verbose",
				"--disable-direct-connections",
			]);

			expect(getGlobalShellFlags(config, globalConfigAuth)).toStrictEqual([
				"--verbose",
				"--disable-direct-connections",
				"--global-config",
				"/config/dir",
			]);
		});

		it.each(["--use-keyring", "--use-keyring=false", "--use-keyring=true"])(
			"should filter %s from global flags",
			(managedFlag) => {
				const config = new MockConfigurationProvider();
				config.set("coder.globalFlags", [
					"--verbose",
					managedFlag,
					"--disable-direct-connections",
				]);

				expect(getGlobalShellFlags(config, globalConfigAuth)).toStrictEqual([
					"--verbose",
					"--disable-direct-connections",
					"--global-config",
					"/config/dir",
				]);
			},
		);

		interface GlobalConfigCase {
			scenario: string;
			flags: string[];
			expected: string[];
		}
		it.each<GlobalConfigCase>([
			{
				scenario: "equals form",
				flags: ["-v", "--global-config=/custom/coderv2"],
				expected: ["-v", "--global-config=/custom/coderv2"],
			},
			{
				scenario: "separate items",
				flags: ["-v", "--global-config", "/custom/coderv2"],
				expected: ["-v", "--global-config", "/custom/coderv2"],
			},
		])(
			"passes user --global-config through in file mode and drops our default ($scenario)",
			({ flags, expected }) => {
				const config = new MockConfigurationProvider();
				config.set("coder.globalFlags", flags);

				expect(getGlobalShellFlags(config, globalConfigAuth)).toStrictEqual(
					expected,
				);
			},
		);

		it.each([
			{ scenario: "space-separated in one item", flag: "--global-config /x" },
			{ scenario: "equals form", flag: "--global-config=/x" },
		])(
			"strips user --global-config in keyring (url) mode ($scenario)",
			({ flag }) => {
				const urlAuth: CliAuth = { mode: "url", url: "https://dev.coder.com" };
				const config = new MockConfigurationProvider();
				config.set("coder.globalFlags", ["-v", flag]);

				expect(getGlobalShellFlags(config, urlAuth)).toStrictEqual([
					"-v",
					"--url",
					"https://dev.coder.com",
				]);
			},
		);

		it("strips user --global-config (separate items) in keyring (url) mode", () => {
			const urlAuth: CliAuth = { mode: "url", url: "https://dev.coder.com" };
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["-v", "--global-config", "/x"]);

			expect(getGlobalShellFlags(config, urlAuth)).toStrictEqual([
				"-v",
				"--url",
				"https://dev.coder.com",
			]);
		});

		it("should not filter flags with similar prefixes", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--global-configs", "--use-keyrings"]);

			expect(getGlobalShellFlags(config, globalConfigAuth)).toStrictEqual([
				"--global-configs",
				"--use-keyrings",
				"--global-config",
				"/config/dir",
			]);
		});

		it.each<AuthFlagsCase>([
			{
				scenario: "global-config mode",
				auth: globalConfigAuth,
				expectedAuthFlags: ["--global-config", "/config/dir"],
			},
			{
				scenario: "url mode",
				auth: urlAuth,
				expectedAuthFlags: ["--url", "https://dev.coder.com"],
			},
		])(
			"should not filter header-command flags ($scenario)",
			({ auth, expectedAuthFlags }) => {
				const headerCommand = "echo test";
				const config = new MockConfigurationProvider();
				config.set("coder.headerCommand", headerCommand);
				config.set("coder.globalFlags", [
					"-v",
					"--header-command custom",
					"--no-feature-warning",
				]);

				expect(getGlobalShellFlags(config, auth)).toStrictEqual([
					"-v",
					'"--header-command custom"', // ignored by CLI
					"--no-feature-warning",
					...expectedAuthFlags,
					"--header-command",
					quoteCommand(headerCommand),
				]);
			},
		);

		it("quotes flags whose expanded value contains whitespace", () => {
			vi.mocked(os.homedir).mockReturnValue("C:\\Users\\John Doe");
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--cfg=${userHome}/coder"]);

			// Without per-entry escaping the space splits the shell command.
			expect(getGlobalShellFlags(config, globalConfigAuth)).toStrictEqual([
				'"--cfg=C:\\Users\\John Doe/coder"',
				"--global-config",
				"/config/dir",
			]);
		});
	});

	describe("getGlobalFlags", () => {
		const urlAuth: CliAuth = { mode: "url", url: "https://dev.coder.com" };

		it("should not escape auth flags", () => {
			const config = new MockConfigurationProvider();
			expect(getGlobalFlags(config, globalConfigAuth)).toStrictEqual([
				"--global-config",
				"/config/dir",
			]);
			expect(getGlobalFlags(config, urlAuth)).toStrictEqual([
				"--url",
				"https://dev.coder.com",
			]);
		});

		it("passes header-command value through verbatim (no shell)", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.headerCommand", "echo test");
			expect(getGlobalFlags(config, globalConfigAuth)).toStrictEqual([
				"--global-config",
				"/config/dir",
				"--header-command",
				"echo test",
			]);
		});

		it("should include user global flags", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--verbose"]);
			expect(getGlobalFlags(config, globalConfigAuth)).toStrictEqual([
				"--verbose",
				"--global-config",
				"/config/dir",
			]);
		});
	});

	describe("getExpandedUserGlobalFlags", () => {
		it("returns empty array when no global flags configured", () => {
			const config = new MockConfigurationProvider();

			expect(getExpandedUserGlobalFlags(config)).toStrictEqual([]);
		});

		it("returns global flags from config", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"--verbose",
				"--disable-direct-connections",
			]);

			expect(getExpandedUserGlobalFlags(config)).toStrictEqual([
				"--verbose",
				"--disable-direct-connections",
			]);
		});

		describe("env substitution", () => {
			beforeEach(() => {
				vi.stubEnv("CODER_TEST_VAR", "from-env");
				vi.stubEnv("CODER_MISSING_VAR", undefined);
			});

			afterEach(() => {
				vi.unstubAllEnvs();
			});

			it("substitutes ${env:VAR} from process.env", () => {
				const config = new MockConfigurationProvider();
				config.set("coder.globalFlags", [
					"--prefix=${env:CODER_TEST_VAR}",
					"${env:CODER_MISSING_VAR}-suffix",
				]);

				expect(getExpandedUserGlobalFlags(config)).toStrictEqual([
					"--prefix=from-env",
					"-suffix",
				]);
			});
		});

		it("expands ~ and ${userHome} in flag values", () => {
			vi.mocked(os.homedir).mockReturnValue("/home/coder");
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"~/bare",
				"--cfg=~/coder",
				"--state=${userHome}/state",
				"--literal=value~with~tildes",
			]);

			expect(getExpandedUserGlobalFlags(config)).toStrictEqual([
				"/home/coder/bare",
				"--cfg=/home/coder/coder",
				"--state=/home/coder/state",
				// Tildes mid-value are left alone (only ~ at the start of the
				// value half is expanded).
				"--literal=value~with~tildes",
			]);
		});
	});

	describe("getSshFlags", () => {
		it("returns default flags when no SSH flags configured", () => {
			const config = new MockConfigurationProvider();

			expect(getSshFlags(config)).toStrictEqual(["--disable-autostart"]);
		});

		it("returns SSH flags from config", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.sshFlags", [
				"--disable-autostart",
				"--wait=yes",
				"--ssh-host-prefix=custom",
			]);

			expect(getSshFlags(config)).toStrictEqual([
				"--disable-autostart",
				"--wait=yes",
				// No filtering and returned as-is (even though it'll be overridden later)
				"--ssh-host-prefix=custom",
			]);
		});
	});

	describe("isKeyringEnabled", () => {
		interface KeyringEnabledCase {
			platform: NodeJS.Platform;
			useKeyring: boolean;
			expected: boolean;
		}
		it("returns false on darwin when setting is unset (default)", () => {
			vi.mocked(os.platform).mockReturnValue("darwin");
			const config = new MockConfigurationProvider();
			expect(isKeyringEnabled(config)).toBe(false);
		});

		it.each<KeyringEnabledCase>([
			{ platform: "darwin", useKeyring: true, expected: true },
			{ platform: "win32", useKeyring: true, expected: true },
			{ platform: "linux", useKeyring: true, expected: false },
			{ platform: "darwin", useKeyring: false, expected: false },
		])(
			"returns $expected on $platform with useKeyring=$useKeyring",
			({ platform, useKeyring, expected }) => {
				vi.mocked(os.platform).mockReturnValue(platform);
				const config = new MockConfigurationProvider();
				config.set("coder.useKeyring", useKeyring);
				expect(isKeyringEnabled(config)).toBe(expected);
			},
		);
	});

	describe("resolveCliAuth", () => {
		it("returns url mode when keyring should be used", () => {
			vi.mocked(os.platform).mockReturnValue("darwin");
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(
				config,
				featureSet,
				"https://dev.coder.com",
				"/config/dir",
			);
			expect(auth).toEqual({
				mode: "url",
				url: "https://dev.coder.com",
			});
		});

		it("returns global-config mode when keyring should not be used", () => {
			vi.mocked(os.platform).mockReturnValue("linux");
			const config = new MockConfigurationProvider();
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(
				config,
				featureSet,
				"https://dev.coder.com",
				"/config/dir",
			);
			expect(auth).toEqual({
				mode: "global-config",
				configDir: "/config/dir",
				// 2.29 < 2.31, so a user --global-config is not honored.
				allowOverride: false,
			});
		});

		it("uses caller-provided config directory in global-config mode", () => {
			vi.mocked(os.platform).mockReturnValue("linux");
			const config = new MockConfigurationProvider();
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(
				config,
				featureSet,
				"https://dev.coder.com",
				"/custom/coderv2",
			);

			expect(getGlobalFlags(config, auth)).toStrictEqual([
				"--global-config",
				"/custom/coderv2",
			]);
		});

		it("keeps keyring precedence over caller-provided config directory", () => {
			vi.mocked(os.platform).mockReturnValue("darwin");
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(
				config,
				featureSet,
				"https://dev.coder.com",
				"/custom/coderv2",
			);

			expect(getGlobalFlags(config, auth)).toStrictEqual([
				"--url",
				"https://dev.coder.com",
			]);
		});

		it("lets globalFlags --global-config override the caller-provided directory on 2.31+", () => {
			vi.mocked(os.platform).mockReturnValue("linux");
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"--verbose",
				"--global-config=/custom/coderv2",
			]);
			const featureSet = featureSetForVersion(semver.parse("2.31.0"));
			const auth = resolveCliAuth(
				config,
				featureSet,
				"https://dev.coder.com",
				"/default/coderv2",
			);

			// User's directory passes through; our default is dropped.
			expect(getGlobalFlags(config, auth)).toStrictEqual([
				"--verbose",
				"--global-config=/custom/coderv2",
			]);
		});

		it("ignores globalFlags --global-config on deployments older than 2.31", () => {
			vi.mocked(os.platform).mockReturnValue("linux");
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"--verbose",
				"--global-config=/custom/coderv2",
			]);
			const featureSet = featureSetForVersion(semver.parse("2.30.0"));
			const auth = resolveCliAuth(
				config,
				featureSet,
				"https://dev.coder.com",
				"/default/coderv2",
			);

			// User override stripped; our default is used so it matches where we wrote.
			expect(getGlobalFlags(config, auth)).toStrictEqual([
				"--verbose",
				"--global-config",
				"/default/coderv2",
			]);
		});
	});
});
