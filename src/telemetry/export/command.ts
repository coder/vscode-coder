import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { toError } from "../../error/errorUtils";

import { listTelemetryFilesForRange, readTelemetryEvents } from "./files";
import {
	TELEMETRY_RANGE_PRESETS,
	createCustomDateRange,
	createPresetDateRange,
	validateUtcDateInput,
	type TelemetryDateRange,
	type TelemetryRangePresetId,
} from "./range";
import { writeJsonArrayExport, writeOtlpZipExport } from "./writers";

import type { Logger } from "../../logging/logger";

interface FormatPick extends vscode.QuickPickItem {
	readonly id: "json" | "otlp";
}

interface RangePick extends vscode.QuickPickItem {
	readonly id: TelemetryRangePresetId | "custom";
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

export async function runExportTelemetryCommand(
	telemetryDir: string,
	logger: Logger,
	flushTelemetry: () => Promise<void>,
): Promise<void> {
	try {
		const range = await promptDateRange();
		if (!range) {
			return;
		}

		await flushTelemetry();

		const filePaths = await listTelemetryFilesForRange(telemetryDir, range);
		if (filePaths.length === 0) {
			vscode.window.showInformationMessage(
				`No telemetry files found for ${range.label}.`,
			);
			return;
		}

		const format = await promptFormat();
		if (!format) {
			return;
		}

		const outputUri = await promptOutputUri(range, format.id);
		if (!outputUri) {
			return;
		}

		const counts = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Exporting Coder telemetry",
			},
			async () => {
				const events = readTelemetryEvents(filePaths, range);
				return format.id === "json"
					? writeJsonArrayExport(outputUri.fsPath, events)
					: writeOtlpZipExport(outputUri.fsPath, events);
			},
		);

		const action = await vscode.window.showInformationMessage(
			`Exported ${counts.events} telemetry event(s) to ${outputUri.fsPath}.`,
			"Reveal in File Explorer",
		);
		if (action === "Reveal in File Explorer") {
			await vscode.commands.executeCommand("revealFileInOS", outputUri);
		}
	} catch (err) {
		logger.error("Telemetry export failed", err);
		vscode.window.showErrorMessage(
			`Telemetry export failed: ${toError(err).message}`,
		);
		throw err;
	}
}

async function promptDateRange(): Promise<TelemetryDateRange | undefined> {
	const pick = await vscode.window.showQuickPick(
		[
			...TELEMETRY_RANGE_PRESETS.map(
				(preset): RangePick => ({
					id: preset.id,
					label: preset.label,
					detail: preset.detail,
				}),
			),
			{
				id: "custom",
				label: "Custom range…",
				detail: "Choose inclusive UTC start and end dates.",
			} satisfies RangePick,
		],
		{
			title: "Export Telemetry: Date Range",
			placeHolder: "Select telemetry date range",
		},
	);
	if (!pick) {
		return undefined;
	}
	if (pick.id === "custom") {
		return promptCustomDateRange();
	}
	return createPresetDateRange(pick.id);
}

async function promptCustomDateRange(): Promise<
	TelemetryDateRange | undefined
> {
	const today = new Date().toISOString().slice(0, 10);
	const startDate = await vscode.window.showInputBox({
		title: "Export Telemetry: Custom Start Date",
		prompt: "Start date in UTC (YYYY-MM-DD)",
		value: today,
		validateInput: validateUtcDateInput,
	});
	if (startDate === undefined) {
		return undefined;
	}

	const endDate = await vscode.window.showInputBox({
		title: "Export Telemetry: Custom End Date",
		prompt: "End date in UTC (YYYY-MM-DD, inclusive)",
		value: startDate,
		validateInput: (value) => {
			const invalidDate = validateUtcDateInput(value);
			if (invalidDate !== undefined) {
				return invalidDate;
			}
			try {
				createCustomDateRange(startDate, value);
				return undefined;
			} catch (err) {
				return toError(err).message;
			}
		},
	});
	if (endDate === undefined) {
		return undefined;
	}

	return createCustomDateRange(startDate, endDate);
}

function promptFormat(): Thenable<FormatPick | undefined> {
	return vscode.window.showQuickPick(FORMAT_PICKS, {
		title: "Export Telemetry: Format",
		placeHolder: "Select export format",
	});
}

function promptOutputUri(
	range: TelemetryDateRange,
	format: FormatPick["id"],
): Thenable<vscode.Uri | undefined> {
	const defaultName =
		format === "json"
			? `coder-telemetry-${range.filenamePart}.json`
			: `coder-telemetry-${range.filenamePart}.otlp.zip`;
	return vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
		filters:
			format === "json" ? { "JSON files": ["json"] } : { "Zip files": ["zip"] },
		title: "Save Telemetry Export",
	});
}
