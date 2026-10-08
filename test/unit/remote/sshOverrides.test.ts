import { vol } from "memfs";
import * as fsPromises from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	applySettingOverrides,
	buildSshOverrides,
	getRecommendedSshSettings,
} from "@/remote/sshOverrides";

import {
	MockConfigurationProvider,
	createMockLogger,
} from "../../mocks/testHelpers";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);

beforeEach(() => {
	vi.mocked(vscode.extensions.getExtension).mockImplementation((id) =>
		id === "ms-vscode-remote.remote-ssh"
			? ({ id } as vscode.Extension<unknown>)
			: undefined,
	);
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

describe("buildSshOverrides", () => {
	const buildLogger = createMockLogger();
	describe("remote platform", () => {
		it("adds host when missing or OS differs", () => {
			const config = new MockConfigurationProvider();

			// New host is added alongside existing entries.
			config.set("remote.SSH.remotePlatform", { "other-host": "darwin" });
			expect(
				findOverride(
					buildSshOverrides(
						config,
						"new-host",
						"linux",
						undefined,
						buildLogger,
					),
					"remote.SSH.remotePlatform",
				),
			).toEqual({ "other-host": "darwin", "new-host": "linux" });

			// Existing host with wrong OS gets corrected.
			config.set("remote.SSH.remotePlatform", { "my-host": "windows" });
			expect(
				findOverride(
					buildSshOverrides(config, "my-host", "linux", undefined, buildLogger),
					"remote.SSH.remotePlatform",
				),
			).toEqual({ "my-host": "linux" });
		});

		it("skips override when host already matches", () => {
			const config = new MockConfigurationProvider();
			config.set("remote.SSH.remotePlatform", { "my-host": "linux" });
			expect(
				findOverride(
					buildSshOverrides(config, "my-host", "linux", undefined, buildLogger),
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
						buildSshOverrides(
							config,
							"my-host",
							"linux",
							"exec bash -l",
							buildLogger,
						),
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
						buildSshOverrides(
							config,
							"my-host",
							"linux",
							"exec bash -l",
							buildLogger,
						),
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
						buildSshOverrides(
							config,
							"my-host",
							"linux",
							"exec bash -l",
							buildLogger,
						),
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
							buildSshOverrides(config, "my-host", "linux", cmd, buildLogger),
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
					buildSshOverrides(config, "host", "linux", undefined, buildLogger),
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
					buildSshOverrides(config, "host", "linux", undefined, buildLogger),
					"remote.SSH.connectTimeout",
				),
			).toBeUndefined();
		});
	});

	describe("reconnection grace time", () => {
		it("defaults to 8 hours when not configured", () => {
			expect(
				findOverride(
					buildSshOverrides(
						new MockConfigurationProvider(),
						"host",
						"linux",
						undefined,
						buildLogger,
					),
					"remote.SSH.reconnectionGraceTime",
				),
			).toBe(28800);
		});

		it("preserves any user-configured value", () => {
			const config = new MockConfigurationProvider();
			config.set("remote.SSH.reconnectionGraceTime", 3600);
			expect(
				findOverride(
					buildSshOverrides(config, "host", "linux", undefined, buildLogger),
					"remote.SSH.reconnectionGraceTime",
				),
			).toBeUndefined();
		});
	});

	it("produces no overrides when all settings are already correct", () => {
		const config = new MockConfigurationProvider();
		config.set("remote.SSH.remotePlatform", { "my-host": "linux" });
		config.set("remote.SSH.connectTimeout", 3600);
		config.set("remote.SSH.reconnectionGraceTime", 7200);
		config.set("remote.SSH.serverShutdownTimeout", 600);
		config.set("remote.SSH.maxReconnectionAttempts", 4);
		expect(
			buildSshOverrides(config, "my-host", "linux", undefined, buildLogger),
		).toHaveLength(0);
	});
});

describe("provider-specific tuning", () => {
	const logger = createMockLogger();
	const tuning = (
		config: MockConfigurationProvider,
		extensionId: string | undefined,
	) => {
		vi.mocked(vscode.extensions.getExtension).mockImplementation((id) =>
			id === extensionId ? ({ id } as vscode.Extension<unknown>) : undefined,
		);
		return Object.fromEntries(
			buildSshOverrides(config, "host", "linux", undefined, logger)
				.filter(({ key }) => key !== "remote.SSH.remotePlatform")
				.map(({ key, value }) => [key, value]),
		);
	};

	it.each([
		[
			"VS Code",
			"ms-vscode-remote.remote-ssh",
			"remote.SSH",
			{
				connectTimeout: 1800,
				reconnectionGraceTime: 28800,
				maxReconnectionAttempts: null,
			},
		],
		[
			"Cursor",
			"anysphere.remote-ssh",
			"remote.SSH",
			{ connectTimeout: 1800, serverShutdownTimeout: 28800 },
		],
		[
			"Open Remote SSH forks",
			"jeanp413.open-remote-ssh",
			"remote.SSH",
			{ connectTimeout: 1800 },
		],
		[
			"Devin",
			"codeium.windsurf-remote-openssh",
			"remote.devinSSH",
			{
				connectTimeout: 1800,
				reconnectionGraceTime: 28800,
				maxReconnectionAttempts: null,
			},
		],
		[
			"Windsurf 2.x",
			"codeium.windsurf-remote-openssh",
			"remote.windsurfSSH",
			{
				connectTimeout: 1800,
				reconnectionGraceTime: 28800,
				maxReconnectionAttempts: null,
			},
		],
		["Windsurf before 2.0", "codeium.windsurf-remote-openssh", undefined, {}],
		["Antigravity", "google.antigravity-remote-openssh", undefined, {}],
		["Unrecognized provider", undefined, undefined, {}],
	] as const)(
		"applies supported settings for %s",
		(_editor, id, namespace, settings) => {
			const config = new MockConfigurationProvider();
			if (namespace) config.setDefault(`${namespace}.connectTimeout`, 15);
			config.setDefault("remote.SSH.serverShutdownTimeout", 300);
			if (namespace)
				config.setDefault(`${namespace}.reconnectionGraceTime`, null);
			const automatic = Object.fromEntries(
				Object.entries(settings).map(([key, value]) => [
					`${namespace}.${key}`,
					value,
				]),
			);
			expect(tuning(config, id)).toEqual(automatic);
			const recommended = getRecommendedSshSettings(config);
			expect(Object.keys(recommended)).toEqual(Object.keys(automatic));
			if (namespace && id === "codeium.windsurf-remote-openssh") {
				const attemptsKey = `${namespace}.maxReconnectionAttempts`;
				config.setDefault(attemptsKey, null);
				const { [attemptsKey]: _attempts, ...withDefault } = automatic;
				expect(tuning(config, id)).toEqual(withDefault);
			}
			for (const [key, value] of Object.entries(automatic)) {
				expect(recommended[key]?.value).toBe(value === 28800 ? 86400 : value);
				config.set(key, value);
			}
			expect(tuning(config, id)).toEqual({});
		},
	);

	it.each([
		{
			label: "deprecated values",
			user: {
				"remote.windsurfSSH.connectTimeout": 3600,
				"remote.windsurfSSH.reconnectionGraceTime": 600,
				"remote.windsurfSSH.maxReconnectionAttempts": 4,
			},
			expected: {},
		},
		{
			label: "deprecated timeout below minimum",
			user: {
				"remote.windsurfSSH.connectTimeout": 60,
				"remote.windsurfSSH.reconnectionGraceTime": 0,
			},
			expected: { "remote.devinSSH.connectTimeout": 1800 },
		},
		{
			label: "Devin values take precedence",
			user: {
				"remote.devinSSH.connectTimeout": 60,
				"remote.windsurfSSH.connectTimeout": 3600,
				"remote.devinSSH.reconnectionGraceTime": 28800,
				"remote.windsurfSSH.reconnectionGraceTime": 600,
			},
			expected: { "remote.devinSSH.connectTimeout": 1800 },
		},
	])("respects Devin's fallback: $label", ({ user, expected }) => {
		const config = new MockConfigurationProvider();
		config.setDefault("remote.devinSSH.connectTimeout", 15);
		config.setDefault("remote.windsurfSSH.connectTimeout", 15);
		config.setDefault("remote.devinSSH.maxReconnectionAttempts", null);
		for (const [key, value] of Object.entries(user)) config.set(key, value);
		expect(tuning(config, "codeium.windsurf-remote-openssh")).toEqual(expected);
	});

	it.each([
		{
			id: "anysphere.remote-ssh",
			key: "remote.SSH.serverShutdownTimeout",
			value: 300,
		},
		{
			id: "ms-vscode-remote.remote-ssh",
			key: "remote.SSH.maxReconnectionAttempts",
			value: null,
		},
	] as const)(
		"preserves explicit $key, including defaults and null",
		({ id, key, value }) => {
			const config = new MockConfigurationProvider();
			config.setDefault(key, value);
			config.set(key, value);
			expect(tuning(config, id)[key]).toBeUndefined();
		},
	);
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
