import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { promptForExport } from "@/telemetry/export/prompts";

const OUTPUT_PATH = "/home/user/coder-telemetry.json";
const SAVE_URI = vscode.Uri.file(OUTPUT_PATH);
const RANGE_PICK = { id: "last24Hours", label: "Last 24 hours" };
const CUSTOM_PICK = { id: "custom", label: "Custom range…" };
const JSON_PICK = { id: "json", label: "JSON array" };
const OTLP_PICK = { id: "otlp", label: "OTLP/JSON zip" };

interface Answers {
	range: unknown;
	format: unknown;
	customStart?: string;
	customEnd?: string;
	savePath?: vscode.Uri;
}

const DEFAULT_ANSWERS: Answers = {
	range: RANGE_PICK,
	format: JSON_PICK,
	savePath: SAVE_URI,
};

function answer(overrides: Partial<Answers> = {}): void {
	vi.resetAllMocks();
	const a = { ...DEFAULT_ANSWERS, ...overrides };

	vi.mocked(vscode.window.showQuickPick)
		.mockResolvedValueOnce(a.range as never)
		.mockResolvedValueOnce(a.format as never);

	const inputBox = vi.mocked(vscode.window.showInputBox);
	for (const value of [a.customStart, a.customEnd]) {
		if (value !== undefined) {
			inputBox.mockResolvedValueOnce(value);
		}
	}

	vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(a.savePath);
}

describe("promptForExport", () => {
	it("returns the chosen preset range, format, and destination", async () => {
		answer();

		await expect(promptForExport()).resolves.toEqual({
			range: expect.objectContaining({ label: "Last 24 hours" }),
			format: "json",
			outputPath: OUTPUT_PATH,
		});
	});

	it("builds an inclusive custom range from the entered dates", async () => {
		answer({
			range: CUSTOM_PICK,
			customStart: "2026-01-01",
			customEnd: "2026-01-31",
		});

		const choice = await promptForExport();

		expect(choice?.range).toMatchObject({
			label: "2026-01-01 to 2026-01-31",
			filenamePart: "2026-01-01_to_2026-01-31",
		});
	});

	it.each([
		["range", { range: undefined }],
		["format", { format: undefined }],
		["destination", { savePath: undefined }],
		["custom start date", { range: CUSTOM_PICK, customStart: undefined }],
		[
			"custom end date",
			{ range: CUSTOM_PICK, customStart: "2026-01-01", customEnd: undefined },
		],
	])(
		"returns undefined when the %s prompt is dismissed",
		async (_label, overrides) => {
			answer(overrides);

			await expect(promptForExport()).resolves.toBeUndefined();
		},
	);

	it("sets ignoreFocusOut on every prompt", async () => {
		answer({
			range: CUSTOM_PICK,
			customStart: "2026-01-01",
			customEnd: "2026-01-31",
		});

		await promptForExport();

		for (const [, options] of vi.mocked(vscode.window.showQuickPick).mock
			.calls) {
			expect(options).toMatchObject({ ignoreFocusOut: true });
		}
		for (const [options] of vi.mocked(vscode.window.showInputBox).mock.calls) {
			expect(options).toMatchObject({ ignoreFocusOut: true });
		}
	});

	it("rejects an end date before the start date", async () => {
		answer({
			range: CUSTOM_PICK,
			customStart: "2026-01-10",
			customEnd: "2026-01-31",
		});

		await promptForExport();

		const endOptions = vi.mocked(vscode.window.showInputBox).mock.calls[1]?.[0];
		expect(endOptions?.validateInput?.("2026-01-05")).toBe(
			"End date must be on or after start date.",
		);
	});

	it("offers zip filters and an .otlp.zip default name for OTLP", async () => {
		answer({
			format: OTLP_PICK,
			savePath: vscode.Uri.file("/home/user/coder-telemetry.otlp.zip"),
		});

		await promptForExport();

		expect(vscode.window.showSaveDialog).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: { "Zip files": ["zip"] },
				defaultUri: expect.objectContaining({
					path: expect.stringContaining(".otlp.zip"),
				}),
			}),
		);
	});
});
