import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	applySettingOverrides,
	buildSshOverrides,
	isActiveRemoteCommand,
} from "@/remote/userSettings";

import {
	MockConfigurationProvider,
	createMockLogger,
} from "../../mocks/testHelpers";

import type * as fs from "node:fs";

vi.mock("node:fs/promises", async () => {
	const memfs: { fs: typeof fs } = await vi.importActual("memfs");
	return memfs.fs.promises;
});

/** Helper to extract a single override by key from the result. */
function findOverride(
	overrides: Array<{ key: string; value: unknown }>,
	key: string,
): unknown {
	return overrides.find((o) => o.key === key)?.value;
}

interface TimeoutCase {
	timeout: number | undefined;
	label: string;
}

describe("isActiveRemoteCommand", () => {
	it.each(["exec bash -l", "exec /bin/zsh", "/usr/bin/tmux"])(
		"returns true for %j",
		(cmd) => expect(isActiveRemoteCommand(cmd)).toBe(true),
	);

	it.each([undefined, "", "none", "None", "NONE"])(
		"returns false for %j",
		(cmd) => expect(isActiveRemoteCommand(cmd)).toBe(false),
	);
});

describe("buildSshOverrides", () => {
	describe("remote platform", () => {
		it("adds host when missing or OS differs", () => {
			const config = new MockConfigurationProvider();

			// New host is added alongside existing entries.
			config.set("remote.SSH.remotePlatform", { "other-host": "darwin" });
			expect(
				findOverride(
					buildSshOverrides(config, "new-host", "linux"),
					"remote.SSH.remotePlatform",
				),
			).toEqual({ "other-host": "darwin", "new-host": "linux" });

			// Existing host with wrong OS gets corrected.
			config.set("remote.SSH.remotePlatform", { "my-host": "windows" });
			expect(
				findOverride(
					buildSshOverrides(config, "my-host", "linux"),
					"remote.SSH.remotePlatform",
				),
			).toEqual({ "my-host": "linux" });
		});

		it("skips override when host already matches", () => {
			const config = new MockConfigurationProvider();
			config.set("remote.SSH.remotePlatform", { "my-host": "linux" });
			expect(
				findOverride(
					buildSshOverrides(config, "my-host", "linux"),
					"remote.SSH.remotePlatform",
				),
			).toBeUndefined();
		});

		describe("RemoteCommand compatibility", () => {
			it("removes host from remotePlatform when enableRemoteCommand is true", () => {
				const config = new MockConfigurationProvider();
				config.set("remote.SSH.enableRemoteCommand", true);
				config.set("remote.SSH.remotePlatform", {
					"my-host": "linux",
					"other-host": "darwin",
				});
				expect(
					findOverride(
						buildSshOverrides(config, "my-host", "linux", "exec bash -l"),
						"remote.SSH.remotePlatform",
					),
				).toEqual({ "other-host": "darwin" });
			});

			it("produces no override when host has no stale remotePlatform entry", () => {
				const config = new MockConfigurationProvider();
				config.set("remote.SSH.enableRemoteCommand", true);
				config.set("remote.SSH.remotePlatform", {});
				expect(
					findOverride(
						buildSshOverrides(config, "my-host", "linux", "exec bash -l"),
						"remote.SSH.remotePlatform",
					),
				).toBeUndefined();
			});

			it("sets platform normally when enableRemoteCommand is false", () => {
				const config = new MockConfigurationProvider();
				config.set("remote.SSH.enableRemoteCommand", false);
				config.set("remote.SSH.remotePlatform", {});
				expect(
					findOverride(
						buildSshOverrides(config, "my-host", "linux", "exec bash -l"),
						"remote.SSH.remotePlatform",
					),
				).toEqual({ "my-host": "linux" });
			});

			it.each(["none", "None", "NONE", "", undefined])(
				"sets platform normally when remoteCommand is %j",
				(cmd) => {
					const config = new MockConfigurationProvider();
					config.set("remote.SSH.enableRemoteCommand", true);
					config.set("remote.SSH.remotePlatform", {});
					expect(
						findOverride(
							buildSshOverrides(config, "my-host", "linux", cmd),
							"remote.SSH.remotePlatform",
						),
					).toEqual({ "my-host": "linux" });
				},
			);
		});
	});

	describe("connect timeout", () => {
		it.each<TimeoutCase>([
			{ timeout: undefined, label: "unset" },
			{ timeout: 0, label: "zero" },
			{ timeout: 15, label: "below minimum" },
			{ timeout: 1799, label: "just under minimum" },
		])("enforces minimum of 1800 when $label", ({ timeout }) => {
			const config = new MockConfigurationProvider();
			if (timeout !== undefined) {
				config.set("remote.SSH.connectTimeout", timeout);
			}
			expect(
				findOverride(
					buildSshOverrides(config, "host", "linux"),
					"remote.SSH.connectTimeout",
				),
			).toBe(1800);
		});

		it.each<TimeoutCase>([
			{ timeout: 1800, label: "exactly minimum" },
			{ timeout: 3600, label: "above minimum" },
		])("preserves timeout when $label", ({ timeout }) => {
			const config = new MockConfigurationProvider();
			config.set("remote.SSH.connectTimeout", timeout);
			expect(
				findOverride(
					buildSshOverrides(config, "host", "linux"),
					"remote.SSH.connectTimeout",
				),
			).toBeUndefined();
		});
	});

	describe("reconnection grace time", () => {
		it("defaults to 8 hours when not configured", () => {
			expect(
				findOverride(
					buildSshOverrides(new MockConfigurationProvider(), "host", "linux"),
					"remote.SSH.reconnectionGraceTime",
				),
			).toBe(28800);
		});

		it("preserves any user-configured value", () => {
			const config = new MockConfigurationProvider();
			config.set("remote.SSH.reconnectionGraceTime", 3600);
			expect(
				findOverride(
					buildSshOverrides(config, "host", "linux"),
					"remote.SSH.reconnectionGraceTime",
				),
			).toBeUndefined();
		});
	});

	it.each([
		{ key: "remote.SSH.serverShutdownTimeout", expected: 28800 },
		{ key: "remote.SSH.maxReconnectionAttempts", expected: null },
	])("defaults $key when not configured", ({ key, expected }) => {
		const overrides = buildSshOverrides(
			new MockConfigurationProvider(),
			"host",
			"linux",
		);
		expect(findOverride(overrides, key)).toBe(expected);
	});

	it("produces no overrides when all settings are already correct", () => {
		const config = new MockConfigurationProvider();
		config.set("remote.SSH.remotePlatform", { "my-host": "linux" });
		config.set("remote.SSH.connectTimeout", 3600);
		config.set("remote.SSH.reconnectionGraceTime", 7200);
		config.set("remote.SSH.serverShutdownTimeout", 600);
		config.set("remote.SSH.maxReconnectionAttempts", 4);
		expect(buildSshOverrides(config, "my-host", "linux")).toHaveLength(0);
	});
});

