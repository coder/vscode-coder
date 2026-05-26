import * as fsp from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { runExportTelemetryCommand } from "@/telemetry/export/command";
import * as files from "@/telemetry/export/files";
import * as jsonWriter from "@/telemetry/export/writers/json";
import * as otlpWriter from "@/telemetry/export/writers/otlp/writer";

import { asyncIterable } from "../../../mocks/asyncIterable";
import { createTelemetryEventFactory } from "../../../mocks/telemetry";
import { createMockLogger } from "../../../mocks/testHelpers";

import type { Logger } from "@/logging/logger";
import type { TelemetryEvent } from "@/telemetry/event";

vi.mock("@/telemetry/export/files", () => ({
	listTelemetryFilesForRange: vi.fn(),
	streamTelemetryEvents: vi.fn(),
}));

vi.mock("@/telemetry/export/writers/json", () => ({
	writeJsonArrayExport: vi.fn(),
}));

vi.mock("@/telemetry/export/writers/otlp/writer", () => ({
	writeOtlpZipExport: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	rm: vi.fn(() => Promise.resolve()),
}));

const TELEMETRY_DIR = "/tmp/telemetry";
const OUTPUT_PATH = "/tmp/coder-telemetry.json";
const OUTPUT_URI = vscode.Uri.file(OUTPUT_PATH);
const OTLP_OUTPUT_URI = vscode.Uri.file("/tmp/coder-telemetry.otlp.zip");
const TELEMETRY_FILE_PATH = "/tmp/telemetry/file.jsonl";
const CUSTOM_RANGE_PICK = { id: "custom", label: "Custom range…" };

const makeEvent = createTelemetryEventFactory();
const { context } = makeEvent();

interface ResolvedPrompts {
	rangePick: { id: string; label: string } | undefined;
	customStart: string | undefined;
	customEnd: string | undefined;
	formatPick: { id: "json" | "otlp"; label: string } | undefined;
	saveDialog: vscode.Uri | undefined;
	infoResponse: string | undefined;
}
type PromptResponses = Partial<ResolvedPrompts>;

const DEFAULT_PROMPT_RESPONSES: ResolvedPrompts = {
	rangePick: { id: "last24Hours", label: "Last 24 hours" },
	customStart: undefined,
	customEnd: undefined,
	formatPick: { id: "json", label: "JSON array" },
	saveDialog: OUTPUT_URI,
	infoResponse: undefined,
};

function mockProgress(opts: { cancelImmediately?: boolean } = {}): void {
	vi.mocked(vscode.window.withProgress).mockImplementation(
		async (_opts, task) => {
			const progress = { report: vi.fn() };
			const token: vscode.CancellationToken = {
				isCancellationRequested: opts.cancelImmediately ?? false,
				onCancellationRequested: vi.fn((listener: (e: unknown) => void) => {
					if (opts.cancelImmediately) listener(undefined);
					return { dispose: vi.fn() };
				}),
			};
			return task(progress, token);
		},
	);
}

function mockPrompts(responses: PromptResponses = {}): void {
	// Resets every prompt mock so an in-test override fully replaces what
	// beforeEach queued.
	const merged = { ...DEFAULT_PROMPT_RESPONSES, ...responses };

	vi.mocked(vscode.window.showQuickPick)
		.mockReset()
		.mockResolvedValueOnce(merged.rangePick)
		.mockResolvedValueOnce(merged.formatPick);

	const inputBox = vi.mocked(vscode.window.showInputBox).mockReset();
	if (merged.customStart !== undefined) {
		inputBox.mockResolvedValueOnce(merged.customStart);
	}
	if (merged.customEnd !== undefined) {
		inputBox.mockResolvedValueOnce(merged.customEnd);
	}

	vi.mocked(vscode.window.showSaveDialog)
		.mockReset()
		.mockResolvedValue(merged.saveDialog);
	vi.mocked(vscode.window.showInformationMessage)
		.mockReset()
		.mockResolvedValue(merged.infoResponse as never);
	vi.mocked(vscode.window.showErrorMessage)
		.mockReset()
		.mockResolvedValue(undefined);
	vi.mocked(vscode.commands.executeCommand)
		.mockReset()
		.mockResolvedValue(undefined);
}

