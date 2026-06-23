import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { collectSettingsFile } from "@/supportBundle/settings";

import { createMockLogger } from "../../mocks/testHelpers";

const logger = createMockLogger();

beforeEach(() => {
	vi.mocked(vscode.workspace.getConfiguration).mockReset();
	vi.mocked(logger.warn).mockClear();
});

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

describe("collectSettingsFile", () => {
	it("returns undefined when there are no supported settings", () => {
		setConfiguration({}, {});

		expect(collectSettingsFile(logger)).toBeUndefined();
	});

	it("redacts secret-bearing Coder settings while preserving the rest", () => {
		setConfiguration(
			{
				// Free-form values that can embed a token: redacted.
				"coder.headerCommand": "echo DO_NOT_LEAK_SECRET",
				"coder.globalFlags": ["--token", "DO_NOT_LEAK_SECRET"],
				"coder.tlsCertRefreshCommand": "",
				// Paths, hostnames, and flags are collected verbatim.
				"coder.tlsCertFile": "/etc/ssl/cert.pem",
				"coder.sshFlags": ["--disable-autostart"],
				"coder.defaultUrl": "https://coder.example.com",
				"coder.proxyLogDirectory": "/home/user/.coder/logs",
				"coder.insecure": true,
				"coder.httpClientLogLevel": "debug",
			},
			{
				"coder.headerCommand": {
					defaultValue: "",
					globalValue: "echo DO_NOT_LEAK_SECRET",
				},
				"coder.globalFlags": {
					defaultValue: [],
					globalValue: ["--token", "DO_NOT_LEAK_SECRET"],
				},
				"coder.tlsCertRefreshCommand": { defaultValue: "", globalValue: "" },
				"coder.tlsCertFile": {
					defaultValue: "",
					globalValue: "/etc/ssl/cert.pem",
				},
				"coder.sshFlags": {
					defaultValue: [],
					globalValue: ["--disable-autostart"],
				},
				"coder.defaultUrl": {
					defaultValue: "",
					globalValue: "https://coder.example.com",
				},
				"coder.proxyLogDirectory": {
					defaultValue: "",
					globalValue: "/home/user/.coder/logs",
				},
				"coder.insecure": { defaultValue: false, globalValue: true },
				"coder.httpClientLogLevel": {
					defaultValue: "info",
					globalValue: "debug",
				},
			},
		);

		const raw = Buffer.from(
			collectSettingsFile(logger) ?? new Uint8Array(),
		).toString();
		const settings = JSON.parse(raw) as Record<string, Record<string, unknown>>;

		expect(raw).not.toContain("DO_NOT_LEAK_SECRET");
		expect(settings["coder.headerCommand"]).toEqual({
			defaultValue: "",
			effective: "<set>",
			globalValue: "<set>",
			key: "coder.headerCommand",
		});
		expect(settings["coder.globalFlags"]?.effective).toBe("<set>");
		expect(settings["coder.tlsCertRefreshCommand"]?.effective).toBe("<empty>");
		// Paths, hostnames, flags, and non-secret values pass through verbatim.
		expect(settings["coder.tlsCertFile"]?.effective).toBe("/etc/ssl/cert.pem");
		expect(settings["coder.sshFlags"]?.effective).toEqual([
			"--disable-autostart",
		]);
		expect(settings["coder.defaultUrl"]?.effective).toBe(
			"https://coder.example.com",
		);
		expect(settings["coder.proxyLogDirectory"]?.effective).toBe(
			"/home/user/.coder/logs",
		);
		expect(settings["coder.insecure"]?.effective).toBe(true);
		expect(settings["coder.httpClientLogLevel"]?.effective).toBe("debug");
	});

	it("collects allowlisted Remote-SSH settings", () => {
		setConfiguration(
			{
				"remote.SSH.connectTimeout": 1800,
				"remote.autoForwardPorts": true,
			},
			{
				"remote.SSH.connectTimeout": { defaultValue: 60, globalValue: 1800 },
				"remote.autoForwardPorts": {
					defaultValue: false,
					workspaceValue: true,
				},
			},
		);

		const settings = JSON.parse(
			Buffer.from(collectSettingsFile(logger) ?? new Uint8Array()).toString(),
		) as Record<string, Record<string, unknown>>;

		expect(settings["remote.SSH.connectTimeout"]?.globalValue).toBe(1800);
		expect(settings["remote.autoForwardPorts"]?.workspaceValue).toBe(true);
	});

	it("preserves languageIds metadata on redacted settings", () => {
		setConfiguration(
			{ "coder.headerCommand": "echo secret" },
			{
				"coder.headerCommand": {
					globalValue: "echo secret",
					languageIds: ["typescript"],
				},
			},
		);

		const settings = JSON.parse(
			Buffer.from(collectSettingsFile(logger) ?? new Uint8Array()).toString(),
		) as Record<string, Record<string, unknown>>;

		expect(settings["coder.headerCommand"]?.languageIds).toEqual([
			"typescript",
		]);
		expect(settings["coder.headerCommand"]?.globalValue).toBe("<set>");
	});

	it("warns and returns undefined when settings collection fails", () => {
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(() => {
			throw new Error("settings failed");
		});

		expect(collectSettingsFile(logger)).toBeUndefined();
		expect(logger.warn).toHaveBeenCalledWith(
			"Could not collect VS Code settings",
			expect.any(Error),
		);
	});
});
