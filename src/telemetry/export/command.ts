import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { throwIfAborted, toError } from "../../error/errorUtils";
import { withCancellableProgress } from "../../progress";
import { toUtcDateString, validateUtcDateInput } from "../../util/date";

import { listTelemetryFilesForRange, streamTelemetryEvents } from "./files";
import {
	TELEMETRY_RANGE_PRESETS,
	createCustomDateRange,
	createPresetDateRange,
	type TelemetryDateRange,
	type TelemetryRangePresetId,
} from "./range";
import { writeJsonArrayExport } from "./writers/json";
import { writeOtlpZipExport } from "./writers/otlp/writer";

import type { Logger } from "../../logging/logger";
import type { TelemetryContext } from "../event";

interface FormatPick extends vscode.QuickPickItem {
	readonly id: "json" | "otlp";
}

interface RangePick extends vscode.QuickPickItem {
	readonly id: TelemetryRangePresetId | "custom";
}

interface FormatOutput {
	readonly ext: string;
	readonly filters: NonNullable<vscode.SaveDialogOptions["filters"]>;
}

interface ExportSummary {
	readonly filesScanned: number;
	readonly eventCount: number;
}

const FORMAT_PICKS: readonly FormatPick[] = [
	{
		id: "json",
		label: "JSON array",
		detail: "Single JSON document for human inspection or compliance review.",
	},
	{
		id: "otlp",
		label: "OTLP/JSON zip",
		detail:
			"Zip containing logs.json, traces.json, and metrics.json for OTLP endpoints.",
	},
];

const CUSTOM_RANGE_PICK: RangePick = {
	id: "custom",
	label: "Custom range…",
	detail: "Choose inclusive UTC start and end dates.",
};

const FORMAT_OUTPUT: Record<FormatPick["id"], FormatOutput> = {
	json: { ext: "json", filters: { "JSON files": ["json"] } },
	otlp: { ext: "otlp.zip", filters: { "Zip files": ["zip"] } },
};

export async function runExportTelemetryCommand(
	telemetryDir: string,
	logger: Logger,
	flushTelemetry: () => Promise<void>,
	context: TelemetryContext,
): Promise<void> {
	const range = await promptDateRange();
	if (!range) return;
	const format = await promptFormat();
	if (!format) return;
	const outputUri = await promptSavePath(range, format.id);
	if (!outputUri) return;

	const onCleanupError = (err: unknown, target: string) =>
		logger.warn("Failed to delete telemetry export temp file", target, err);
	const onStagingCleanupError = (err: unknown, target: string) =>
		logger.warn(
			"Failed to delete telemetry export staging directory",
			target,
			err,
		);

	// Flush + list run inside the progress callback so the on-disk snapshot
	// is taken right before streaming and the user can cancel a long flush.
	const result = await withCancellableProgress(
		async ({ signal, progress }): Promise<ExportSummary> => {
			progress.report({ message: "Flushing buffered events..." });
			await flushTelemetry();
			throwIfAborted(signal);

			progress.report({ message: "Locating telemetry files..." });
			const filePaths = await listTelemetryFilesForRange(telemetryDir, range);
			if (filePaths.length === 0) {
				return { filesScanned: 0, eventCount: 0 };
			}

			progress.report({ message: "Writing export..." });
			const events = (async function* () {
				for await (const event of streamTelemetryEvents(filePaths, range)) {
					throwIfAborted(signal);
					yield event;
				}
			})();

			let eventCount: number;
			if (format.id === "json") {
				eventCount = await writeJsonArrayExport(
					outputUri.fsPath,
					events,
					onCleanupError,
				);
			} else {
				const counts = await writeOtlpZipExport(
					outputUri.fsPath,
					events,
					context,
					{
						signal,
						onTempCleanupError: onCleanupError,
						onStagingCleanupError,
					},
				);
				eventCount = counts.logs + counts.traces + counts.metrics;
			}
			return { filesScanned: filePaths.length, eventCount };
		},
		{
			location: vscode.ProgressLocation.Notification,
			title: "Exporting Coder telemetry",
			cancellable: true,
		},
	);

	if (!result.ok) {
		if (result.cancelled) return;
		logger.error("Telemetry export failed", result.error);
		vscode.window.showErrorMessage(
			`Telemetry export failed: ${toError(result.error).message}`,
		);
		return;
	}

	const { filesScanned, eventCount } = result.value;
	if (filesScanned === 0) {
		vscode.window.showInformationMessage(
			`No telemetry files found for ${range.label}.`,
		);
		return;
	}
	if (eventCount === 0) {
		await notifyNoEventsMatched(range, outputUri, logger);
		return;
	}
	await notifyExportSuccess(outputUri, eventCount, logger);
}

