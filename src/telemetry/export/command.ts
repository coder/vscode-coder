import * as vscode from "vscode";

import { toError } from "../../error/errorUtils";
import {
	withCancellableProgress,
	type ProgressContext,
	type ProgressResult,
} from "../../progress";

import {
	collectTelemetryExport,
	type ExportRequest,
	type ExportResult,
	type ExportRuntime,
} from "./pipeline";
import { promptForExport, type ExportChoice } from "./prompts";
import { createExportWriter } from "./writers";

import type { Logger } from "../../logging/logger";
import type { TelemetryContext } from "../event";
import type { FlushStatus } from "../service";

import type { ExportFormat } from "./writers/types";

const PROGRESS_OPTIONS = {
	location: vscode.ProgressLocation.Notification,
	title: "Exporting Coder telemetry",
	cancellable: true,
} as const;

/**
 * Outcome hooks for the caller's telemetry span. `DiagnosticTrace` satisfies
 * this shape, so command callers can pass their trace directly.
 */
export interface ExportTelemetryObserver {
	abort(stage: "prompt" | "progress"): void;
	error(): void;
	succeedExport(format: ExportFormat, result: ExportResult): void;
}

export async function runExportTelemetryCommand(
	telemetryDir: string,
	logger: Logger,
	flushTelemetry: () => Promise<FlushStatus>,
	context: TelemetryContext,
	observer: ExportTelemetryObserver,
): Promise<void> {
	const choice = await promptForExport();
	if (!choice) {
		observer.abort("prompt");
		return;
	}

	const request: ExportRequest = {
		telemetryDir,
		range: choice.range,
		outputPath: choice.outputPath,
		writer: createExportWriter(choice.format, context),
	};
	const result = await withCancellableProgress(
		(ctx) =>
			collectTelemetryExport(
				request,
				exportRuntime(ctx, flushTelemetry, logger),
			),
		PROGRESS_OPTIONS,
	);

	await reportOutcome(result, choice, logger, observer);
}

/** Wires the pipeline's host hooks to the progress UI and the logger. */
function exportRuntime(
	{ progress, signal }: ProgressContext,
	flushTelemetry: () => Promise<FlushStatus>,
	logger: Logger,
): ExportRuntime {
	return {
		signal,
		flushTelemetry,
		report: (message) => progress.report({ message }),
		// Warn but keep going: the export still reflects what reached disk.
		onFlushIncomplete: () =>
			void vscode.window.showWarningMessage(
				"Some recent telemetry could not be flushed; this export may be missing the latest events.",
			),
		onCleanupError: (err, target) =>
			logger.warn("Failed to clean up after telemetry export", target, err),
		// The skipped file's name and line are in the error message.
		onFileSkipped: (err) =>
			logger.warn("Telemetry export skipped an unreadable file", err),
	};
}

/** Turns the export result into the matching user-facing notification. */
async function reportOutcome(
	result: ProgressResult<ExportResult>,
	choice: ExportChoice,
	logger: Logger,
	observer: ExportTelemetryObserver,
): Promise<void> {
	if (!result.ok) {
		if (result.cancelled) {
			observer.abort("progress");
			return;
		}
		observer.error();
		logger.error("Telemetry export failed", result.error);
		void vscode.window.showErrorMessage(
			`Telemetry export failed: ${toError(result.error).message}`,
		);
		return;
	}

	const { eventCount, skippedFileCount } = result.value;
	observer.succeedExport(choice.format, result.value);
	if (eventCount === 0) {
		void showExportMessage(
			`No telemetry events found for ${choice.range.label}.`,
			skippedFileCount,
			logger,
		);
		return;
	}
	const action = await showExportMessage(
		`Exported ${formatEventCount(eventCount)} to ${choice.outputPath}.`,
		skippedFileCount,
		logger,
		"Reveal in File Explorer",
	);
	if (action === "Reveal in File Explorer") {
		await revealExportedFile(choice.outputPath, logger);
	}
}

type ExportAction = "Reveal in File Explorer";

/**
 * A partial export warns and names the unreadable-file count. "Show Output"
 * is offered on warnings and handled here; only caller actions are returned.
 */
async function showExportMessage(
	message: string,
	skippedFileCount: number,
	logger: Logger,
	...actions: ExportAction[]
): Promise<ExportAction | undefined> {
	if (skippedFileCount === 0) {
		return vscode.window.showInformationMessage(message, ...actions);
	}
	const files = skippedFileCount === 1 ? "file" : "files";
	const action = await vscode.window.showWarningMessage(
		`${message} ${skippedFileCount} ${files} could not be read. Check the Coder output for details.`,
		...actions,
		"Show Output",
	);
	if (action === "Show Output") {
		logger.show();
		return undefined;
	}
	return action;
}

async function revealExportedFile(
	outputPath: string,
	logger: Logger,
): Promise<void> {
	try {
		await vscode.commands.executeCommand(
			"revealFileInOS",
			vscode.Uri.file(outputPath),
		);
	} catch (err) {
		logger.warn("Failed to reveal exported telemetry file", err);
	}
}

function formatEventCount(count: number): string {
	return `${count} telemetry ${count === 1 ? "event" : "events"}`;
}
