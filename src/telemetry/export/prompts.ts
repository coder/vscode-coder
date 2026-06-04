import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { toUtcDateString, validateUtcDateInput } from "../../util/date";

import {
	TELEMETRY_RANGE_PRESETS,
	createCustomDateRange,
	createPresetDateRange,
	type TelemetryDateRange,
	type TelemetryRangePresetId,
} from "./range";

import type { ExportFormat } from "./writers/types";

/** What the user chose: which range, in which format, written where. */
export interface ExportChoice {
	readonly range: TelemetryDateRange;
	readonly format: ExportFormat;
	readonly outputPath: string;
}

interface FormatPick extends vscode.QuickPickItem {
	readonly id: ExportFormat;
}

interface RangePick extends vscode.QuickPickItem {
	readonly id: TelemetryRangePresetId | "custom";
}

interface FileFormat {
	readonly ext: string;
	readonly filters: NonNullable<vscode.SaveDialogOptions["filters"]>;
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

const FILE_FILTERS: Record<ExportFormat, FileFormat> = {
	json: { ext: "json", filters: { "JSON files": ["json"] } },
	otlp: { ext: "otlp.zip", filters: { "Zip files": ["zip"] } },
};

/** Runs the range, format, then destination prompts; undefined on any cancel. */
export async function promptForExport(): Promise<ExportChoice | undefined> {
	const range = await promptDateRange();
	if (!range) {
		return undefined;
	}
	const format = await promptFormat();
	if (!format) {
		return undefined;
	}
	const outputPath = await promptSavePath(range, format);
	if (!outputPath) {
		return undefined;
	}
	return { range, format, outputPath };
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
	if (!pick) {
		return undefined;
	}
	return pick.id === "custom"
		? promptCustomDateRange()
		: createPresetDateRange(pick.id);
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
	if (startDate === undefined) {
		return undefined;
	}

	const endDate = await vscode.window.showInputBox({
		title: "Export Telemetry: Custom End Date",
		prompt: `End date in UTC (YYYY-MM-DD, inclusive). Today in UTC is ${todayUtc}.`,
		value: startDate,
		validateInput: (value) =>
			validateUtcDateInput(value) ??
			validateEndOnOrAfterStart(value, startDate),
		ignoreFocusOut: true,
	});
	if (endDate === undefined) {
		return undefined;
	}

	return createCustomDateRange(startDate, endDate);
}

/** YYYY-MM-DD strings sort lexicographically as calendar dates. */
function validateEndOnOrAfterStart(
	end: string,
	start: string,
): string | undefined {
	return end < start ? "End date must be on or after start date." : undefined;
}

async function promptFormat(): Promise<ExportFormat | undefined> {
	const pick = await vscode.window.showQuickPick(FORMAT_PICKS, {
		title: "Export Telemetry: Format",
		placeHolder: "Select export format",
		ignoreFocusOut: true,
	});
	return pick?.id;
}

async function promptSavePath(
	range: TelemetryDateRange,
	format: ExportFormat,
): Promise<string | undefined> {
	const { ext, filters } = FILE_FILTERS[format];
	const defaultName = `coder-telemetry-${range.filenamePart}.${ext}`;
	const uri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(os.homedir(), defaultName)),
		filters,
		title: "Save Telemetry Export",
	});
	if (!uri) {
		return undefined;
	}
	if (uri.scheme !== "file") {
		vscode.window.showErrorMessage(
			"Telemetry can only be exported to a local file. The selected location is not a local file path.",
		);
		return undefined;
	}
	return uri.fsPath;
}