async function notifyExportSuccess(
	outputUri: vscode.Uri,
	eventCount: number,
	logger: Logger,
): Promise<void> {
	const action = await vscode.window.showInformationMessage(
		`Exported ${eventCount} telemetry event(s) to ${outputUri.fsPath}.`,
		"Reveal in File Explorer",
	);
	if (action !== "Reveal in File Explorer") return;
	try {
		await vscode.commands.executeCommand("revealFileInOS", outputUri);
	} catch (err) {
		logger.warn("Failed to reveal exported telemetry file", err);
	}
}

async function notifyNoEventsMatched(
	range: TelemetryDateRange,
	outputUri: vscode.Uri,
	logger: Logger,
): Promise<void> {
	// Remove the empty file the writer just created so the user isn't left
	// with an unwanted artifact.
	await fs
		.rm(outputUri.fsPath, { force: true })
		.catch((err) =>
			logger.warn(
				"Failed to remove empty telemetry export",
				outputUri.fsPath,
				err,
			),
		);
	vscode.window.showInformationMessage(
		`No telemetry events matched ${range.label}.`,
	);
}

async function promptDateRange(): Promise<TelemetryDateRange | undefined> {
	const pick = await vscode.window.showQuickPick(
		[...TELEMETRY_RANGE_PRESETS, CUSTOM_RANGE_PICK],
		{
			title: "Export Telemetry: Date Range",
			placeHolder: "Select telemetry date range",
			ignoreFocusOut: true,
		},
	);
	if (!pick) return undefined;
	if (pick.id === "custom") return promptCustomDateRange();
	return createPresetDateRange(pick.id);
}

async function promptCustomDateRange(): Promise<
	TelemetryDateRange | undefined
> {
	const todayUtc = toUtcDateString(new Date());
	const startDate = await vscode.window.showInputBox({
		title: "Export Telemetry: Custom Start Date",
		prompt: `Start date in UTC (YYYY-MM-DD). Today in UTC is ${todayUtc}; your local date may differ.`,
		value: todayUtc,
		validateInput: validateUtcDateInput,
		ignoreFocusOut: true,
	});
	if (startDate === undefined) return undefined;

	const endDate = await vscode.window.showInputBox({
		title: "Export Telemetry: Custom End Date",
		prompt: `End date in UTC (YYYY-MM-DD, inclusive). Today in UTC is ${todayUtc}.`,
		value: startDate,
		validateInput: (value) => {
			const invalidDate = validateUtcDateInput(value);
			if (invalidDate !== undefined) return invalidDate;
			// YYYY-MM-DD strings sort lexicographically as calendar dates.
			if (value < startDate) {
				return "End date must be on or after start date.";
			}
			return undefined;
		},
		ignoreFocusOut: true,
	});
	if (endDate === undefined) return undefined;

	return createCustomDateRange(startDate, endDate);
}

function promptFormat(): Thenable<FormatPick | undefined> {
	return vscode.window.showQuickPick(FORMAT_PICKS, {
		title: "Export Telemetry: Format",
		placeHolder: "Select export format",
		ignoreFocusOut: true,
	});
}

function promptSavePath(
	range: TelemetryDateRange,
	format: FormatPick["id"],
): Thenable<vscode.Uri | undefined> {
	const { ext, filters } = FORMAT_OUTPUT[format];
	const defaultName = `coder-telemetry-${range.filenamePart}.${ext}`;
	return vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
		filters,
		title: "Save Telemetry Export",
	});
}
