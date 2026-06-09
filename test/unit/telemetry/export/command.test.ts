import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import {
	runExportTelemetryCommand,
	type ExportTelemetryObserver,
} from "@/telemetry/export/command";
import { collectTelemetryExport } from "@/telemetry/export/pipeline";
import { promptForExport, type ExportChoice } from "@/telemetry/export/prompts";

import { createTelemetryEventFactory } from "../../../mocks/telemetry";
import {
	createMockLogger,
	MockProgressReporter,
} from "../../../mocks/testHelpers";

import type { FlushStatus } from "@/telemetry/service";

// command.ts orchestrates prompts and the pipeline; both are covered in their
// own files and mocked here so these tests focus on command.ts: given a choice
// and a result count, the right notification fires.
vi.mock("@/telemetry/export/prompts", () => ({ promptForExport: vi.fn() }));
vi.mock("@/telemetry/export/pipeline", () => ({
	collectTelemetryExport: vi.fn(),
}));

const TELEMETRY_DIR = "/tmp/telemetry";
const OUTPUT_PATH = "/home/user/coder-telemetry.json";
const REVEAL_ACTION = "Reveal in File Explorer";
const { context } = createTelemetryEventFactory()();

const CHOICE: ExportChoice = {
	range: { label: "Last 24 hours", filenamePart: "last-24-hours" },
	format: "json",
	outputPath: OUTPUT_PATH,
};

const OK_FLUSH: FlushStatus = { ok: true, sinks: [] };

function setup(
	opts: {
		choice?: ExportChoice;
		outcome?: { count: number } | { error: unknown };
		revealChoice?: string;
	} = {},
) {
	vi.resetAllMocks();
	new MockProgressReporter();

	vi.mocked(promptForExport).mockResolvedValue(opts.choice ?? CHOICE);
	vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
		opts.revealChoice as never,
	);

	const outcome = opts.outcome ?? { count: 2 };
	if ("error" in outcome) {
		vi.mocked(collectTelemetryExport).mockRejectedValue(outcome.error);
	} else {
		vi.mocked(collectTelemetryExport).mockResolvedValue(outcome.count);
	}

	const observer: ExportTelemetryObserver = {
		cancelled: vi.fn(),
		failed: vi.fn(),
		succeeded: vi.fn(),
	};

	return {
		observer,
		run: () =>
			runExportTelemetryCommand(
				TELEMETRY_DIR,
				createMockLogger(),
				vi.fn(() => Promise.resolve(OK_FLUSH)),
				context,
				observer,
			),
	};
}

describe("runExportTelemetryCommand", () => {
	it("does nothing when the user cancels the prompts", async () => {
		const { observer, run } = setup();
		vi.mocked(promptForExport).mockResolvedValue(undefined);

		await run();

		expect(observer.cancelled).toHaveBeenCalledWith("prompt");

		expect(collectTelemetryExport).not.toHaveBeenCalled();
		expect(vscode.window.withProgress).not.toHaveBeenCalled();
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
	});

	it("runs the export over the chosen range and destination with a writer", async () => {
		const { run } = setup();

		await run();

		expect(collectTelemetryExport).toHaveBeenCalledWith(
			{
				telemetryDir: TELEMETRY_DIR,
				range: CHOICE.range,
				outputPath: OUTPUT_PATH,
				writer: expect.any(Function),
			},
			expect.anything(),
		);
	});

	it("wires a warning into the runtime for an incomplete flush", async () => {
		const { run } = setup();
		let onFlushIncomplete: (() => void) | undefined;
		vi.mocked(collectTelemetryExport).mockImplementation(
			(_request, runtime) => {
				onFlushIncomplete = runtime.onFlushIncomplete;
				return Promise.resolve(2);
			},
		);

		await run();
		onFlushIncomplete?.();

		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("could not be flushed"),
		);
	});

	describe("successful export", () => {
		it.each([
			[1, "Exported 1 telemetry event to"],
			[3, "Exported 3 telemetry events to"],
		])("notifies with a pluralized %i-event count", async (count, message) => {
			const { observer, run } = setup({ outcome: { count } });

			await run();

			expect(observer.succeeded).toHaveBeenCalledWith("json", count);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				`${message} ${OUTPUT_PATH}.`,
				REVEAL_ACTION,
			);
		});

		it("reveals the file when the user clicks the action", async () => {
			const { run } = setup({ revealChoice: REVEAL_ACTION });

			await run();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"revealFileInOS",
				vscode.Uri.file(OUTPUT_PATH),
			);
		});

		it("does not reveal when the notification is dismissed", async () => {
			const { run } = setup();

			await run();

			expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		});

		it("does not surface an error when revealing fails", async () => {
			const { run } = setup({ revealChoice: REVEAL_ACTION });
			vi.mocked(vscode.commands.executeCommand).mockRejectedValue(
				new Error("no command"),
			);

			await run();

			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		});
	});

	describe("nothing to export", () => {
		it("reports that no events were found", async () => {
			const { observer, run } = setup({ outcome: { count: 0 } });

			await run();

			expect(observer.succeeded).toHaveBeenCalledWith("json", 0);

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				"No telemetry events found for Last 24 hours.",
			);
		});
	});

	describe("failure", () => {
		it("shows an error notification without throwing", async () => {
			const error = new Error("disk full");
			const { observer, run } = setup({ outcome: { error } });

			await run();

			expect(observer.failed).toHaveBeenCalledOnce();

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Telemetry export failed: disk full",
			);
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});

		it("stays silent when the export is cancelled mid-run", async () => {
			const aborted = Object.assign(new Error("Aborted"), {
				name: "AbortError",
			});
			const { observer, run } = setup({ outcome: { error: aborted } });

			await run();

			expect(observer.cancelled).toHaveBeenCalledWith("progress");

			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
		});
	});
});
