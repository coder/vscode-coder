import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { collectSettingsFile } from "@/supportBundle/settings";

import { createMockLogger } from "../../mocks/testHelpers";

const logger = createMockLogger();

beforeEach(() => {
	setExtensions([]);
	vi.mocked(vscode.workspace.getConfiguration).mockReset();
	vi.mocked(logger.warn).mockClear();
});

function setExtensions(
	extensions: Array<{ id: string; packageJSON: unknown }>,
): void {
	Object.defineProperty(vscode.extensions, "all", {
		configurable: true,
		value: extensions,
	});
}

function setConfiguration(
	values: Record<string, unknown>,
	inspections: Record<string, Record<string, unknown>>,
): void {
	const config: Partial<vscode.WorkspaceConfiguration> = {
		get: <T>(key: string): T | undefined => values[key] as T | undefined,
		inspect: (key: string) => {
			const inspection = inspections[key];
			return inspection ? { key, ...inspection } : undefined;
		},
	};
	vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
		config as vscode.WorkspaceConfiguration,
	);
}

function readSettings(): Record<string, Record<string, unknown>> {
	const data = collectSettingsFile(logger);
	if (!data) {
		throw new Error("settings were not collected");
	}
	return JSON.parse(Buffer.from(data).toString()) as Record<
		string,
		Record<string, unknown>
	>;
}

describe("collectSettingsFile", () => {
	it("returns undefined when there are no supported settings", () => {
		setConfiguration({}, {});

		expect(collectSettingsFile(logger)).toBeUndefined();
	});

	it("collects Coder settings and allowlisted Remote-SSH settings only", () => {
		setExtensions([
			{
				id: "coder.coder-remote",
				packageJSON: {
					name: "coder-remote",
					publisher: "coder",
					contributes: {
						configuration: {
							properties: {
								"coder.binarySource": {},
								"coder.globalFlags": {},
								"coder.headerCommand": {},
								"coder.proxyLogDirectory": {},
								"coder.sshConfig": {},
								"coder.sshFlags": {},
								"coder.tlsCertRefreshCommand": {},
								"unrelated.setting": {},
							},
						},
					},
				},
			},
			{
				id: "ms-vscode-remote.remote-ssh",
				packageJSON: {
					contributes: {
						configuration: {
							properties: {
								"remote.SSH.connectTimeout": {},
								"remote.SSH.remotePlatform": {},
								"remote.autoForwardPorts": {},
							},
						},
					},
				},
			},
			{
				id: "other.remote-extension",
				packageJSON: {
					contributes: {
						configuration: {
							properties: { "remote.someToken": {} },
						},
					},
				},
			},
		]);
		setConfiguration(
			{
				"coder.binarySource": "",
				"coder.globalFlags": ["--header-command", "DO_NOT_LEAK_SECRET"],
				"coder.headerCommand": "echo DO_NOT_LEAK_SECRET",
				"coder.proxyLogDirectory": "/tmp/proxy",
				"coder.sshConfig": ["SetEnv TOKEN=DO_NOT_LEAK_SECRET"],
				"coder.sshFlags": ["--flag", "DO_NOT_LEAK_SECRET"],
				"coder.tlsCertRefreshCommand": "refresh DO_NOT_LEAK_SECRET",
				"remote.SSH.connectTimeout": 1800,
				"remote.SSH.remotePlatform": { workspace: "linux" },
				"remote.autoForwardPorts": true,
			},
			{
				"coder.binarySource": { defaultValue: "", globalValue: "" },
				"coder.globalFlags": {
					defaultValue: [],
					globalValue: ["--header-command", "DO_NOT_LEAK_SECRET"],
				},
				"coder.headerCommand": {
					defaultValue: "",
					globalValue: "echo DO_NOT_LEAK_SECRET",
				},
				"coder.proxyLogDirectory": {
					defaultValue: "",
					globalValue: "/tmp/proxy",
				},
				"coder.sshConfig": {
					defaultValue: [],
					globalValue: ["SetEnv TOKEN=DO_NOT_LEAK_SECRET"],
				},
				"coder.sshFlags": {
					defaultValue: [],
					globalValue: ["--flag", "DO_NOT_LEAK_SECRET"],
				},
				"coder.tlsCertRefreshCommand": {
					defaultValue: "",
					globalValue: "refresh DO_NOT_LEAK_SECRET",
				},
				"remote.SSH.connectTimeout": {
					defaultValue: 60,
					globalValue: 1800,
				},
				"remote.SSH.remotePlatform": {
					globalValue: { workspace: "linux" },
				},
				"remote.autoForwardPorts": {
					defaultValue: false,
					workspaceValue: true,
				},
			},
		);

		const raw = Buffer.from(
			collectSettingsFile(logger) ?? new Uint8Array(),
		).toString();
		const settings = JSON.parse(raw) as Record<string, Record<string, unknown>>;

		expect(raw).not.toContain("DO_NOT_LEAK_SECRET");
		expect(Object.keys(settings).sort()).toEqual([
			"coder.binarySource",
			"coder.globalFlags",
			"coder.headerCommand",
			"coder.proxyLogDirectory",
			"coder.sshConfig",
			"coder.sshFlags",
			"coder.tlsCertRefreshCommand",
			"remote.SSH.connectTimeout",
			"remote.autoForwardPorts",
		]);
		expect(settings["coder.binarySource"]).toEqual({
			defaultValue: "<empty>",
			effective: "<empty>",
			globalValue: "<empty>",
			key: "coder.binarySource",
		});
		expect(settings["coder.headerCommand"]?.effective).toBe("<set>");
		expect(settings["coder.globalFlags"]?.defaultValue).toBe("<empty>");
		expect(settings["coder.globalFlags"]?.effective).toBe("<set>");
		expect(settings["coder.sshConfig"]?.effective).toBe("<set>");
		expect(settings["coder.proxyLogDirectory"]?.effective).toBe("/tmp/proxy");
		expect(settings["remote.SSH.connectTimeout"]?.globalValue).toBe(1800);
		expect(settings["remote.autoForwardPorts"]?.workspaceValue).toBe(true);
	});

	it("warns and returns undefined when settings collection fails", () => {
		setExtensions([
			{
				id: "coder.coder-remote",
				packageJSON: {
					contributes: {
						configuration: {
							properties: { "coder.proxyLogDirectory": {} },
						},
					},
				},
			},
		]);
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(() => {
			throw new Error("settings failed");
		});

		expect(collectSettingsFile(logger)).toBeUndefined();
		expect(logger.warn).toHaveBeenCalledWith(
			"Could not collect VS Code settings",
			expect.any(Error),
		);
	});

	it("supports array-style configuration contributions", () => {
		setExtensions([
			{
				id: "coder.coder-remote",
				packageJSON: {
					contributes: {
						configuration: [{ properties: { "coder.proxyLogDirectory": {} } }],
					},
				},
			},
		]);
		setConfiguration(
			{ "coder.proxyLogDirectory": "/tmp/proxy" },
			{ "coder.proxyLogDirectory": { globalValue: "/tmp/proxy" } },
		);

		expect(readSettings()["coder.proxyLogDirectory"]?.effective).toBe(
			"/tmp/proxy",
		);
	});
});