function mockSourceFiles(
	events: readonly TelemetryEvent[] = [makeEvent()],
	filePaths: readonly string[] = [TELEMETRY_FILE_PATH],
): void {
	vi.mocked(files.listTelemetryFilesForRange).mockResolvedValue([...filePaths]);
	vi.mocked(files.streamTelemetryEvents).mockReturnValue(asyncIterable(events));
}

function mockJsonWriter(eventCount: number): void {
	vi.mocked(jsonWriter.writeJsonArrayExport).mockResolvedValue(eventCount);
}

function mockOtlpWriter(counts: {
	logs: number;
	traces: number;
	metrics: number;
}): void {
	vi.mocked(otlpWriter.writeOtlpZipExport).mockResolvedValue(counts);
}

describe("runExportTelemetryCommand", () => {
	let logger: Logger;
	let flushTelemetry: ReturnType<typeof vi.fn<() => Promise<void>>>;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsp.rm).mockResolvedValue(undefined);
		logger = createMockLogger();
		flushTelemetry = vi.fn<() => Promise<void>>(() => Promise.resolve());
		mockProgress();
		mockPrompts();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function run(): Promise<void> {
		await runExportTelemetryCommand(
			TELEMETRY_DIR,
			logger,
			flushTelemetry,
			context,
		);
	}

	describe("cancellation", () => {
		it.each<{ scenario: string; overrides: PromptResponses }>([
			{ scenario: "date-range pick", overrides: { rangePick: undefined } },
			{ scenario: "format pick", overrides: { formatPick: undefined } },
			{ scenario: "save dialog", overrides: { saveDialog: undefined } },
		])(
			"returns silently when the $scenario is cancelled",
			async ({ overrides }) => {
				mockPrompts(overrides);

				await run();

				expect(flushTelemetry).not.toHaveBeenCalled();
				expect(vscode.window.withProgress).not.toHaveBeenCalled();
				expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
				expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			},
		);

		it("returns silently when cancellation fires during the export", async () => {
			mockProgress({ cancelImmediately: true });

			await run();

			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});
	});

	describe("flush and listing", () => {
		it("flushes before listing telemetry files", async () => {
			vi.mocked(files.listTelemetryFilesForRange).mockResolvedValue([]);

			await run();

			const [flushOrder] = flushTelemetry.mock.invocationCallOrder;
			const [listOrder] = vi.mocked(files.listTelemetryFilesForRange).mock
				.invocationCallOrder;
			expect(flushOrder).toBeLessThan(listOrder);
		});
	});

	describe("empty handling", () => {
		it("shows 'no files' notification when listing returns []", async () => {
			vi.mocked(files.listTelemetryFilesForRange).mockResolvedValue([]);

			await run();

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("No telemetry files found"),
			);
			expect(jsonWriter.writeJsonArrayExport).not.toHaveBeenCalled();
			expect(otlpWriter.writeOtlpZipExport).not.toHaveBeenCalled();
			expect(fsp.rm).not.toHaveBeenCalled();
		});

		it("removes the empty file and notifies when no events match", async () => {
			mockSourceFiles([]);
			mockJsonWriter(0);

			await run();

			expect(fsp.rm).toHaveBeenCalledWith(OUTPUT_PATH, { force: true });
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("No telemetry events matched"),
			);
		});

		it("warns but proceeds when removing the empty file fails", async () => {
			mockSourceFiles([]);
			mockJsonWriter(0);
			vi.mocked(fsp.rm).mockRejectedValue(new Error("EACCES"));

			await run();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to remove empty"),
				OUTPUT_PATH,
				expect.any(Error),
			);
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("No telemetry events matched"),
			);
		});
	});

	describe("JSON export", () => {
		beforeEach(() => {
			mockSourceFiles([makeEvent(), makeEvent()]);
			mockJsonWriter(2);
		});

		it("shows success notification with the event count and the path", async () => {
			await run();

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				`Exported 2 telemetry event(s) to ${OUTPUT_PATH}.`,
				"Reveal in File Explorer",
			);
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(fsp.rm).not.toHaveBeenCalled();
		});

		it("invokes revealFileInOS when the user clicks the action", async () => {
			mockPrompts({ infoResponse: "Reveal in File Explorer" });

			await run();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"revealFileInOS",
				OUTPUT_URI,
			);
		});

		it("does NOT invoke revealFileInOS when the user dismisses the toast", async () => {
			// Default infoResponse is undefined, so no reveal expected.
			await run();

			expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		});

		it("logs and swallows a reveal failure without reporting export failure", async () => {
			mockPrompts({ infoResponse: "Reveal in File Explorer" });
			vi.mocked(vscode.commands.executeCommand).mockRejectedValue(
				new Error("revealFileInOS not found"),
			);

			await run();

			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to reveal"),
				expect.any(Error),
			);
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});
	});

	describe("OTLP export", () => {
		beforeEach(() => {
			mockPrompts({
				formatPick: { id: "otlp", label: "OTLP/JSON zip" },
				saveDialog: OTLP_OUTPUT_URI,
			});
			mockSourceFiles([makeEvent()]);
			mockOtlpWriter({ logs: 5, traces: 3, metrics: 1 });
		});

		it("sums logs/traces/metrics counts for the success notification", async () => {
			await run();

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("Exported 9 telemetry event(s)"),
				"Reveal in File Explorer",
			);
		});

		it("threads the AbortSignal and cleanup callbacks to the OTLP writer", async () => {
			await run();

			expect(otlpWriter.writeOtlpZipExport).toHaveBeenCalledWith(
				OTLP_OUTPUT_URI.fsPath,
				expect.anything(),
				context,
				expect.objectContaining({
					signal: expect.any(AbortSignal),
					onTempCleanupError: expect.any(Function),
					onStagingCleanupError: expect.any(Function),
				}),
			);
		});
	});

	describe("writer failure", () => {
		it("shows an error notification without re-throwing", async () => {
			mockSourceFiles([makeEvent()]);
			vi.mocked(jsonWriter.writeJsonArrayExport).mockRejectedValue(
				new Error("disk full"),
			);

			await expect(run()).resolves.toBeUndefined();

			expect(logger.error).toHaveBeenCalledWith(
				"Telemetry export failed",
				expect.any(Error),
			);
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Telemetry export failed"),
			);
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});
	});

	describe("custom date range", () => {
		it("threads start and end dates through createCustomDateRange", async () => {
			mockPrompts({
				rangePick: CUSTOM_RANGE_PICK,
				customStart: "2026-01-01",
				customEnd: "2026-01-31",
			});
			vi.mocked(files.listTelemetryFilesForRange).mockResolvedValue([]);

			await run();

			expect(files.listTelemetryFilesForRange).toHaveBeenCalledWith(
				TELEMETRY_DIR,
				expect.objectContaining({
					filenamePart: "2026-01-01_to_2026-01-31",
				}),
			);
		});

		it.each<{ scenario: string; overrides: PromptResponses }>([
			{
				scenario: "start date",
				overrides: {
					rangePick: CUSTOM_RANGE_PICK,
					customStart: undefined,
				},
			},
			{
				scenario: "end date",
				overrides: {
					rangePick: CUSTOM_RANGE_PICK,
					customStart: "2026-01-01",
					customEnd: undefined,
				},
			},
		])(
			"aborts when the custom $scenario is cancelled",
			async ({ overrides }) => {
				mockPrompts(overrides);

				await run();

				expect(files.listTelemetryFilesForRange).not.toHaveBeenCalled();
			},
		);
	});

	describe("prompt UX", () => {
		it("sets ignoreFocusOut on every prompt so focus loss does not silently abort", async () => {
			mockPrompts({
				rangePick: CUSTOM_RANGE_PICK,
				customStart: "2026-01-01",
				customEnd: "2026-01-31",
			});
			vi.mocked(files.listTelemetryFilesForRange).mockResolvedValue([]);

			await run();

			for (const [, opts] of vi.mocked(vscode.window.showQuickPick).mock
				.calls) {
				expect(opts).toMatchObject({ ignoreFocusOut: true });
			}
			for (const [opts] of vi.mocked(vscode.window.showInputBox).mock.calls) {
				expect(opts).toMatchObject({ ignoreFocusOut: true });
			}
		});
	});
});