describe("applySettingOverrides", () => {
	const settingsPath = "/settings.json";
	const logger = createMockLogger();

	beforeEach(() => {
		vol.reset();
	});

	async function readSettings(): Promise<Record<string, unknown>> {
		const raw = await fsPromises.readFile(settingsPath, "utf8");
		return JSON.parse(raw) as Record<string, unknown>;
	}

	it("returns true when overrides list is empty", async () => {
		expect(await applySettingOverrides(settingsPath, [], logger)).toBe(true);
	});

	it("creates file and applies overrides when file does not exist", async () => {
		const ok = await applySettingOverrides(
			settingsPath,
			[
				{
					key: "remote.SSH.remotePlatform",
					value: { "coder-gke--main": "linux" },
				},
				{ key: "remote.SSH.connectTimeout", value: 1800 },
				{ key: "remote.SSH.reconnectionGraceTime", value: 28800 },
			],
			logger,
		);

		expect(ok).toBe(true);
		expect(await readSettings()).toMatchObject({
			"remote.SSH.remotePlatform": { "coder-gke--main": "linux" },
			"remote.SSH.connectTimeout": 1800,
			"remote.SSH.reconnectionGraceTime": 28800,
		});
	});

	it("preserves existing settings when applying overrides", async () => {
		vol.fromJSON({
			[settingsPath]: JSON.stringify({
				"remote.SSH.remotePlatform": { "coder-gke--main": "linux" },
				"remote.SSH.connectTimeout": 15,
			}),
		});

		await applySettingOverrides(
			settingsPath,
			[{ key: "remote.SSH.connectTimeout", value: 1800 }],
			logger,
		);

		expect(await readSettings()).toMatchObject({
			"remote.SSH.remotePlatform": { "coder-gke--main": "linux" },
			"remote.SSH.connectTimeout": 1800,
		});
	});

	it("handles JSONC with comments", async () => {
		vol.fromJSON({
			[settingsPath]: [
				"{",
				"  // Platform overrides for remote SSH hosts",
				'  "remote.SSH.remotePlatform": { "coder-gke--main": "linux" },',
				'  "remote.SSH.connectTimeout": 15',
				"}",
			].join("\n"),
		});

		await applySettingOverrides(
			settingsPath,
			[{ key: "remote.SSH.connectTimeout", value: 1800 }],
			logger,
		);

		const raw = await fsPromises.readFile(settingsPath, "utf8");
		expect(raw).toContain("// Platform overrides for remote SSH hosts");
		expect(raw).toContain("1800");
		expect(raw).toContain('"remote.SSH.remotePlatform"');
	});

	it("writes null values literally instead of deleting the key", async () => {
		const ok = await applySettingOverrides(
			settingsPath,
			[{ key: "remote.SSH.maxReconnectionAttempts", value: null }],
			logger,
		);

		expect(ok).toBe(true);
		const raw = await fsPromises.readFile(settingsPath, "utf8");
		expect(raw).toContain('"remote.SSH.maxReconnectionAttempts": null');
	});

	it("returns false and logs warning when write fails", async () => {
		vol.fromJSON({ [settingsPath]: "{}" });
		const writeSpy = vi
			.spyOn(fsPromises, "writeFile")
			.mockRejectedValueOnce(new Error("EACCES: permission denied"));

		const ok = await applySettingOverrides(
			settingsPath,
			[{ key: "remote.SSH.connectTimeout", value: 1800 }],
			logger,
		);

		expect(ok).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			"Failed to configure settings",
			expect.anything(),
		);

		writeSpy.mockRestore();
	});
});
