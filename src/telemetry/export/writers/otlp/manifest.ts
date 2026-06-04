import { CURRENT_TELEMETRY_SCHEMA_VERSION } from "../../../wireFormat";

import type { TelemetryContext } from "../../../event";

/** File name of the manifest packed alongside the export envelopes. */
export const MANIFEST_FILE = "manifest.json";

/** Manifest document format version; bump when this shape changes. */
export const MANIFEST_SCHEMA_VERSION = 1;

/** Date range the export covers. */
export interface ManifestRange {
	readonly label: string;
	readonly startMs?: number;
	readonly endMs?: number;
}

/** Per-signal record counts (records written, not source events). */
export interface RecordCounts {
	readonly logs: number;
	readonly traces: number;
	readonly metrics: number;
}

/** Caller-supplied inputs the writer cannot derive from the event stream. */
export interface ManifestInput {
	readonly range: ManifestRange;
	readonly sourceFiles: number;
}

/** Self-describing metadata written alongside an export. */
export interface ExportManifest {
	readonly schemaVersion: number;
	readonly telemetrySchemaVersion: number;
	readonly exportedAt: string;
	readonly extensionVersion: string;
	readonly format: string;
	readonly range: {
		readonly label: string;
		readonly start: string | null;
		readonly end: string | null;
	};
	readonly sourceFiles: number;
	readonly sourceEvents: number;
	readonly records: RecordCounts;
}

export function buildManifest(args: {
	readonly format: string;
	readonly context: TelemetryContext;
	readonly input: ManifestInput;
	readonly sourceEvents: number;
	readonly records: RecordCounts;
	readonly exportedAt: string;
}): ExportManifest {
	const { format, context, input, sourceEvents, records, exportedAt } = args;
	return {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		telemetrySchemaVersion: CURRENT_TELEMETRY_SCHEMA_VERSION,
		exportedAt,
		extensionVersion: context.extensionVersion,
		format,
		range: {
			label: input.range.label,
			start: toIso(input.range.startMs),
			end: toIso(input.range.endMs),
		},
		sourceFiles: input.sourceFiles,
		sourceEvents,
		records,
	};
}

function toIso(ms: number | undefined): string | null {
	return ms === undefined ? null : new Date(ms).toISOString();
}
