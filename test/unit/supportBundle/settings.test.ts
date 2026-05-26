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

	it("redacts sensitive Coder settings while preserving safe ones", () => {
		setConfiguration(
			{
				"coder.headerCommand": "echo DO_NOT_LEAK_SECRET",
				"coder.sshFlags": ["--flag", "DO_NOT_LEAK_SECRET"],
				"coder.tlsCertFile": "/etc/ssl/DO_NOT_LEAK_SECRET.pem",
				"coder.defaultUrl": "https://internal.DO_NOT_LEAK_SECRET",
				"coder.insecure": true,
				"coder.httpClientLogLevel": "debug",
				"coder.binarySource": "",
			},
			{
				"coder.headerCommand": {
					defaultValue: "",
					globalValue: "echo DO_NOT_LEAK_SECRET",
				},
				"coder.sshFlags": {
					defaultValue: [],
					globalValue: ["--flag", "DO_NOT_LEAK_SECRET"],
				},
				"coder.tlsCertFile": {
					defaultValue: "",
					globalValue: "/etc/ssl/DO_NOT_LEAK_SECRET.pem",
				},
				"coder.defaultUrl": {
					defaultValue: "",
					globalValue: "https://internal.DO_NOT_LEAK_SECRET",
				},
				"coder.insecure": { defaultValue: false, globalValue: true },
				"coder.httpClientLogLevel": {
					defaultValue: "info",
					globalValue: "debug",
				},
				"coder.binarySource": { defaultValue: "", globalValue: "" },
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
		expect(settings["coder.sshFlags"]?.effective).toBe("<set>");
		expect(settings["coder.tlsCertFile"]?.effective).toBe("<set>");
		expect(settings["coder.defaultUrl"]?.effective).toBe("<set>");
		expect(settings["coder.binarySource"]?.effective).toBe("<empty>");
		// Non-sensitive settings pass through verbatim.
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
