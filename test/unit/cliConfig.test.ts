import * as semver from "semver";
import { afterEach, it, expect, describe, vi } from "vitest";

import {
	type CliAuth,
	getGlobalFlags,
	getGlobalFlagsRaw,
	getSshFlags,
	isKeyringEnabled,
	resolveCliAuth,
	shouldUseKeyring,
} from "@/cliConfig";
import { featureSetForVersion } from "@/featureSet";

import { MockConfigurationProvider } from "../mocks/testHelpers";
import { isWindows } from "../utils/platform";

const globalConfigAuth: CliAuth = {
	mode: "global-config",
	configDir: "/config/dir",
};

describe("cliConfig", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe("getGlobalFlags", () => {
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
				expectedAuthFlags: ["--global-config", '"/config/dir"'],
			},
			{
				scenario: "url mode",
				auth: urlAuth,
				expectedAuthFlags: ["--url", '"https://dev.coder.com"'],
			},
		])(
			"should return auth flags for $scenario",
			({ auth, expectedAuthFlags }) => {
				const config = new MockConfigurationProvider();
				expect(getGlobalFlags(config, auth)).toStrictEqual(expectedAuthFlags);
			},
		);

		it("should return global flags from config with auth flags appended", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"--verbose",
				"--disable-direct-connections",
			]);

			expect(getGlobalFlags(config, globalConfigAuth)).toStrictEqual([
				"--verbose",
				"--disable-direct-connections",
				"--global-config",
				'"/config/dir"',
			]);
		});

		it("should not filter duplicate global-config flags, last takes precedence", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"-v",
				"--global-config /path/to/ignored",
				"--disable-direct-connections",
			]);

			expect(getGlobalFlags(config, globalConfigAuth)).toStrictEqual([
				"-v",
				"--global-config /path/to/ignored",
				"--disable-direct-connections",
				"--global-config",
				'"/config/dir"',
			]);
		});

		it.each<AuthFlagsCase>([
			{
				scenario: "global-config mode",
				auth: globalConfigAuth,
				expectedAuthFlags: ["--global-config", '"/config/dir"'],
			},
			{
				scenario: "url mode",
				auth: urlAuth,
				expectedAuthFlags: ["--url", '"https://dev.coder.com"'],
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

				expect(getGlobalFlags(config, auth)).toStrictEqual([
					"-v",
					"--header-command custom", // ignored by CLI
					"--no-feature-warning",
					...expectedAuthFlags,
					"--header-command",
					quoteCommand(headerCommand),
				]);
			},
		);
	});

	describe("getGlobalFlagsRaw", () => {
		it("returns empty array when no global flags configured", () => {
			const config = new MockConfigurationProvider();

			expect(getGlobalFlagsRaw(config)).toStrictEqual([]);
		});

		it("returns global flags from config", () => {
			const config = new MockConfigurationProvider();
			config.set("coder.globalFlags", [
				"--verbose",
				"--disable-direct-connections",
			]);

			expect(getGlobalFlagsRaw(config)).toStrictEqual([
				"--verbose",
				"--disable-direct-connections",
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
		it.each<KeyringEnabledCase>([
			{ platform: "darwin", useKeyring: true, expected: true },
			{ platform: "win32", useKeyring: true, expected: true },
			{ platform: "linux", useKeyring: true, expected: false },
			{ platform: "darwin", useKeyring: false, expected: false },
		])(
			"returns $expected on $platform with useKeyring=$useKeyring",
			({ platform, useKeyring, expected }) => {
				vi.stubGlobal("process", { ...process, platform });
				const config = new MockConfigurationProvider();
				config.set("coder.useKeyring", useKeyring);
				expect(isKeyringEnabled(config)).toBe(expected);
			},
		);
	});

	describe("shouldUseKeyring", () => {
		interface ShouldUseKeyringCase {
			platform: NodeJS.Platform;
			useKeyring: boolean;
			version: string;
			expected: boolean;
		}
		it.each<ShouldUseKeyringCase>([
			{
				platform: "darwin",
				useKeyring: true,
				version: "2.29.0",
				expected: true,
			},
			{
				platform: "win32",
				useKeyring: true,
				version: "2.29.0",
				expected: true,
			},
			{
				platform: "linux",
				useKeyring: true,
				version: "2.29.0",
				expected: false,
			},
			{
				platform: "darwin",
				useKeyring: true,
				version: "2.28.0",
				expected: false,
			},
			{
				platform: "darwin",
				useKeyring: false,
				version: "2.29.0",
				expected: false,
			},
			{
				platform: "darwin",
				useKeyring: true,
				version: "0.0.0-devel+abc123",
				expected: true,
			},
		])(
			"returns $expected on $platform with useKeyring=$useKeyring and version $version",
			({ platform, useKeyring, version, expected }) => {
				vi.stubGlobal("process", { ...process, platform });
				const config = new MockConfigurationProvider();
				config.set("coder.useKeyring", useKeyring);
				const featureSet = featureSetForVersion(semver.parse(version));
				expect(shouldUseKeyring(config, featureSet)).toBe(expected);
			},
		);
	});

	describe("resolveCliAuth", () => {
		it("returns url mode when keyring should be used", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
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
			vi.stubGlobal("process", { ...process, platform: "linux" });
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
			});
		});
	});
});

function quoteCommand(value: string): string {
	// Used to escape environment variables in commands. See `getHeaderArgs` in src/headers.ts
	const quote = isWindows() ? '"' : "'";
	return `${quote}${value}${quote}`;
}
