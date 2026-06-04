import { writeJsonArrayExport } from "./json";
import { writeOtlpZipExport } from "./otlp/writer";

import type { TelemetryContext } from "../../event";

import type { ExportFormat, ExportWriter } from "./types";

export type { ExportFormat, ExportWriteOptions, ExportWriter } from "./types";

/** Picks the writer for `format`, binding the context the OTLP writer needs. */
export function createExportWriter(
	format: ExportFormat,
	context: TelemetryContext,
): ExportWriter {
	if (format === "json") {
		return writeJsonArrayExport;
	}
	return (outputPath, events, options) =>
		writeOtlpZipExport(outputPath, events, context, options).then(
			(counts) => counts.logs + counts.traces + counts.metrics,
		);
}
