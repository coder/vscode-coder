import { writeJsonArrayExport } from "./json";
import { writeOtlpZipExport } from "./otlp/writer";

import type { TelemetryContext } from "../../event";

import type { ExportFormat, ExportWriter } from "./types";

export type {
	ExportDescriptor,
	ExportFormat,
	ExportWriteOptions,
	ExportWriter,
} from "./types";

/** Picks the writer for `format`, binding the context the OTLP writer needs. */
export function createExportWriter(
	format: ExportFormat,
	context: TelemetryContext,
): ExportWriter {
	if (format === "json") {
		// JSON has nowhere to record the descriptor, so it is dropped here.
		return (outputPath, events, _descriptor, options) =>
			writeJsonArrayExport(outputPath, events, options);
	}
	return (outputPath, events, descriptor, options) =>
		writeOtlpZipExport(outputPath, events, context, descriptor, options).then(
			(counts) => counts.logs + counts.traces + counts.metrics,
		);
}
