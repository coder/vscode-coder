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

export type ExportTelemetryOutcome =
	| { readonly status: "cancelled"; readonly stage: "prompt" | "progress" }
	| { readonly status: "failed"; readonly error: unknown }
	| {
			readonly status: "success";
			readonly eventCount: number;
			readonly format: ExportFormat;
	  };

export async function runExportTelemetryCommand(
	telemetryDir: string,
	logger: Logger,
	flushTelemetry: () => Promise<FlushStatus>,
	context: TelemetryContext,
): Promise<ExportTelemetryOutcome> {
	const choice = await promptForExport();
	if (!choice) {
		return { status: "cancelled", stage: "prompt" };
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

	return reportOutcome(result, choice, logger);
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
	};
}

/** Turns the export result into the matching user-facing notification. */
async function reportOutcome(
	result: ProgressResult<number>,
	choice: ExportChoice,
	logger: Logger,
): Promise<ExportTelemetryOutcome> {
	if (!result.ok) {
		if (result.cancelled) {
			return { status: "cancelled", stage: "progress" };
		}
		logger.error("Telemetry export failed", result.error);
		void vscode.window.showErrorMessage(
			`Telemetry export failed: ${toError(result.error).message}`,
		);
		return { status: "failed", error: result.error };
	}

	const eventCount = result.value;
	if (eventCount === 0) {
		void vscode.window.showInformationMessage(
			`No telemetry events found for ${choice.range.label}.`,
		);
		return { status: "success", eventCount, format: choice.format };
	}
	await notifyExportSucceeded(choice.outputPath, eventCount, logger);
	return { status: "success", eventCount, format: choice.format };
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
