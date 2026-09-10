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

const URL = "https://dev.coder.com";
const EXT_DIR = "/config/dir";
const USER_DIR = "/custom/coderv2";

const privateAuth: CliAuth = {
	store: "private",
	url: URL,
	configDir: EXT_DIR,
	useKeyring: undefined,
};
const sharedAuth: CliAuth = {
	store: "shared",
	url: URL,
	useKeyring: undefined,
};

const PRIVATE_FLAGS = ["--global-config", EXT_DIR, "--url", URL];
const SHARED_FLAGS = ["--url", URL];

describe("cliConfig", () => {
	describe("getGlobalShellFlags", () => {
		interface AuthFlagsCase {
			scenario: string;
			auth: CliAuth;
			expected: string[];
		}

		it.each<AuthFlagsCase>([
			{ scenario: "private store", auth: privateAuth, expected: PRIVATE_FLAGS },
			{ scenario: "shared store", auth: sharedAuth, expected: SHARED_FLAGS },
			{
				scenario: "private store with keyring off",
				auth: { ...privateAuth, useKeyring: false },
				expected: [...PRIVATE_FLAGS, "--use-keyring=false"],
			},
			{
				scenario: "shared store with keyring on",
				auth: { ...sharedAuth, useKeyring: true },
				expected: [...SHARED_FLAGS, "--use-keyring=true"],
			},
		])("emits auth flags for a $scenario", ({ auth, expected }) => {
			const config = new MockConfigurationProvider();
			expect(getGlobalShellFlags(config, auth)).toStrictEqual(expected);
		});

		it("appends auth flags after user global flags", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--verbose", "--global-configs"]);

			expect(getGlobalShellFlags(config, privateAuth)).toStrictEqual([
				"--verbose",
				"--global-configs", // similar prefixes are not managed flags
				...PRIVATE_FLAGS,
			]);
		});

		it("strips a user --use-keyring flag", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--verbose", "--use-keyring=false"]);

			expect(getGlobalShellFlags(config, privateAuth)).toStrictEqual([
				"--verbose",
				...PRIVATE_FLAGS,
			]);
		});

		const userGlobalConfigCases = [
			{ scenario: "equals form", flags: ["-v", `--global-config=${USER_DIR}`] },
			{
				scenario: "separate items",
				flags: ["-v", "--global-config", USER_DIR],
			},
		];

		it.each(userGlobalConfigCases)(
			"passes user --global-config through in a shared store ($scenario)",
			({ flags }) => {
				const config = new MockConfigurationProvider();
				config.set("coder.globalFlags", flags);

				expect(getGlobalShellFlags(config, sharedAuth)).toStrictEqual([
					...flags,
					...SHARED_FLAGS,
				]);
			},
		);

		it.each([
			...userGlobalConfigCases,
			{
				scenario: "space-separated in one item",
				flags: ["-v", `--global-config ${USER_DIR}`],
			},
		])(
			"strips user --global-config in a private store ($scenario)",
			({ flags }) => {
				const config = new MockConfigurationProvider();
				config.set("coder.globalFlags", flags);

				expect(getGlobalShellFlags(config, privateAuth)).toStrictEqual([
					"-v",
					...PRIVATE_FLAGS,
				]);
			},
		);

		it("keeps user header-command items and appends the setting", () => {
			const headerCommand = "echo test";
			const config = new MockConfigurationProvider();
			config.set("coder.headerCommand", headerCommand);
			config.set("coder.globalFlags", ["-v", "--header-command custom"]);

			expect(getGlobalShellFlags(config, sharedAuth)).toStrictEqual([
				"-v",
				'"--header-command custom"', // ignored by CLI
				...SHARED_FLAGS,
				"--header-command",
				quoteCommand(headerCommand),
			]);
		});

		it("quotes flags whose expanded value contains whitespace", () => {
			vi.mocked(os.homedir).mockReturnValue("C:\\Users\\John Doe");
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--cfg=${userHome}/coder"]);

			// Without per-entry escaping the space splits the shell command.
			expect(getGlobalShellFlags(config, privateAuth)).toStrictEqual([
				'"--cfg=C:\\Users\\John Doe/coder"',
				...PRIVATE_FLAGS,
			]);
		});
	});

	describe("getGlobalFlags", () => {
		it("passes user flags, auth flags, and header-command verbatim", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", ["--verbose"]);
			config.set("coder.headerCommand", "echo test");

			expect(getGlobalFlags(config, privateAuth)).toStrictEqual([
				"--verbose",
				...PRIVATE_FLAGS,
				"--header-command",
				"echo test",
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
		interface Case {
			platform: NodeJS.Platform;
			useKeyring?: boolean;
			expected: boolean;
		}

		it.each<Case>([
			{ platform: "darwin", expected: true },
			{ platform: "win32", expected: true },
			{ platform: "linux", expected: false },
			{ platform: "linux", useKeyring: true, expected: false },
			{ platform: "darwin", useKeyring: false, expected: false },
		])(
			"returns $expected on $platform with useKeyring=$useKeyring",
			({ platform, useKeyring, expected }) => {
				vi.mocked(os.platform).mockReturnValue(platform);
				const config = new MockConfigurationProvider();
				if (useKeyring !== undefined) {
					config.set("coder.useKeyring", useKeyring);
				}
				expect(isKeyringEnabled(config)).toBe(expected);
			},
		);
	});

	describe("resolveCliAuth", () => {
		function resolve(config: MockConfigurationProvider, version: string) {
			const featureSet = featureSetForVersion(semver.parse(version));
			return resolveCliAuth(config, featureSet, URL, EXT_DIR);
		}

		beforeEach(() => {
			vi.stubEnv("CODER_CONFIG_DIR", undefined);
		});

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		interface Case {
			scenario: string;
			platform: NodeJS.Platform;
			override: "none" | "flag" | "env";
			version: string;
			expected: string[];
		}

		it.each<Case>([
			{
				scenario: "shares the CLI store when keyring is enabled on 2.29+",
				platform: "darwin",
				override: "none",
				version: "2.29.0",
				expected: ["--verbose", ...SHARED_FLAGS, "--use-keyring=true"],
			},
			{
				scenario: "uses the extension directory when keyring is unsupported",
				platform: "linux",
				override: "none",
				version: "2.29.0",
				expected: ["--verbose", ...PRIVATE_FLAGS, "--use-keyring=false"],
			},
			{
				scenario:
					"omits --use-keyring below 2.29, where the CLI lacks the flag",
				platform: "darwin",
				override: "none",
				version: "2.28.0",
				expected: ["--verbose", ...PRIVATE_FLAGS],
			},
			{
				scenario: "honors a globalFlags --global-config on 2.31+",
				platform: "darwin",
				override: "flag",
				version: "2.31.0",
				expected: [
					"--verbose",
					`--global-config=${USER_DIR}`,
					...SHARED_FLAGS,
					"--use-keyring=true",
				],
			},
			{
				scenario: "honors CODER_CONFIG_DIR on 2.31+ by emitting no directory",
				platform: "darwin",
				override: "env",
				version: "2.31.0",
				expected: ["--verbose", ...SHARED_FLAGS, "--use-keyring=true"],
			},
			{
				scenario: "honors a globalFlags --global-config with keyring disabled",
				platform: "linux",
				override: "flag",
				version: "2.31.0",
				expected: [
					"--verbose",
					`--global-config=${USER_DIR}`,
					...SHARED_FLAGS,
					"--use-keyring=false",
				],
			},
			{
				scenario:
					"keeps the extension directory over a user directory below 2.31",
				platform: "linux",
				override: "flag",
				version: "2.30.0",
				expected: ["--verbose", ...PRIVATE_FLAGS, "--use-keyring=false"],
			},
			{
				scenario:
					"keeps the extension directory over CODER_CONFIG_DIR below 2.31",
				platform: "linux",
				override: "env",
				version: "2.30.0",
				expected: ["--verbose", ...PRIVATE_FLAGS, "--use-keyring=false"],
			},
		])("$scenario", ({ platform, override, version, expected }) => {
			vi.mocked(os.platform).mockReturnValue(platform);
			const config = new MockConfigurationProvider();
			const userFlags = ["--verbose"];
			if (override === "flag") {
				userFlags.push(`--global-config=${USER_DIR}`);
			} else if (override === "env") {
				vi.stubEnv("CODER_CONFIG_DIR", USER_DIR);
			}
			config.set("coder.globalFlags", userFlags);

			expect(getGlobalFlags(config, resolve(config, version))).toStrictEqual(
				expected,
			);
		});
	});
});
