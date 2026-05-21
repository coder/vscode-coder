import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectVsCodeDiagnostics } from "@/supportBundle/diagnostics";
import { collectSupportLogFiles } from "@/supportBundle/logFiles";
import { collectSettingsFile } from "@/supportBundle/settings";

import { createMockLogger } from "../../mocks/testHelpers";

const collectSupportLogFilesMock = vi.hoisted(() => vi.fn());
const collectSettingsFileMock = vi.hoisted(() => vi.fn());

vi.mock("@/supportBundle/logFiles", () => ({
	collectSupportLogFiles: collectSupportLogFilesMock,
}));

vi.mock("@/supportBundle/settings", () => ({
	collectSettingsFile: collectSettingsFileMock,
}));

const logger = createMockLogger();

beforeEach(() => {
	vi.mocked(collectSupportLogFiles).mockReset();
	vi.mocked(collectSettingsFile).mockReset();
});

describe("collectVsCodeDiagnostics", () => {
	it("combines log files and settings", async () => {
		vi.mocked(collectSupportLogFiles).mockResolvedValue(
			new Map([["vscode-logs/proxy/active.log", Buffer.from("proxy")]]),
		);
		vi.mocked(collectSettingsFile).mockReturnValue(Buffer.from("settings"));

		await expect(collectVsCodeDiagnostics({}, logger)).resolves.toEqual(
			new Map([
				["vscode-logs/proxy/active.log", Buffer.from("proxy")],
				["vscode-logs/settings.json", Buffer.from("settings")],
			]),
		);
	});

	it("does not add settings when none are collected", async () => {
		vi.mocked(collectSupportLogFiles).mockResolvedValue(new Map());
		vi.mocked(collectSettingsFile).mockReturnValue(undefined);

		await expect(collectVsCodeDiagnostics({}, logger)).resolves.toEqual(
			new Map(),
		);
	});
});
