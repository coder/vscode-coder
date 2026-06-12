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
	type ExportRuntime,
} from "./pipeline";
import { promptForExport, type ExportChoice } from "./prompts";
import { createExportWriter } from "./writers";

import type { Logger } from "../../logging/logger";
import type { TelemetryContext } from "../event";
import type { FlushStatus } from "../service";

import type { ExportFormat } from "./writers/types";

const REVEAL_ACTION = "Reveal in File Explorer";

const PROGRESS_OPTIONS = {
	location: vscode.ProgressLocation.Notification,
	title: "Exporting Coder telemetry",
	cancellable: true,
} as const;

type ExportWarning = Parameters<ExportRuntime["onWarning"]>[0];

/**
 * Outcome hooks for the caller's telemetry span. `DiagnosticTrace` satisfies
 * this shape, so command callers can pass their trace directly.
 */
export interface ExportTelemetryObserver {
	abort(stage: "prompt" | "progress"): void;
	error(): void;
	succeedExport(format: ExportFormat, eventCount: number): void;
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
		onWarning: (warning) => logExportWarning(logger, warning),
	};
}

function logExportWarning(logger: Logger, warning: ExportWarning): void {
	switch (warning.code) {
		case "invalidTelemetryFilePath":
			logger.warn(
				"Skipping invalid telemetry file during export",
				warning.filePath,
				warning.error,
			);
			return;
	}
}

/** Turns the export result into the matching user-facing notification. */
async function reportOutcome(
	result: ProgressResult<number>,
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

	const eventCount = result.value;
	observer.succeedExport(choice.format, eventCount);
	if (eventCount === 0) {
		void vscode.window.showInformationMessage(
			`No telemetry events found for ${choice.range.label}.`,
		);
		return;
	}
	await notifyExportSucceeded(choice.outputPath, eventCount, logger);
}

async function notifyExportSucceeded(
	outputPath: string,
	eventCount: number,
	logger: Logger,
): Promise<void> {
	const action = await vscode.window.showInformationMessage(
		`Exported ${formatEventCount(eventCount)} to ${outputPath}.`,
		REVEAL_ACTION,
	);
	if (action !== REVEAL_ACTION) {
		return;
	}
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
