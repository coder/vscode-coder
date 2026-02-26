import * as semver from "semver";
import { afterEach, beforeEach, it, expect, describe, vi } from "vitest";

import {
	type CliAuth,
	getGlobalFlags,
	getGlobalFlagsRaw,
	getSshFlags,
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
	describe("getGlobalFlags", () => {
		it("should return global-config and header args when no global flags configured", () => {
			const config = new MockConfigurationProvider();

			expect(getGlobalFlags(config, globalConfigAuth)).toStrictEqual([
				"--global-config",
				'"/config/dir"',
			]);
		});

		it("should return --url when auth mode is url", () => {
			const config = new MockConfigurationProvider();
			const urlAuth: CliAuth = {
				mode: "url",
				url: "https://dev.coder.com",
			};

			expect(getGlobalFlags(config, urlAuth)).toStrictEqual([
				"--url",
				'"https://dev.coder.com"',
			]);
		});

		it("should return global flags from config with global-config appended", () => {
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

		it("should not filter header-command flags, header args appended at end", () => {
			const headerCommand = "echo test";
			const config = new MockConfigurationProvider();
			config.set("coder.headerCommand", headerCommand);
			config.set("coder.globalFlags", [
				"-v",
				"--header-command custom",
				"--no-feature-warning",
			]);

			const result = getGlobalFlags(config, globalConfigAuth);
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

		it("should include --url with header args when using url mode", () => {
			const headerCommand = "echo test";
			const config = new MockConfigurationProvider();
			config.set("coder.headerCommand", headerCommand);
			const urlAuth: CliAuth = {
				mode: "url",
				url: "https://dev.coder.com",
			};

			const result = getGlobalFlags(config, urlAuth);
			expect(result).toStrictEqual([
				"--url",
				'"https://dev.coder.com"',
				"--header-command",
				quoteCommand(headerCommand),
			]);
		});
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

	describe("shouldUseKeyring", () => {
		let originalPlatform: NodeJS.Platform;

		beforeEach(() => {
			originalPlatform = process.platform;
		});

		afterEach(() => {
			vi.stubGlobal("process", { ...process, platform: originalPlatform });
			vi.unstubAllGlobals();
		});

		it("returns true when all conditions are met (macOS, keyringAuth, setting enabled)", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			expect(shouldUseKeyring(featureSet)).toBe(true);
		});

		it("returns true when all conditions are met (Windows)", () => {
			vi.stubGlobal("process", { ...process, platform: "win32" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			expect(shouldUseKeyring(featureSet)).toBe(true);
		});

		it("returns false on Linux", () => {
			vi.stubGlobal("process", { ...process, platform: "linux" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			expect(shouldUseKeyring(featureSet)).toBe(false);
		});

		it("returns false when CLI version is too old", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.28.0"));
			expect(shouldUseKeyring(featureSet)).toBe(false);
		});

		it("returns false when setting is disabled", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", false);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			expect(shouldUseKeyring(featureSet)).toBe(false);
		});

		it("returns true for devel prerelease on macOS", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(
				semver.parse("0.0.0-devel+abc123"),
			);
			expect(shouldUseKeyring(featureSet)).toBe(true);
		});
	});

	describe("resolveCliAuth", () => {
		let originalPlatform: NodeJS.Platform;

		beforeEach(() => {
			originalPlatform = process.platform;
		});

		afterEach(() => {
			vi.stubGlobal("process", { ...process, platform: originalPlatform });
			vi.unstubAllGlobals();
		});

		it("returns url mode when keyring should be used", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(
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
			new MockConfigurationProvider();
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(
				featureSet,
				"https://dev.coder.com",
				"/config/dir",
			);
			expect(auth).toEqual({
				mode: "global-config",
				configDir: "/config/dir",
			});
		});

		it("returns global-config mode when url is undefined", () => {
			vi.stubGlobal("process", { ...process, platform: "darwin" });
			const config = new MockConfigurationProvider();
			config.set("coder.useKeyring", true);
			const featureSet = featureSetForVersion(semver.parse("2.29.0"));
			const auth = resolveCliAuth(featureSet, undefined, "/config/dir");
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
